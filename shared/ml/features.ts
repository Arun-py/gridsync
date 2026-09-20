/**
 * Feature engineering — TypeScript side.
 *
 * CRITICAL INVARIANT: this file and `ml/features/feature_engineering.py` must
 * produce the SAME vector in the SAME order. If they drift, the model is fed
 * features that mean something different from what it was trained on and every
 * prediction becomes noise. `tests/features.test.ts` pins the order, and the
 * exported model JSON carries `featureOrder` so inference can assert on it.
 *
 * Every feature here is computable AT INFERENCE TIME from a live frame plus a
 * short rolling window. Nothing is derived from the future, from the scenario
 * label, or from anything the simulator knows but a real node would not —
 * that would be label leakage and the reported accuracy would be meaningless.
 */

import { THRESHOLDS, TREND_WINDOW } from '../constants.js';
import { expectedSolarPower } from '../physics.js';
import type { EnrichedFrame, FeatureVector, NodeConfig, SystemSnapshot } from '../types.js';

/** Canonical feature order. Mirrored exactly in feature_engineering.py. */
export const FEATURE_ORDER: Array<keyof FeatureVector> = [
  'voltage',
  'current',
  'power',
  'temperature',
  'lux',
  'soc',
  'generationW',
  'loadW',
  'energyImbalanceW',
  'voltageTrend',
  'currentTrend',
  'temperatureTrend',
  'socTrend',
  'powerRollingMean',
  'powerRateOfChange',
  'solarElevation',
  'efficiencyRatio',
  'frameAgeSeconds',
];

/** Human labels for the explainability panel on the AI page. */
export const FEATURE_LABELS: Record<keyof FeatureVector, string> = {
  voltage: 'Voltage',
  current: 'Current',
  power: 'Power',
  temperature: 'Temperature',
  lux: 'Irradiance (lux)',
  soc: 'State of charge',
  generationW: 'System generation',
  loadW: 'System load',
  energyImbalanceW: 'Energy imbalance',
  voltageTrend: 'Voltage trend',
  currentTrend: 'Current trend',
  temperatureTrend: 'Temperature trend',
  socTrend: 'SOC trend',
  powerRollingMean: 'Power rolling mean',
  powerRateOfChange: 'Power rate of change',
  solarElevation: 'Solar elevation',
  efficiencyRatio: 'Efficiency ratio',
  frameAgeSeconds: 'Reading age',
};

/**
 * Least-squares slope of a series against elapsed minutes.
 * Returns 0 when there are too few points — a neutral value the model can learn
 * around, rather than a NaN that would poison the vector.
 */
function trend(frames: EnrichedFrame[], pick: (f: EnrichedFrame) => number | undefined): number {
  const points = frames
    .map((f) => ({ t: new Date(f.timestamp).getTime(), v: pick(f) }))
    .filter((p): p is { t: number; v: number } => typeof p.v === 'number' && Number.isFinite(p.v));

  if (points.length < 3) return 0;

  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 60_000);
  const ys = points.map((p) => p.v);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  const slope = num / den;
  return Number.isFinite(slope) ? slope : 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Build the feature vector for one node at one instant.
 *
 * `history` is the recent window for THIS node, oldest first, and should
 * already include `frame` (or not — it is appended defensively).
 */
export function extractFeatures(
  frame: EnrichedFrame,
  node: NodeConfig,
  history: EnrichedFrame[],
  snapshot: SystemSnapshot,
  solarElevationValue: number,
): FeatureVector {
  const window = history.slice(-TREND_WINDOW);
  const series = window.length > 0 && window[window.length - 1] === frame ? window : [...window, frame];

  const powers = series.map((f) => f.power).filter(Number.isFinite);

  // Rate of change over the two most recent samples, in W/s.
  let powerRateOfChange = 0;
  if (series.length >= 2) {
    const a = series[series.length - 2];
    const b = series[series.length - 1];
    const dt = (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
    if (dt > 0) powerRateOfChange = (b.power - a.power) / dt;
  }

  // Efficiency ratio is only meaningful for a generating node in usable light.
  let efficiencyRatio = 0;
  if (node.type === 'SOLAR' && typeof frame.lux === 'number' && frame.lux > 500) {
    const expected = expectedSolarPower(node, frame.lux, frame.temperature ?? 25);
    efficiencyRatio = expected > 1 ? clampFinite(frame.power / expected, 0, 2) : 0;
  }

  return {
    voltage: safe(frame.voltage),
    current: safe(frame.current),
    power: safe(frame.power),
    // Absent sensors get a neutral sentinel rather than NaN. The training
    // generator uses the SAME sentinels, so the model learns their meaning.
    temperature: safe(frame.temperature ?? 25),
    lux: safe(frame.lux ?? 0),
    soc: safe(frame.soc ?? 50),
    generationW: safe(snapshot.generationW),
    loadW: safe(snapshot.consumptionW),
    energyImbalanceW: safe(snapshot.netPowerW),
    voltageTrend: trend(series, (f) => f.voltage),
    currentTrend: trend(series, (f) => f.current),
    temperatureTrend: trend(series, (f) => f.temperature),
    socTrend: trend(series, (f) => f.soc),
    powerRollingMean: mean(powers),
    powerRateOfChange: safe(powerRateOfChange),
    solarElevation: safe(solarElevationValue),
    efficiencyRatio: safe(efficiencyRatio),
    // Capped so a node that has been dark for hours does not produce an
    // extreme value the trees never saw during training.
    frameAgeSeconds: clampFinite(safe(frame.ageMs) / 1000, 0, 600),
  };
}

/** Feature vector -> ordered numeric array, ready for the model. */
export function toFeatureArray(features: FeatureVector): number[] {
  return FEATURE_ORDER.map((key) => features[key]);
}

function safe(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return n;
}

function clampFinite(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export { THRESHOLDS };
