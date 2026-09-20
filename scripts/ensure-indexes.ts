/**
 * Index creation.
 *
 * Run: npm run indexes   (idempotent — safe to re-run)
 *
 * Telemetry grows by `nodeCount` documents per second. Without indexes the
 * dashboard's "latest per node" query degrades to a collection scan within
 * hours. Every index here backs a query the application actually issues.
 */

import { closeClient, collection, COLLECTIONS } from '../server/db';
import { env } from '../server/env';

async function main(): Promise<void> {
  console.log('Creating indexes...\n');

  // --- telemetry ----------------------------------------------------------
  const telemetry = await collection(COLLECTIONS.telemetry);

  // Backs history queries: one node over a time window, newest first.
  await telemetry.createIndex({ nodeId: 1, timestamp: -1 }, { name: 'nodeId_1_timestamp_-1' });
  console.log('  telemetry: nodeId_1_timestamp_-1');

  // Backs system-wide window scans for analytics and the live snapshot.
  await telemetry.createIndex({ timestamp: -1 }, { name: 'timestamp_-1' });
  console.log('  telemetry: timestamp_-1');

  // Enforces idempotent ingest: a retransmitted frame (same node, same
  // sequence, same instant) cannot be stored twice, so a QoS-1 redelivery never
  // distorts analytics.
  //
  // TIMESTAMP IS PART OF THE KEY DELIBERATELY. A device that reboots restarts
  // its sequence counter at 1. Keying on (nodeId, sequenceNumber) alone would
  // then reject every frame the device sent after the reboot as a "duplicate"
  // of one sent before it — silent, total data loss for that node. Including
  // the timestamp keeps genuine retransmissions (identical frame) blocked while
  // letting a restarted counter through.
  //
  // An older (nodeId, sequenceNumber) index is dropped if present, since it
  // would keep enforcing the broken constraint.
  try {
    await telemetry.dropIndex('nodeId_1_sequenceNumber_1');
    console.log('  telemetry: dropped legacy nodeId_1_sequenceNumber_1');
  } catch {
    /* not present; fine */
  }
  await telemetry.createIndex(
    { nodeId: 1, sequenceNumber: 1, timestamp: 1 },
    { name: 'telemetry_dedupe', unique: true },
  );
  console.log('  telemetry: telemetry_dedupe (unique, nodeId+sequence+timestamp)');

  // Retention: Mongo expires raw telemetry automatically so the cluster does
  // not grow without bound. Aggregated history is kept separately.
  if (env.telemetryRetentionDays > 0) {
    const seconds = env.telemetryRetentionDays * 24 * 3600;
    // Drop and recreate if the TTL changed — Mongo will not alter it in place.
    try {
      await telemetry.dropIndex('telemetry_ttl');
    } catch {
      /* index did not exist; fine */
    }
    await telemetry.createIndex(
      { timestamp: 1 },
      { name: 'telemetry_ttl', expireAfterSeconds: seconds },
    );
    console.log(`  telemetry: telemetry_ttl (${env.telemetryRetentionDays} days)`);
  }

  // --- alerts -------------------------------------------------------------
  const alerts = await collection(COLLECTIONS.alerts);
  await alerts.createIndex({ status: 1, severity: 1, timestamp: -1 }, { name: 'alert_triage' });
  await alerts.createIndex({ nodeId: 1, timestamp: -1 }, { name: 'alert_by_node' });
  await alerts.createIndex({ timestamp: -1 }, { name: 'alert_recent' });
  // De-duplication: one ACTIVE alert per (rule, node) at a time. A partial
  // unique index means resolved alerts do not block a genuine recurrence.
  await alerts.createIndex(
    { ruleId: 1, nodeId: 1 },
    {
      name: 'alert_active_unique',
      unique: true,
      partialFilterExpression: { status: 'ACTIVE' },
    },
  );
  console.log('  alerts: alert_triage, alert_by_node, alert_recent, alert_active_unique');

  // --- predictions --------------------------------------------------------
  const predictions = await collection(COLLECTIONS.predictions);
  await predictions.createIndex({ timestamp: -1 }, { name: 'prediction_recent' });
  await predictions.createIndex({ nodeId: 1, timestamp: -1 }, { name: 'prediction_by_node' });
  if (env.telemetryRetentionDays > 0) {
    try {
      await predictions.dropIndex('prediction_ttl');
    } catch {
      /* fine */
    }
    await predictions.createIndex(
      { timestamp: 1 },
      { name: 'prediction_ttl', expireAfterSeconds: env.telemetryRetentionDays * 24 * 3600 },
    );
  }
  console.log('  predictions: prediction_recent, prediction_by_node, prediction_ttl');

  // --- users --------------------------------------------------------------
  const users = await collection(COLLECTIONS.users);
  await users.createIndex({ email: 1 }, { name: 'user_email_unique', unique: true });
  console.log('  users: user_email_unique (unique)');

  // --- nodes --------------------------------------------------------------
  const nodes = await collection(COLLECTIONS.nodes);
  await nodes.createIndex({ id: 1 }, { name: 'node_id_unique', unique: true });
  console.log('  nodes: node_id_unique (unique)');

  // --- usage records ------------------------------------------------------
  const usage = await collection(COLLECTIONS.usageRecords);
  await usage.createIndex({ userId: 1, createdAt: -1 }, { name: 'usage_by_user' });
  console.log('  usage_records: usage_by_user');

  // --- system events ------------------------------------------------------
  const events = await collection(COLLECTIONS.systemEvents);
  await events.createIndex({ timestamp: -1 }, { name: 'event_recent' });
  if (env.telemetryRetentionDays > 0) {
    try {
      await events.dropIndex('event_ttl');
    } catch {
      /* fine */
    }
    await events.createIndex(
      { timestamp: 1 },
      { name: 'event_ttl', expireAfterSeconds: 7 * 24 * 3600 },
    );
  }
  console.log('  system_events: event_recent, event_ttl (7 days)');

  console.log('\nIndexes ready.');
  await closeClient();
}

main().catch(async (err) => {
  console.error('Index creation failed:', err instanceof Error ? err.message : err);
  await closeClient();
  process.exit(1);
});
