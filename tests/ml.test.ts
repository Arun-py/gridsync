/**
 * ML feature-contract and model-parity tests.
 *
 * THE PARITY TEST IS THE IMPORTANT ONE.
 *
 * The model is TRAINED in Python (scikit-learn) but RUN in TypeScript. If those
 * two inference paths ever diverge, every prediction the product shows becomes
 * quietly wrong while still looking confident. `train_classifier.py` exports a
 * sample of held-out rows together with sklearn's own predictions for them;
 * this test replays those rows through the TypeScript evaluator and asserts the
 * results are identical.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FEATURE_ORDER, FEATURE_LABELS, extractFeatures, toFeatureArray } from '../shared/ml/features';
import { CLASS_GUIDANCE, loadForest } from '../shared/ml/forest';
import { getNodeConfig } from '../shared/nodes.config';
import type { EnrichedFrame, FaultClass, NodeConfig, SystemSnapshot } from '../shared/types';

const MODEL_ROOT = join(process.cwd(), 'ml', 'models');

/** Mirrors resolveCurrentVersionDir() in server/ml.ts. */
function currentVersionDir(): string | null {
  const stable = join(MODEL_ROOT, 'current');
  if (existsSync(join(stable, 'model.json'))) return stable;

  const pointer = join(MODEL_ROOT, 'current.json');
  if (!existsSync(pointer)) return null;
  try {
    const { current } = JSON.parse(readFileSync(pointer, 'utf8')) as { current: string };
    const dir = join(MODEL_ROOT, current);
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

const SOLAR = getNodeConfig('sigma')!;

const SNAPSHOT: SystemSnapshot = {
  timestamp: new Date().toISOString(),
  mode: 'SIMULATION',
  scenario: 'NORMAL',
  generationW: 90,
  consumptionW: 70,
  netPowerW: 20,
  batterySoc: 65,
  batteryPowerW: 20,
  batteryState: 'CHARGING',
  acLoadW: 45,
  dcLoadW: 25,
  systemEfficiency: 0.78,
  nodesOnline: 4,
  nodesTotal: 4,
  activeAlerts: { info: 0, warning: 0, critical: 0 },
  edgeMode: false,
};

function frame(node: NodeConfig, overrides: Partial<EnrichedFrame> = {}): EnrichedFrame {
  const voltage = overrides.voltage ?? 17.5;
  const current = overrides.current ?? 4;
  return {
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    voltage,
    current,
    power: voltage * current,
    temperature: 42,
    lux: 78_000,
    status: 'ONLINE',
    mode: 'SIMULATION',
    source: 'SIMULATION',
    sequenceNumber: 1,
    valid: true,
    ageMs: 0,
    ...overrides,
  };
}

describe('feature contract', () => {
  it('has a stable, documented order', () => {
    // Pinned deliberately: reordering silently breaks a trained model, because
    // the portable forest indexes features positionally.
    expect(FEATURE_ORDER).toEqual([
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
    ]);
  });

  it('has a human label for every feature', () => {
    for (const key of FEATURE_ORDER) {
      expect(FEATURE_LABELS[key]).toBeDefined();
      expect(FEATURE_LABELS[key].length).toBeGreaterThan(0);
    }
  });

  it('produces a finite value for every feature', () => {
    const features = extractFeatures(frame(SOLAR), SOLAR, [], SNAPSHOT, 0.9);
    for (const key of FEATURE_ORDER) {
      expect(Number.isFinite(features[key])).toBe(true);
    }
  });

  it('never produces NaN when optional sensors are absent', () => {
    const load = getNodeConfig('dc_load')!;
    const f = frame(load, { temperature: undefined, lux: undefined, soc: undefined, voltage: 12, current: 5 });
    const features = extractFeatures(f, load, [], SNAPSHOT, 0.5);
    for (const key of FEATURE_ORDER) {
      expect(Number.isNaN(features[key])).toBe(false);
      expect(Number.isFinite(features[key])).toBe(true);
    }
  });

  it('returns a neutral zero trend when history is too short', () => {
    const features = extractFeatures(frame(SOLAR), SOLAR, [], SNAPSHOT, 0.9);
    expect(features.voltageTrend).toBe(0);
    expect(features.currentTrend).toBe(0);
    expect(features.socTrend).toBe(0);
  });

  it('detects a rising trend from history', () => {
    const base = Date.now() - 20_000;
    const hist: EnrichedFrame[] = [];
    for (let i = 0; i < 20; i++) {
      hist.push(
        frame(SOLAR, {
          timestamp: new Date(base + i * 1000).toISOString(),
          voltage: 15 + i * 0.1,
          current: 4,
        }),
      );
    }
    const features = extractFeatures(hist[hist.length - 1], SOLAR, hist, SNAPSHOT, 0.9);
    expect(features.voltageTrend).toBeGreaterThan(0);
  });

  it('computes efficiency ratio only for a generating node in usable light', () => {
    const lit = extractFeatures(frame(SOLAR, { lux: 80_000 }), SOLAR, [], SNAPSHOT, 0.9);
    expect(lit.efficiencyRatio).toBeGreaterThan(0);

    const dark = extractFeatures(
      frame(SOLAR, { lux: 10, voltage: 0.2, current: 0 }),
      SOLAR,
      [],
      SNAPSHOT,
      0,
    );
    expect(dark.efficiencyRatio).toBe(0);
  });

  it('serialises to an array in the declared order', () => {
    const features = extractFeatures(frame(SOLAR), SOLAR, [], SNAPSHOT, 0.9);
    const array = toFeatureArray(features);
    expect(array).toHaveLength(FEATURE_ORDER.length);
    expect(array[0]).toBe(features.voltage);
    expect(array[FEATURE_ORDER.length - 1]).toBe(features.efficiencyRatio);
  });
});

describe('class guidance', () => {
  const CLASSES: FaultClass[] = [
    'NORMAL',
    'SOLAR_SHADING',
    'SOLAR_SOILING',
    'BATTERY_FAULT',
    'BATTERY_OVERHEAT',
    'LOW_SOC',
    'OVERLOAD',
    'BROWNOUT',
    'COMMUNICATION_FAULT',
    'SENSOR_FAULT',
    'ABNORMAL_CONSUMPTION',
  ];

  it('covers every fault class', () => {
    for (const cls of CLASSES) {
      expect(CLASS_GUIDANCE[cls]).toBeDefined();
      expect(CLASS_GUIDANCE[cls].explanation.length).toBeGreaterThan(0);
      expect(CLASS_GUIDANCE[cls].recommendedAction.length).toBeGreaterThan(0);
    }
  });

  it('phrases fault classes as possibilities, not confirmed findings', () => {
    for (const cls of CLASSES) {
      if (cls === 'NORMAL' || cls === 'LOW_SOC') continue;
      // LOW_SOC is a directly measured state, so it is allowed to be definite.
      expect(CLASS_GUIDANCE[cls].label.toLowerCase()).toMatch(/possible/);
    }
  });

  it('recommends inspection rather than claiming an action was taken', () => {
    for (const cls of CLASSES) {
      const action = CLASS_GUIDANCE[cls].recommendedAction.toLowerCase();
      // Nothing may claim a completed physical action.
      expect(action).not.toMatch(/\bhas been (shed|switched|disconnected|cleaned)\b/);
      expect(action).not.toMatch(/\brelay (opened|closed|operated)\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// Parity with scikit-learn
// ---------------------------------------------------------------------------

const versionDir = currentVersionDir();
const hasModel = versionDir !== null && existsSync(join(versionDir, 'model.json'));
const hasSample = versionDir !== null && existsSync(join(versionDir, 'sklearn_sample.json'));

describe.skipIf(!hasModel)('portable forest', () => {
  it('loads and reports its metadata', () => {
    const json = JSON.parse(readFileSync(join(versionDir!, 'model.json'), 'utf8'));
    const forest = loadForest(json);
    expect(forest.modelVersion).toMatch(/^v\d+$/);
    expect(forest.classes.length).toBeGreaterThan(1);
    expect(forest.featureImportances.length).toBe(FEATURE_ORDER.length);
  });

  it('rejects a model whose feature order does not match the runtime', () => {
    const json = JSON.parse(readFileSync(join(versionDir!, 'model.json'), 'utf8'));
    const tampered = { ...json, featureOrder: [...json.featureOrder].reverse() };
    // Failing loudly is correct: a mismatched vector would produce confident nonsense.
    expect(() => loadForest(tampered)).toThrow(/feature order mismatch/i);
  });

  it('produces a probability distribution that sums to 1', () => {
    const json = JSON.parse(readFileSync(join(versionDir!, 'model.json'), 'utf8'));
    const forest = loadForest(json);
    const features = extractFeatures(frame(SOLAR), SOLAR, [], SNAPSHOT, 0.9);
    const result = forest.predict(features);

    const total = Object.values(result.probabilities).reduce((s, p) => s + (p ?? 0), 0);
    expect(total).toBeCloseTo(1, 2);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe.skipIf(!hasSample)('scikit-learn parity', () => {
  it('reproduces sklearn predictions exactly on held-out rows', () => {
    const json = JSON.parse(readFileSync(join(versionDir!, 'model.json'), 'utf8'));
    const sample = JSON.parse(readFileSync(join(versionDir!, 'sklearn_sample.json'), 'utf8')) as {
      featureOrder: string[];
      classes: string[];
      rows: Array<{
        features: number[];
        sklearnPrediction: string;
        sklearnProbabilities: number[];
      }>;
    };

    expect(sample.featureOrder).toEqual(FEATURE_ORDER);

    const forest = loadForest(json);
    let mismatches = 0;
    let maxProbDelta = 0;

    for (const row of sample.rows) {
      const result = forest.predictFromArray(row.features);
      if (result.predictedClass !== row.sklearnPrediction) mismatches++;

      sample.classes.forEach((cls, i) => {
        const ours = result.probabilities[cls as FaultClass] ?? 0;
        maxProbDelta = Math.max(maxProbDelta, Math.abs(ours - row.sklearnProbabilities[i]));
      });
    }

    // The TypeScript evaluator must agree with scikit-learn on every row.
    expect(mismatches).toBe(0);
    // Small deltas are expected: leaf counts are rounded during export.
    expect(maxProbDelta).toBeLessThan(1e-3);
  });
});

// A missing model must not fail the suite — it is an optional artefact, and the
// rule engine works without it. But say so loudly.
if (!hasModel) {
  describe('model artefacts', () => {
    it('reports that no trained model is present', () => {
      console.warn(
        '\n  No trained model found — parity tests skipped.\n' +
          '  Run `npm run ml:pipeline` to train one.\n',
      );
      expect(hasModel).toBe(false);
    });
  });
}
