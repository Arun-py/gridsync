/**
 * Training-dataset generator.
 *
 * WHY THIS IS TYPESCRIPT AND NOT PYTHON
 * The physics model lives in `shared/physics.ts` and the feature extractor in
 * `shared/ml/features.ts`. Porting both to Python to generate data would create
 * two physics engines that silently drift apart, and the model would end up
 * trained on features that no longer match what inference computes. Generating
 * here guarantees train-time and inference-time features come from the exact
 * same code path. Python still does the actual learning and evaluation.
 *
 * LABELLING
 * Labels come from the scenario that was active plus the node the frame came
 * from — ground truth we possess because we generated the episode. Crucially,
 * the scenario id is NOT a feature; the model only sees sensor-derived values.
 *
 * AVOIDING LEAKAGE
 * Consecutive 1-second samples are nearly identical. A random row-wise split
 * would put near-duplicate rows in both train and test and report a fantasy
 * accuracy. So every row carries an `episode` id and the Python trainer splits
 * by EPISODE (a GroupShuffleSplit), never by row.
 *
 * Output: ml/data/training_data.csv
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SimulationEngine } from '../shared/simulation/engine.js';
import { extractFeatures, FEATURE_ORDER } from '../shared/ml/features.js';
import { validateFrame } from '../shared/validation.js';
import { THRESHOLDS } from '../shared/constants.js';
import { resolveNodes } from '../shared/nodes.config.js';
import type {
  EnrichedFrame,
  FaultClass,
  NodeConfig,
  ScenarioId,
  SystemSnapshot,
  TelemetryFrame,
} from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../ml/data/training_data.csv');

/** Scenarios sampled, with how many episodes of each. */
/**
 * Episodes per scenario.
 *
 * Counts are generous enough that the stratified split can give every scenario
 * episodes in train, validation AND test. With only 5 episodes a scenario gets
 * a single test episode, and one unlucky draw leaves a class unmeasurable.
 */
const EPISODE_PLAN: Array<{ scenario: ScenarioId; episodes: number }> = [
  { scenario: 'NORMAL', episodes: 16 },
  { scenario: 'SOLAR_FAULT', episodes: 12 },
  { scenario: 'PANEL_SOILING', episodes: 12 },
  { scenario: 'BATTERY_FAULT', episodes: 14 },
  { scenario: 'BATTERY_OVERHEATING', episodes: 14 },
  { scenario: 'OVERLOAD', episodes: 12 },
  { scenario: 'BROWNOUT', episodes: 10 },
  { scenario: 'HIGH_DEMAND', episodes: 10 },
  { scenario: 'NETWORK_FAILURE', episodes: 12 },
  { scenario: 'SENSOR_FAILURE', episodes: 12 },
  { scenario: 'NIGHT_MODE', episodes: 8 },
];

/** Ticks captured per episode. */
const TICKS_PER_EPISODE = 220;
/** Ticks discarded at the start so the battery/thermal states settle. */
const WARMUP_TICKS = 25;

/**
 * Ground-truth label for a frame.
 *
 * Order matters: a node can be in more than one abnormal state at once, so the
 * most specific / most urgent condition wins. Sensor faults come first because
 * an implausible reading makes every other interpretation unreliable.
 */
function labelFor(
  frame: TelemetryFrame,
  node: NodeConfig,
  scenario: ScenarioId,
  isStale: boolean,
): FaultClass {
  // A frame that failed validation is a sensor fault, whatever else is true.
  if (!frame.valid) return 'SENSOR_FAULT';

  // Telemetry that stopped arriving is a communication fault.
  if (isStale) return 'COMMUNICATION_FAULT';

  // Low SOC is a real battery state regardless of which scenario caused it.
  if (node.type === 'BATTERY' && frame.soc !== undefined && frame.soc < THRESHOLDS.battery.socCritical) {
    return 'LOW_SOC';
  }

  switch (scenario) {
    case 'SOLAR_FAULT':
      // Sharp, sustained derate with normal irradiance -> shading pattern.
      return node.type === 'SOLAR' ? 'SOLAR_SHADING' : 'NORMAL';
    case 'PANEL_SOILING':
      // Gradual decay -> soiling pattern. The trend features carry the
      // difference between this class and SOLAR_SHADING.
      return node.type === 'SOLAR' ? 'SOLAR_SOILING' : 'NORMAL';
    case 'BATTERY_FAULT':
      return node.type === 'BATTERY' ? 'BATTERY_FAULT' : 'NORMAL';
    case 'BATTERY_OVERHEATING':
      return node.type === 'BATTERY' &&
        frame.temperature !== undefined &&
        frame.temperature > THRESHOLDS.battery.temperatureWarning
        ? 'BATTERY_OVERHEAT'
        : 'NORMAL';
    case 'OVERLOAD':
      return (node.type === 'AC_LOAD' || node.type === 'DC_LOAD') &&
        frame.power > node.ratedPower * THRESHOLDS.load.overloadRatio
        ? 'OVERLOAD'
        : 'NORMAL';
    case 'BROWNOUT':
      return (node.type === 'AC_LOAD' || node.type === 'DC_LOAD') &&
        frame.voltage < node.nominalVoltage * THRESHOLDS.load.brownoutRatio
        ? 'BROWNOUT'
        : 'NORMAL';
    case 'HIGH_DEMAND':
      return node.type === 'AC_LOAD' || node.type === 'DC_LOAD' ? 'ABNORMAL_CONSUMPTION' : 'NORMAL';
    case 'NETWORK_FAILURE':
      // Frames that DID arrive during a network fault look normal; only the
      // stale ones (handled above) are communication faults. Labelling the
      // arrived frames COMMUNICATION_FAULT would teach the model a lie.
      return 'NORMAL';
    default:
      return 'NORMAL';
  }
}

/**
 * Start hour for an episode.
 *
 * Load faults are sampled around the evening demand peak, solar faults across
 * the daylight span, and battery faults across the whole day (a battery fault
 * is not time-of-day dependent). Spreading within each band keeps episodes
 * distinct rather than producing clones at one fixed hour.
 */
function pickStartHour(scenario: ScenarioId, episode: number): number {
  const spread = (base: number, span: number) => base + ((episode * 2.7) % span);
  switch (scenario) {
    case 'OVERLOAD':
    case 'BROWNOUT':
    case 'HIGH_DEMAND':
      // Evening peak window: demand is 60-100 % of rating here.
      return spread(17.5, 4);
    case 'SOLAR_FAULT':
    case 'PANEL_SOILING':
      // Mid-morning to mid-afternoon: irradiance is high enough that a yield
      // shortfall is unambiguous.
      return spread(9, 6);
    case 'NIGHT_MODE':
      return spread(20, 6);
    default:
      return spread(5, 16);
  }
}

function buildSnapshot(
  frames: TelemetryFrame[],
  nodes: NodeConfig[],
  scenario: ScenarioId,
): SystemSnapshot {
  const byType = (t: NodeConfig['type']) =>
    frames.filter((f) => nodes.find((n) => n.id === f.nodeId)?.type === t);

  const generationW = byType('SOLAR').reduce((s, f) => s + f.power, 0);
  const acLoadW = byType('AC_LOAD').reduce((s, f) => s + f.power, 0);
  const dcLoadW = byType('DC_LOAD').reduce((s, f) => s + f.power, 0);
  const batteries = byType('BATTERY');
  const batteryPowerW = batteries.reduce((s, f) => s + f.power, 0);
  const soc = batteries.length > 0 ? (batteries[0].soc ?? null) : null;

  return {
    timestamp: new Date().toISOString(),
    mode: 'SIMULATION',
    scenario,
    generationW,
    consumptionW: acLoadW + dcLoadW,
    netPowerW: generationW - (acLoadW + dcLoadW),
    batterySoc: soc,
    batteryPowerW,
    batteryState: batteryPowerW > 5 ? 'CHARGING' : batteryPowerW < -5 ? 'DISCHARGING' : 'IDLE',
    acLoadW,
    dcLoadW,
    systemEfficiency: null,
    nodesOnline: frames.length,
    nodesTotal: nodes.length,
    activeAlerts: { info: 0, warning: 0, critical: 0 },
    edgeMode: false,
  };
}

function main(): void {
  const rows: string[] = [];
  const header = [...FEATURE_ORDER, 'label', 'episode', 'node_id', 'node_type', 'scenario'];
  rows.push(header.join(','));

  const labelCounts = new Map<string, number>();
  let episodeIndex = 0;

  for (const { scenario, episodes } of EPISODE_PLAN) {
    for (let e = 0; e < episodes; e++) {
      episodeIndex += 1;
      const episodeId = `ep${String(episodeIndex).padStart(4, '0')}`;

      // Vary seed, start hour and node count so episodes are not clones.
      const seed = 1000 + episodeIndex * 7919;
      // Start times are biased per scenario so the fault can actually express
      // itself. An overload at 03:00 — when base load is 18 % of rating — never
      // crosses the overload threshold and would just produce NORMAL rows.
      const startHour = pickStartHour(scenario, e);
      const nodeCount = 4 + (e % 3) * 2; // 4, 6 or 8 nodes
      const start = new Date(2026, 3, 12, Math.floor(startHour), Math.round((startHour % 1) * 60));

      // Sweep the starting state of charge across episodes.
      //
      // A correctly-sized microgrid rarely reaches the deep-discharge region on
      // its own, so without this the LOW_SOC class would be almost absent and
      // the model could never learn to recognise it. Varying the starting point
      // is realistic — a real bank begins each day wherever the night left it —
      // and it is NOT label leakage: SOC is a genuine measured input, not a
      // hint about which scenario is active.
      //
      // Battery-fault scenarios use a HEALTHY sweep only. LOW_SOC takes
      // precedence in `labelFor` (a pack at 12 % really is in the low-SOC
      // state), so starting a BATTERY_OVERHEATING episode at 15 % would
      // relabel all of its rows LOW_SOC and starve the overheat class
      // entirely — which is exactly what happened before this split.
      const batteryScenario = scenario === 'BATTERY_FAULT' || scenario === 'BATTERY_OVERHEATING';
      const socSweep = batteryScenario
        ? [42, 55, 65, 75, 88, 95]
        : [15, 22, 35, 48, 60, 72, 85, 95];
      const initialSoc = socSweep[e % socSweep.length];

      const engine = new SimulationEngine({
        scenario,
        seed,
        startTime: start,
        nodeCount,
        intervalMs: 1000,
        speed: 45,
        initialSoc,
      });

      const nodes = resolveNodes(nodeCount);
      const history = new Map<string, EnrichedFrame[]>();
      const lastSeen = new Map<string, number>();
      for (const n of nodes) history.set(n.id, []);

      for (let tick = 0; tick < TICKS_PER_EPISODE; tick++) {
        const result = engine.tick();
        const now = Date.now() + tick * 1000;

        for (const f of result.frames) lastSeen.set(f.nodeId, now);

        const snapshot = buildSnapshot(result.frames, nodes, scenario);

        // De-duplicate: a duplicated frame is the same measurement twice and
        // must not become two training rows.
        const seen = new Set<string>();

        for (const frame of result.frames) {
          const key = `${frame.nodeId}:${frame.sequenceNumber}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const node = nodes.find((n) => n.id === frame.nodeId);
          if (!node) continue;

          const validation = validateFrame(frame, node);
          const validated: TelemetryFrame = {
            ...frame,
            valid: validation.valid,
            validationErrors: validation.valid ? undefined : validation.errors,
          };

          const enriched: EnrichedFrame = { ...validated, ageMs: 0 };
          const nodeHistory = history.get(node.id) ?? [];
          nodeHistory.push(enriched);
          if (nodeHistory.length > 60) nodeHistory.shift();
          history.set(node.id, nodeHistory);

          if (tick < WARMUP_TICKS) continue;

          const staleMs = now - (lastSeen.get(node.id) ?? now);
          const isStale = staleMs > THRESHOLDS.network.staleMs;

          const features = extractFeatures(
            enriched,
            node,
            nodeHistory,
            snapshot,
            result.solarElevation,
          );
          const label = labelFor(validated, node, scenario, isStale);
          labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);

          const values = FEATURE_ORDER.map((k) => {
            const v = features[k];
            return Number.isFinite(v) ? v.toFixed(6) : '0';
          });
          rows.push([...values, label, episodeId, node.id, node.type, scenario].join(','));
        }

        // Nodes that produced no frame this tick may have gone stale; emit a
        // COMMUNICATION_FAULT row for them so the class is represented by the
        // actual absence of data rather than by a synthetic placeholder.
        if (tick >= WARMUP_TICKS && result.droppedNodeIds.length > 0) {
          for (const nodeId of new Set(result.droppedNodeIds)) {
            const node = nodes.find((n) => n.id === nodeId);
            const nodeHistory = history.get(nodeId) ?? [];
            if (!node || nodeHistory.length === 0) continue;

            const age = now - (lastSeen.get(nodeId) ?? now);
            if (age <= THRESHOLDS.network.staleMs) continue;

            // The most recent frame, aged. This is exactly what the live
            // pipeline sees for a stale node: old values, growing age.
            const last = nodeHistory[nodeHistory.length - 1];
            const stale: EnrichedFrame = { ...last, ageMs: age };
            const features = extractFeatures(stale, node, nodeHistory, snapshot, result.solarElevation);
            labelCounts.set('COMMUNICATION_FAULT', (labelCounts.get('COMMUNICATION_FAULT') ?? 0) + 1);

            const values = FEATURE_ORDER.map((k) => {
              const v = features[k];
              return Number.isFinite(v) ? v.toFixed(6) : '0';
            });
            rows.push(
              [...values, 'COMMUNICATION_FAULT', episodeId, node.id, node.type, scenario].join(','),
            );
          }
        }
      }
    }
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, rows.join('\n'), 'utf8');

  console.log(`Wrote ${rows.length - 1} rows to ${OUT_PATH}`);
  console.log(`Episodes: ${episodeIndex}`);
  console.log('\nClass distribution:');
  const sorted = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0);
  for (const [label, count] of sorted) {
    console.log(`  ${label.padEnd(22)} ${String(count).padStart(7)}  ${((count / total) * 100).toFixed(1)}%`);
  }
}

main();
