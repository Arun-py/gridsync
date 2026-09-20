/**
 * End-to-end acceptance test (spec §67).
 *
 * Exercises the REAL pipeline against the REAL database:
 *
 *   start simulation -> telemetry for N nodes -> written to MongoDB
 *   -> trigger SOLAR_FAULT -> telemetry changes coherently
 *   -> rule engine detects -> alert created
 *   -> ML inference runs -> prediction stored
 *   -> trigger NETWORK_FAILURE -> node goes stale -> edge mode
 *   -> return to NORMAL -> system recovers
 *   -> usage data -> bill calculation
 *
 * Run: npx tsx scripts/acceptance-test.ts
 *
 * This is not a unit test. It needs MONGODB_URI and will write to the database.
 */

import { SimulationEngine } from '../shared/simulation/engine';
import { calculateBill } from '../shared/billing';
import { DEFAULT_BILLING, THRESHOLDS } from '../shared/constants';
import { resolveNodes } from '../shared/nodes.config';
import { checkDbHealth, closeClient } from '../server/db';
import { loadModel } from '../server/ml';
import { Pipeline, type PipelinePersistence } from '../server/pipeline';
import { alertRepo, predictionRepo, telemetryRepo } from '../server/repositories';
import type { Alert, Prediction, TelemetryFrame } from '../shared/types';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function step(n: number, title: string): void {
  console.log(`\n${'─'.repeat(70)}\nSTEP ${n}: ${title}\n${'─'.repeat(70)}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  console.log('='.repeat(70));
  console.log('GridSync end-to-end acceptance test');
  console.log('='.repeat(70));

  // ---- preconditions ----
  step(0, 'Preconditions');

  const dbHealth = await checkDbHealth();
  check('MongoDB is reachable', dbHealth.connected, dbHealth.connected ? `${dbHealth.latencyMs} ms` : dbHealth.error);
  if (!dbHealth.connected) {
    console.log('\nCannot continue without a database connection.');
    return 1;
  }

  const model = loadModel();
  check('ML model is loaded', Boolean(model.evaluator), model.evaluator?.modelVersion ?? model.error ?? '');
  check(
    'Model metrics come from a real evaluation',
    model.metrics !== null && typeof model.metrics.accuracy === 'number',
    model.metrics?.accuracy !== undefined ? `accuracy ${model.metrics.accuracy}` : 'no metrics',
  );
  check(
    'Synthetic training data is disclosed',
    model.evaluator?.trainedOnSyntheticData === true,
    'trainedOnSyntheticData=true',
  );

  // ---- wiring ----
  const NODE_COUNT = 4;
  const nodes = resolveNodes(NODE_COUNT);

  const stored: TelemetryFrame[] = [];
  const storedAlerts: Alert[] = [];
  const storedPredictions: Prediction[] = [];

  const persistence: PipelinePersistence = {
    async saveFrames(frames) {
      stored.push(...frames);
      await telemetryRepo.insertMany(frames);
    },
    async saveAlerts(alerts) {
      storedAlerts.push(...alerts);
      await alertRepo.insertMany(alerts);
    },
    async savePredictions(predictions) {
      storedPredictions.push(...predictions);
      await predictionRepo.insertMany(predictions);
    },
  };

  const pipeline = new Pipeline({
    nodes,
    mode: 'SIMULATION',
    persist: persistence,
    inferenceIntervalMs: 0, // infer every tick so the test runs quickly
  });

  const engine = new SimulationEngine({
    nodeCount: NODE_COUNT,
    scenario: 'NORMAL',
    intervalMs: 1000,
    speed: 30,
    seed: Date.now() % 100000,
    // Midday: generation is active, so a solar fault is unambiguous.
    startTime: new Date(new Date().setHours(12, 0, 0, 0)),
  });

  /**
   * Drive `ticks` through the engine and the full pipeline.
   *
   * `delayMs` is REAL time between ticks. It matters: staleness thresholds are
   * wall-clock (a node is STALE after 8 s without a frame), so a step that
   * needs to observe a node going stale must actually let that much time pass.
   * Other steps run fast to keep the suite short.
   */
  async function run(ticks: number, delayMs = 25) {
    const results = [];
    for (let i = 0; i < ticks; i++) {
      const tick = engine.tick();
      pipeline.setSolarElevation(tick.solarElevation);
      results.push(await pipeline.process(tick.frames));
      await sleep(delayMs);
    }
    return results;
  }

  // =========================================================================
  step(1, 'Start simulation — four nodes generate telemetry');
  // =========================================================================

  const beforeCount = await telemetryRepo.countSince(new Date(Date.now() - 60_000));
  const normalRuns = await run(25);
  const lastNormal = normalRuns[normalRuns.length - 1];

  check('Four nodes are configured', nodes.length === 4, nodes.map((n) => n.shortName).join(', '));
  check('Telemetry frames were produced', stored.length > 0, `${stored.length} frames`);
  check(
    'Every configured node reported',
    new Set(stored.map((f) => f.nodeId)).size === 4,
    `${new Set(stored.map((f) => f.nodeId)).size} distinct nodes`,
  );
  check(
    'Frames satisfy P = V x I',
    stored.every((f) => Math.abs(f.power - Math.round(f.voltage * f.current * 100) / 100) < 0.02),
  );

  // =========================================================================
  step(2, 'Telemetry is written to MongoDB');
  // =========================================================================

  const afterCount = await telemetryRepo.countSince(new Date(Date.now() - 120_000));
  check('Document count increased', afterCount > beforeCount, `${beforeCount} -> ${afterCount}`);

  const latest = await telemetryRepo.latestPerNode(nodes.map((n) => n.id));
  check('Latest frame is retrievable per node', latest.length === 4, `${latest.length} nodes`);
  check(
    'Stored frames are recent',
    latest.every((f) => Date.now() - new Date(f.timestamp).getTime() < 120_000),
  );

  // =========================================================================
  step(3, 'Snapshot reflects live values');
  // =========================================================================

  check('Snapshot was produced', lastNormal.snapshot !== null);
  check(
    'Generation is present at midday',
    lastNormal.snapshot.generationW > 0,
    `${lastNormal.snapshot.generationW} W`,
  );
  check(
    'Consumption is present',
    lastNormal.snapshot.consumptionW > 0,
    `${lastNormal.snapshot.consumptionW} W`,
  );
  check(
    'Battery SOC is reported',
    lastNormal.snapshot.batterySoc !== null,
    `${lastNormal.snapshot.batterySoc}%`,
  );
  check(
    'Energy balance = generation − consumption',
    Math.abs(
      lastNormal.snapshot.netPowerW -
        (lastNormal.snapshot.generationW - lastNormal.snapshot.consumptionW),
    ) < 0.1,
  );
  check('Mode is reported as SIMULATION', lastNormal.snapshot.mode === 'SIMULATION');

  const normalSolar = stored.filter((f) => f.nodeType === 'SOLAR');
  const normalSolarMean =
    normalSolar.reduce((s, f) => s + f.power, 0) / Math.max(1, normalSolar.length);
  console.log(`  (baseline solar mean: ${normalSolarMean.toFixed(1)} W)`);

  // =========================================================================
  step(4, 'Trigger SOLAR FAULT — telemetry changes coherently');
  // =========================================================================

  engine.setScenario('SOLAR_FAULT');
  pipeline.setScenario('SOLAR_FAULT');

  const faultStart = stored.length;
  const faultRuns = await run(30);
  const faultFrames = stored.slice(faultStart);
  const faultSolar = faultFrames.filter((f) => f.nodeType === 'SOLAR');
  const faultSolarMean = faultSolar.reduce((s, f) => s + f.power, 0) / Math.max(1, faultSolar.length);

  check(
    'Solar power collapsed',
    faultSolarMean < normalSolarMean * 0.6,
    `${normalSolarMean.toFixed(1)} W -> ${faultSolarMean.toFixed(1)} W`,
  );
  check(
    'Irradiance remained high (the fault is in the array, not the light)',
    faultSolar.every((f) => (f.lux ?? 0) > THRESHOLDS.solar.daylightLuxThreshold),
    `mean ${(faultSolar.reduce((s, f) => s + (f.lux ?? 0), 0) / Math.max(1, faultSolar.length)).toFixed(0)} lx`,
  );
  check(
    'Physics was not bypassed — P = V x I still holds',
    faultSolar.every((f) => Math.abs(f.power - Math.round(f.voltage * f.current * 100) / 100) < 0.02),
  );

  // =========================================================================
  step(5, 'Rule engine detects the anomaly and creates an alert');
  // =========================================================================

  const solarAlerts = storedAlerts.filter(
    (a) => a.source === 'RULE' && a.ruleId?.startsWith('SOLAR'),
  );
  check('A solar rule fired', solarAlerts.length > 0, solarAlerts.map((a) => a.ruleId).join(', '));
  check('Rule alerts are marked DETECTED', solarAlerts.every((a) => a.kind === 'DETECTED'));
  check(
    'Alert carries actual and expected values',
    solarAlerts.some((a) => a.actualValue !== undefined && a.expectedValue !== undefined),
  );
  check(
    'Alert carries a likely cause and recommended action',
    solarAlerts.every((a) => a.likelyCause.length > 20 && a.recommendedAction.length > 20),
  );
  check(
    'Cause is phrased as a hypothesis, not a confirmed finding',
    solarAlerts.every((a) => /consistent with|possible|may |suggests|inference/i.test(a.likelyCause)),
  );

  const persistedAlerts = await alertRepo.list({ status: 'ACTIVE', pageSize: 50 });
  check(
    'Alerts were persisted to MongoDB',
    persistedAlerts.items.length > 0,
    `${persistedAlerts.total} active`,
  );

  // =========================================================================
  step(6, 'ML inference runs and a prediction is stored');
  // =========================================================================

  const allPredictions = faultRuns.flatMap((r) => r.predictions);
  check('Inference produced predictions', allPredictions.length > 0, `${allPredictions.length}`);

  if (allPredictions.length > 0) {
    const p = allPredictions[allPredictions.length - 1];
    check('Prediction has a confidence', p.confidence > 0 && p.confidence <= 1, `${p.confidence}`);
    check('Prediction lists contributing features', p.contributingFeatures.length > 0);
    check('Prediction records the model version', Boolean(p.modelVersion), p.modelVersion);
    check('Prediction discloses synthetic training', p.trainedOnSyntheticData === true);
    check(
      'Probabilities form a distribution',
      Math.abs(Object.values(p.classProbabilities).reduce((s, v) => s + (v ?? 0), 0) - 1) < 0.02,
    );

    const solarPrediction = allPredictions.find(
      (x) => x.nodeId === 'sigma' && x.predictedClass !== 'NORMAL',
    );
    check(
      'Model flagged a non-normal class on the faulted solar node',
      Boolean(solarPrediction),
      solarPrediction?.predictedClass ?? 'all NORMAL (model is advisory; rules already fired)',
    );
  }

  const persistedPredictions = await predictionRepo.recent(20);
  check('Predictions were persisted', persistedPredictions.length > 0, `${persistedPredictions.length}`);

  const mlAlerts = storedAlerts.filter((a) => a.source === 'ML');
  check(
    'Any ML-sourced alert is marked PREDICTED, never DETECTED',
    mlAlerts.every((a) => a.kind === 'PREDICTED'),
    `${mlAlerts.length} ML alert(s)`,
  );

  // =========================================================================
  step(7, 'Trigger NETWORK FAILURE — communication health degrades');
  // =========================================================================

  engine.setScenario('NETWORK_FAILURE');
  pipeline.setScenario('NETWORK_FAILURE');

  // Real-time pacing: the stale threshold is 8 s of wall clock, so this step
  // runs at roughly 1 Hz — the production rate — for long enough that a
  // blacked-out node genuinely crosses it.
  console.log(
    `  (running ~${((THRESHOLDS.network.staleMs / 1000) * 3).toFixed(0)}s in real time so staleness can occur)`,
  );
  const netRuns = await run(30, 800);
  const lastNet = netRuns[netRuns.length - 1];

  const anyDropped = netRuns.some((r) => r.health.network.staleNodes.length > 0);
  const maxLoss = Math.max(...netRuns.map((r) => r.health.network.packetLossPercent));

  check('Packet loss was measured', maxLoss > 0, `${maxLoss.toFixed(1)}% peak`);
  check('At least one node went stale or offline', anyDropped);

  const commAlerts = storedAlerts.filter((a) => a.source === 'COMMUNICATION');
  check(
    'A COMMUNICATION alert was raised',
    commAlerts.length > 0,
    commAlerts.map((a) => a.ruleId).join(', ') || 'none',
  );
  check(
    'Communication faults are described as such, not as sensor faults',
    commAlerts.every((a) => /COMMUNICATION fault/i.test(a.likelyCause)),
  );

  const staleStatuses = lastNet.frames.filter(
    (f) => f.status === 'STALE' || f.status === 'OFFLINE',
  );
  check(
    'Node status reflects staleness',
    staleStatuses.length > 0 || anyDropped,
    `${staleStatuses.length} stale/offline`,
  );

  // =========================================================================
  step(8, 'Edge-mode reporting is available and distinguishes failure modes');
  // =========================================================================

  check('Health payload separates edge from internet', 'edgeOperational' in lastNet.health);
  check('Edge is reported operational while collecting', lastNet.health.edgeOperational === true);
  check(
    'Components are enumerated',
    lastNet.health.components.length >= 5,
    `${lastNet.health.components.length} components`,
  );
  check(
    'Hardware components are declared SIMULATED, not ONLINE',
    lastNet.health.components.find((c) => c.id === 'raspberry_pi')?.status === 'SIMULATED',
  );

  // =========================================================================
  step(9, 'Return to NORMAL — the system recovers');
  // =========================================================================

  engine.setScenario('NORMAL');
  pipeline.setScenario('NORMAL');

  const recoveryStart = stored.length;
  const recoveryRuns = await run(30);
  const lastRecovery = recoveryRuns[recoveryRuns.length - 1];
  const recoveryFrames = stored.slice(recoveryStart);
  const recoverySolar = recoveryFrames.filter((f) => f.nodeType === 'SOLAR');
  const recoverySolarMean =
    recoverySolar.reduce((s, f) => s + f.power, 0) / Math.max(1, recoverySolar.length);

  check(
    'Solar generation recovered',
    recoverySolarMean > faultSolarMean * 1.5,
    `${faultSolarMean.toFixed(1)} W -> ${recoverySolarMean.toFixed(1)} W`,
  );
  check(
    'All nodes report again',
    lastRecovery.frames.filter((f) => f.status === 'ONLINE').length === 4,
    `${lastRecovery.frames.filter((f) => f.status === 'ONLINE').length}/4 online`,
  );
  check('Scenario is reported as NORMAL', lastRecovery.snapshot.scenario === 'NORMAL');

  // =========================================================================
  step(10, 'Usage data aggregates and the bill calculator produces an estimate');
  // =========================================================================

  const until = new Date();
  const since = new Date(until.getTime() - 3600_000);
  const buckets = await telemetryRepo.aggregate(since, until, 60_000);

  check('Aggregation returned buckets', buckets.length > 0, `${buckets.length} buckets`);

  const hours = 1 / 60;
  const generatedKwh = buckets.reduce((s, b) => s + (b.generationW * hours) / 1000, 0);
  const consumedKwh = buckets.reduce((s, b) => s + (b.consumptionW * hours) / 1000, 0);

  check('Generation energy computed', generatedKwh >= 0, `${generatedKwh.toFixed(4)} kWh`);
  check('Consumption energy computed', consumedKwh > 0, `${consumedKwh.toFixed(4)} kWh`);

  const bill = calculateBill({
    gridImportKwh: Math.max(0, consumedKwh - generatedKwh),
    solarGeneratedKwh: generatedKwh,
    batteryDischargedKwh: 0,
    totalConsumedKwh: consumedKwh,
    periodDays: 1 / 24,
    assumptions: DEFAULT_BILLING,
  });

  check('Bill estimate produced', Number.isFinite(bill.estimatedBill), `${bill.estimatedBill}`);
  check('Every figure is finite', [
    bill.estimatedBill,
    bill.estimatedSavings,
    bill.estimatedCo2AvoidedKg,
    bill.selfSufficiency,
  ].every(Number.isFinite));
  check('Formulas are exposed for verification', bill.formulas.length >= 6, `${bill.formulas.length}`);

  // =========================================================================
  step(11, 'Data integrity');
  // =========================================================================

  const bySeq = new Map<string, Set<number>>();
  let duplicatesStored = 0;
  for (const f of stored) {
    if (!bySeq.has(f.nodeId)) bySeq.set(f.nodeId, new Set());
    const set = bySeq.get(f.nodeId)!;
    if (set.has(f.sequenceNumber)) duplicatesStored++;
    set.add(f.sequenceNumber);
  }
  check('No duplicate frames reached storage', duplicatesStored === 0, `${duplicatesStored} duplicates`);

  const invalidStored = stored.filter((f) => !f.valid);
  check(
    'Invalid frames are flagged rather than silently dropped',
    invalidStored.every((f) => (f.validationErrors?.length ?? 0) > 0),
    `${invalidStored.length} invalid`,
  );

  // =========================================================================
  console.log(`\n${'='.repeat(70)}`);
  console.log(`ACCEPTANCE TEST: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('='.repeat(70));

  await closeClient();
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error('\nAcceptance test crashed:', err instanceof Error ? err.stack : err);
    await closeClient();
    process.exit(1);
  });
