/**
 * GET /api/system-health
 *
 * THE KEY DISTINCTION THIS ENDPOINT ENCODES (spec §30, §62):
 *
 *   internetReachable    can this API reach the cloud database?
 *   edgeOperational      is the edge still collecting and processing locally?
 *
 * Those are different failures with different responses. A snapped internet
 * link with a healthy Raspberry Pi means data keeps being collected and the UI
 * shows EDGE MODE ACTIVE. A dead edge means collection has genuinely stopped.
 * Collapsing both into "system down" would misinform the operator.
 *
 * Component status is MEASURED where it can be (database ping, telemetry
 * freshness) and reported as SIMULATED where the hardware does not yet exist.
 * Nothing is reported as ONLINE on the basis of hope.
 */

import { handler } from './_lib/handler.js';
import { THRESHOLDS } from '../shared/constants.js';
import { resolveNodes } from '../shared/nodes.config.js';
import type { ComponentStatus, HealthComponent, SimulationState, SystemHealth } from '../shared/types.js';
import { checkDbHealth } from '../server/db.js';
import { loadModel } from '../server/ml.js';
import { simulationRepo, telemetryRepo } from '../server/repositories.js';

export default handler({ methods: ['GET'], auth: true }, async () => {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // --- database (measured) ------------------------------------------------
  const db = await checkDbHealth();

  // --- simulation state (measured, if the DB is up) -----------------------
  let state: SimulationState | null = null;
  if (db.connected) {
    try {
      state = await simulationRepo.get<SimulationState>();
    } catch {
      /* treated as unknown below */
    }
  }

  const mode = state?.mode ?? 'SIMULATION';
  const nodes = resolveNodes(state?.nodeCount ?? 4);

  // --- telemetry freshness (measured) -------------------------------------
  let staleNodes: string[] = [];
  let newestAgeMs = Number.POSITIVE_INFINITY;
  let frameCount = 0;

  if (db.connected) {
    try {
      const frames = await telemetryRepo.latestPerNode(nodes.map((n) => n.id));
      frameCount = frames.length;
      for (const f of frames) {
        const age = now - new Date(f.timestamp).getTime();
        newestAgeMs = Math.min(newestAgeMs, age);
        if (age > THRESHOLDS.network.staleMs) staleNodes.push(f.nodeId);
      }
      // A node that has never reported at all is also stale.
      const reporting = new Set(frames.map((f) => f.nodeId));
      staleNodes = [...staleNodes, ...nodes.filter((n) => !reporting.has(n.id)).map((n) => n.id)];
      frameCount += 0;
    } catch {
      /* leave as unknown */
    }
  }

  const workerAlive = Number.isFinite(newestAgeMs) && newestAgeMs < THRESHOLDS.network.offlineMs;
  const model = loadModel();

  const components: HealthComponent[] = [
    {
      id: 'api',
      name: 'GridSync API',
      status: 'ONLINE',
      // If this response exists, the API is serving. No inference needed.
      detail: 'Serving this request',
      lastCheck: nowIso,
    },
    {
      id: 'mongodb',
      name: 'MongoDB Atlas',
      status: db.connected ? 'ONLINE' : 'OFFLINE',
      detail: db.connected
        ? `Cluster responded to ping in ${db.latencyMs} ms`
        : `Unreachable (${db.error ?? 'unknown'}). Check the Atlas IP access list and credentials.`,
      latencyMs: db.latencyMs ?? undefined,
      lastCheck: nowIso,
    },
    {
      id: 'simulator',
      name: 'Simulation Engine',
      status: simulatorStatus(mode, workerAlive, state),
      detail: simulatorDetail(mode, workerAlive, state, newestAgeMs),
      lastCheck: nowIso,
    },
    {
      id: 'realtime',
      name: 'Realtime Stream',
      status: !workerAlive ? 'OFFLINE' : staleNodes.length > 0 ? 'DEGRADED' : 'ONLINE',
      detail: !workerAlive
        ? 'No recent telemetry — the worker process may not be running'
        : staleNodes.length > 0
          ? `${staleNodes.length} of ${nodes.length} node(s) not reporting`
          : `All ${nodes.length} nodes reporting`,
      latencyMs: Number.isFinite(newestAgeMs) ? Math.round(newestAgeMs) : undefined,
      lastCheck: nowIso,
    },
    {
      id: 'ml_engine',
      name: 'ML Inference Engine',
      status: model.evaluator ? 'ONLINE' : 'OFFLINE',
      detail: model.evaluator
        ? `Random Forest ${model.evaluator.modelVersion} loaded${model.evaluator.trainedOnSyntheticData ? ' (trained on synthetic data)' : ''}`
        : (model.error ?? 'No model trained. Rule engine continues unaffected.'),
      lastCheck: nowIso,
    },
    {
      id: 'mqtt',
      name: 'MQTT Broker',
      status: mode === 'SIMULATION' ? 'SIMULATED' : 'UNKNOWN',
      detail:
        mode === 'SIMULATION'
          ? 'Bypassed in simulation mode. Adapter implemented and wired; awaiting hardware.'
          : 'Realtime mode selected — broker status is reported by the worker.',
      lastCheck: nowIso,
    },
    {
      id: 'raspberry_pi',
      name: 'Raspberry Pi 5 Edge Node',
      status: 'SIMULATED',
      // Stated plainly rather than shown as a green tick.
      detail: 'Hardware integration UNDER DEVELOPMENT. No physical edge device is connected.',
      lastCheck: nowIso,
    },
  ];

  // The API process reaching the cloud DB is our proxy for cloud connectivity.
  const internetReachable = db.connected;
  // The edge is operational if telemetry is still arriving.
  const edgeOperational = workerAlive;

  const health: SystemHealth = {
    timestamp: nowIso,
    components,
    // EDGE MODE = edge still working, cloud link is not.
    edgeMode: edgeOperational && !internetReachable,
    internetReachable,
    edgeOperational,
    network: {
      packetLossPercent: 0, // authoritative figure comes from the worker stream
      averageLatencyMs: Number.isFinite(newestAgeMs) ? Math.round(newestAgeMs) : 0,
      duplicatePackets: 0,
      staleNodes,
    },
  };

  return {
    ...health,
    mode,
    scenario: state?.scenario ?? 'NORMAL',
    nodesConfigured: nodes.length,
    nodesReporting: Math.max(0, frameCount - staleNodes.length),
  };
});

function simulatorStatus(
  mode: string,
  workerAlive: boolean,
  state: SimulationState | null,
): ComponentStatus {
  if (mode !== 'SIMULATION') return 'OFFLINE';
  if (!state) return 'UNKNOWN';
  if (!state.running) return 'OFFLINE';
  return workerAlive ? 'SIMULATED' : 'DEGRADED';
}

function simulatorDetail(
  mode: string,
  workerAlive: boolean,
  state: SimulationState | null,
  newestAgeMs: number,
): string {
  if (mode !== 'SIMULATION') return 'Not in use — platform is in realtime mode';
  if (!state) return 'Worker has not reported its state. Start it with: npm run worker';
  if (!state.running) return 'Simulator is stopped';
  if (!workerAlive) {
    return Number.isFinite(newestAgeMs)
      ? `Last telemetry ${Math.round(newestAgeMs / 1000)} s ago — worker may have stopped`
      : 'No telemetry recorded yet';
  }
  return `Generating telemetry — scenario ${state.scenario}, ${state.framesGenerated.toLocaleString()} frames produced`;
}
