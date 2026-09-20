/**
 * Connectivity and configuration health check.
 *
 * Run: npm run healthcheck
 *
 * Verifies the things that silently break a deployment: database reachability,
 * required secrets, index presence, and whether a trained model is available.
 * Prints no secret values — only whether each one is set.
 */

import { checkDbHealth, closeClient, collection, COLLECTIONS, getDb } from '../server/db';
import { env } from '../server/env';
import { loadModel } from '../server/ml';

const ok = (s: string) => `  [ OK ]  ${s}`;
const bad = (s: string) => `  [FAIL]  ${s}`;
const warn = (s: string) => `  [WARN]  ${s}`;

async function main(): Promise<number> {
  let failures = 0;
  console.log('='.repeat(64));
  console.log('GridSync health check');
  console.log('='.repeat(64));

  // --- configuration ------------------------------------------------------
  console.log('\nConfiguration');
  const checks: Array<[string, () => boolean, boolean]> = [
    ['MONGODB_URI', () => Boolean(process.env.MONGODB_URI), true],
    ['AUTH_SECRET (>=32 chars)', () => (process.env.AUTH_SECRET ?? '').length >= 32, true],
    ['MONGODB_DB_NAME', () => Boolean(env.dbName), false],
    ['GOOGLE_CLIENT_ID / SECRET', () => env.googleEnabled, false],
    ['INGEST_TOKEN', () => Boolean(env.ingestToken), false],
  ];
  for (const [name, test, isRequired] of checks) {
    let passed = false;
    try {
      passed = test();
    } catch {
      passed = false;
    }
    if (passed) console.log(ok(`${name} is set`));
    else if (isRequired) {
      console.log(bad(`${name} is missing (required)`));
      failures++;
    } else {
      console.log(warn(`${name} is not set (optional)`));
    }
  }

  // --- database -----------------------------------------------------------
  console.log('\nDatabase');
  const health = await checkDbHealth();
  if (health.connected) {
    console.log(ok(`MongoDB reachable (${health.latencyMs} ms)`));
  } else {
    console.log(bad(`MongoDB unreachable: ${health.error}`));
    failures++;
  }

  if (health.connected) {
    const db = await getDb();
    const existing = (await db.listCollections().toArray()).map((c) => c.name);
    console.log(`  Database: ${env.dbName}`);
    for (const name of Object.values(COLLECTIONS)) {
      if (existing.includes(name)) {
        const count = await db.collection(name).estimatedDocumentCount();
        console.log(ok(`${name.padEnd(18)} ${count.toLocaleString()} documents`));
      } else {
        console.log(warn(`${name.padEnd(18)} not created yet (run: npm run seed)`));
      }
    }

    // --- indexes ---
    console.log('\nIndexes');
    try {
      const telemetry = await collection(COLLECTIONS.telemetry);
      const idx = await telemetry.indexes();
      const names = idx.map((i) => i.name);
      const wanted = ['nodeId_1_timestamp_-1', 'timestamp_-1'];
      for (const w of wanted) {
        if (names.includes(w)) console.log(ok(`telemetry.${w}`));
        else {
          console.log(warn(`telemetry.${w} missing (run: npm run indexes)`));
        }
      }
    } catch {
      console.log(warn('Could not read telemetry indexes (collection may not exist yet)'));
    }
  }

  // --- model --------------------------------------------------------------
  console.log('\nML model');
  const model = loadModel();
  if (model.evaluator) {
    console.log(ok(`Portable forest loaded (version ${model.evaluator.modelVersion})`));
    console.log(
      model.evaluator.trainedOnSyntheticData
        ? warn('Model was trained on SYNTHETIC data — metrics are not real-world performance')
        : ok('Model trained on non-synthetic data'),
    );
  } else {
    console.log(warn(`No model available: ${model.error ?? 'not trained'}`));
    console.log('          Run: npm run ml:pipeline');
  }

  if (model.metrics) {
    const m = model.metrics;
    console.log(
      m.accuracy === null
        ? warn(`Metrics withheld: ${m.insufficientDataNote}`)
        : ok(`Held-out accuracy ${m.accuracy}, macro-F1 ${m.macroF1}`),
    );
  } else {
    console.log(warn('No metrics.json — run: npm run ml:evaluate'));
  }

  console.log('\n' + '='.repeat(64));
  console.log(failures === 0 ? 'Health check PASSED' : `Health check FAILED (${failures} issue(s))`);
  console.log('='.repeat(64));

  await closeClient();
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Health check crashed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
