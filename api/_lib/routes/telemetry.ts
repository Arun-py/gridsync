/**
 * Telemetry route implementations, dispatched by api/telemetry/[action].ts.
 *
 * Consolidated into one file (from two separate route files) to stay under
 * Vercel's per-deployment serverless function cap — see api/telemetry/[action].ts.
 */

import { ApiError, handler, intParam } from '../handler';
import { expectedSolarPower } from '../../../shared/physics';
import { getNodeConfig, resolveNodes } from '../../../shared/nodes.config';
import { THRESHOLDS } from '../../../shared/constants';
import type {
  EnrichedFrame,
  NodeConfig,
  SimulationState,
  SystemSnapshot,
  TelemetryFrame,
  TimeRange,
} from '../../../shared/types';
import { alertRepo, rangeToWindow, simulationRepo, telemetryRepo } from '../../../server/repositories';

// ---------------------------------------------------------------------------
// GET /api/telemetry/latest — current state of every node.
//
// This is the POLLING FALLBACK. When the browser can reach the worker's SSE
// stream it uses that instead and this endpoint goes quiet. When it cannot —
// worker on a private network, corporate proxy stripping event-streams, Vercel
// serving a client that has no worker URL — the frontend polls here and the
// dashboard still updates. Same data, same shape, either way.
//
// Derived values (efficiency, battery state, snapshot totals) are computed here
// rather than in the browser so the polling and streaming paths cannot disagree.
// ---------------------------------------------------------------------------

export const latestHandler = handler({ methods: ['GET'], auth: true, rateLimit: 240 }, async () => {
  let state: SimulationState | null = null;
  try {
    state = await simulationRepo.get<SimulationState>();
  } catch {
    /* control plane unavailable; fall back to defaults below */
  }

  const nodes = resolveNodes(state?.nodeCount ?? 4);
  const frames = await telemetryRepo.latestPerNode(nodes.map((n) => n.id));
  const now = Date.now();

  const enriched = frames.map((f) => enrich(f, nodes, now));
  const snapshot = buildSnapshot(enriched, nodes, state, now);

  try {
    const counts = await alertRepo.counts();
    snapshot.activeAlerts = { info: counts.info, warning: counts.warning, critical: counts.critical };
  } catch {
    /* alert counts are non-essential to the live view */
  }

  return {
    snapshot,
    frames: enriched,
    // Explicit so the UI can never mislabel simulated data as hardware data.
    mode: state?.mode ?? 'SIMULATION',
    scenario: state?.scenario ?? 'NORMAL',
    serverTime: new Date(now).toISOString(),
  };
});

function enrich(frame: TelemetryFrame, nodes: NodeConfig[], now: number): EnrichedFrame {
  const node = nodes.find((n) => n.id === frame.nodeId);
  const ageMs = Math.max(0, now - new Date(frame.timestamp).getTime());

  // Status is derived from AGE, not from whatever the frame claimed when it was
  // written. A node that stopped reporting an hour ago is not ONLINE.
  const status: EnrichedFrame['status'] = !frame.valid
    ? 'FAULT'
    : ageMs > THRESHOLDS.network.offlineMs
      ? 'OFFLINE'
      : ageMs > THRESHOLDS.network.staleMs
        ? 'STALE'
        : 'ONLINE';

  const out: EnrichedFrame = { ...frame, ageMs, status };

  if (node?.type === 'SOLAR' && typeof frame.lux === 'number' && frame.lux > 500) {
    const expected = expectedSolarPower(node, frame.lux, frame.temperature ?? 25);
    out.efficiency = expected > 1 ? Math.min(2, Math.max(0, frame.power / expected)) : undefined;
  }

  if (node?.type === 'BATTERY') {
    out.batteryState = frame.current > 0.3 ? 'CHARGING' : frame.current < -0.3 ? 'DISCHARGING' : 'IDLE';
  }

  return out;
}

function buildSnapshot(
  frames: EnrichedFrame[],
  nodes: NodeConfig[],
  state: SimulationState | null,
  now: number,
): SystemSnapshot {
  // Stale/offline/invalid frames are excluded from live totals.
  const live = frames.filter((f) => f.valid && f.status === 'ONLINE');
  const ofType = (t: NodeConfig['type']) =>
    live.filter((f) => nodes.find((n) => n.id === f.nodeId)?.type === t);

  const generationW = round2(ofType('SOLAR').reduce((s, f) => s + f.power, 0));
  const acLoadW = round2(ofType('AC_LOAD').reduce((s, f) => s + f.power, 0));
  const dcLoadW = round2(ofType('DC_LOAD').reduce((s, f) => s + f.power, 0));
  const consumptionW = round2(acLoadW + dcLoadW);

  const batteries = ofType('BATTERY');
  const batteryPowerW = batteries.length ? round2(batteries.reduce((s, f) => s + f.power, 0)) : null;
  const batterySoc = batteries.length
    ? round2(batteries.reduce((s, f) => s + (f.soc ?? 0), 0) / batteries.length)
    : null;

  return {
    timestamp: new Date(now).toISOString(),
    mode: state?.mode ?? 'SIMULATION',
    scenario: state?.scenario ?? 'NORMAL',
    generationW,
    consumptionW,
    netPowerW: round2(generationW - consumptionW),
    batterySoc,
    batteryPowerW,
    batteryState:
      batteryPowerW === null ? null : batteryPowerW > 5 ? 'CHARGING' : batteryPowerW < -5 ? 'DISCHARGING' : 'IDLE',
    acLoadW,
    dcLoadW,
    systemEfficiency: generationW > 0 ? round3(Math.min(1, consumptionW / generationW)) : null,
    nodesOnline: live.length,
    nodesTotal: nodes.length,
    activeAlerts: { info: 0, warning: 0, critical: 0 },
    // No frames at all, or every node stale, means the worker is not reaching
    // the database — the UI surfaces this as a degraded/edge condition.
    edgeMode: frames.length > 0 && live.length === 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// GET /api/telemetry/history?nodeId=sigma&range=24H
//
// Historical series for one node's charts.
//
// Down-sampling happens in MongoDB, not the browser. A 30-day window at 1 Hz is
// ~2.6 million documents; the repository strides that down to at most
// `maxPoints` evenly-spaced samples before anything crosses the wire.
// ---------------------------------------------------------------------------

const VALID_RANGES: TimeRange[] = ['1H', '6H', '24H', '7D', '30D'];

export const historyHandler = handler({ methods: ['GET'], auth: true }, async ({ query }) => {
  const nodeId = (query.nodeId ?? '').trim();
  if (!nodeId) {
    throw new ApiError(400, 'MISSING_NODE_ID', 'A nodeId query parameter is required.');
  }

  const node = getNodeConfig(nodeId);
  if (!node) {
    throw new ApiError(404, 'UNKNOWN_NODE', `No node is configured with id "${nodeId}".`);
  }

  const range = (query.range ?? '24H').toUpperCase() as TimeRange;
  if (!VALID_RANGES.includes(range)) {
    throw new ApiError(400, 'BAD_RANGE', `range must be one of ${VALID_RANGES.join(', ')}.`);
  }

  const maxPoints = intParam(query.maxPoints, 300, 50, 1000);
  const { ms } = rangeToWindow(range);
  const until = new Date();
  const since = new Date(until.getTime() - ms);

  const frames = await telemetryRepo.history(nodeId, since, until, maxPoints);

  return {
    nodeId,
    node,
    range,
    from: since.toISOString(),
    to: until.toISOString(),
    points: frames.length,
    // Invalid frames are returned but flagged, so a chart can show the gap
    // rather than silently interpolating over a sensor fault.
    series: frames.map((f) => ({
      timestamp: f.timestamp,
      voltage: f.voltage,
      current: f.current,
      power: f.power,
      temperature: f.temperature,
      lux: f.lux,
      soc: f.soc,
      valid: f.valid,
    })),
  };
});
