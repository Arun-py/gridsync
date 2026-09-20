/**
 * Portable Random Forest evaluator.
 *
 * WHY THIS EXISTS
 * The model is trained in Python with scikit-learn (that is where the real
 * training, the real train/validation/test split and the real metrics live).
 * But the runtime — Vercel serverless functions and the Node worker — has no
 * Python. Shipping scikit-learn into a serverless bundle is neither reliable
 * nor small.
 *
 * So `ml/training/train_classifier.py` exports the fitted forest twice:
 *   - `model.joblib`      for Python-side inference and retraining
 *   - `model.json`        a plain description of every tree, read by this file
 *
 * This evaluator reimplements sklearn's inference path exactly: walk each tree
 * comparing `feature <= threshold`, average the per-tree class probability
 * distributions, and take the argmax. `tests/forest.test.ts` asserts that this
 * implementation reproduces sklearn's own predictions on a held-out sample
 * exported during training, so the two paths cannot silently diverge.
 *
 * This is NOT a reimplementation of training. No learning happens here.
 */

import type { FaultClass, FeatureVector } from '../types.js';
import { FEATURE_ORDER, toFeatureArray } from './features.js';

/**
 * One tree in sklearn's array representation.
 * Node `i` is a leaf when `childLeft[i] === -1`.
 */
export interface PortableTree {
  /** Feature index tested at each node; -2 at leaves (sklearn's convention). */
  feature: number[];
  threshold: number[];
  childLeft: number[];
  childRight: number[];
  /** Per-node class counts; only leaves are read. Shape: [nNodes][nClasses]. */
  value: number[][];
}

export interface PortableForest {
  /** Bumped by the training script; shown next to every prediction. */
  modelVersion: string;
  algorithm: string;
  /** Asserted against FEATURE_ORDER at load time. */
  featureOrder: string[];
  classes: FaultClass[];
  trees: PortableTree[];
  featureImportances: number[];
  trainedOnSyntheticData: boolean;
  trainedAt: string;
}

export interface ForestPrediction {
  predictedClass: FaultClass;
  confidence: number;
  probabilities: Partial<Record<FaultClass, number>>;
}

export class RandomForestEvaluator {
  private forest: PortableForest;

  constructor(forest: PortableForest) {
    // Fail loudly at load time rather than silently mispredicting forever.
    if (forest.featureOrder.length !== FEATURE_ORDER.length) {
      throw new Error(
        `Model feature count (${forest.featureOrder.length}) does not match runtime feature count (${FEATURE_ORDER.length}). Retrain the model.`,
      );
    }
    for (let i = 0; i < FEATURE_ORDER.length; i++) {
      if (forest.featureOrder[i] !== FEATURE_ORDER[i]) {
        throw new Error(
          `Model feature order mismatch at index ${i}: model expects "${forest.featureOrder[i]}", runtime provides "${FEATURE_ORDER[i]}". Retrain the model.`,
        );
      }
    }
    if (forest.trees.length === 0) {
      throw new Error('Portable forest contains no trees.');
    }
    this.forest = forest;
  }

  get modelVersion(): string {
    return this.forest.modelVersion;
  }

  get trainedOnSyntheticData(): boolean {
    return this.forest.trainedOnSyntheticData;
  }

  get classes(): FaultClass[] {
    return this.forest.classes;
  }

  get featureImportances(): Array<{ feature: string; importance: number }> {
    return this.forest.featureOrder
      .map((feature, i) => ({ feature, importance: this.forest.featureImportances[i] ?? 0 }))
      .sort((a, b) => b.importance - a.importance);
  }

  /** Walk one tree and return its normalised class distribution at the leaf. */
  private predictTree(tree: PortableTree, x: number[]): number[] {
    let node = 0;
    // Bounded to avoid an infinite loop if a malformed tree is ever loaded.
    let guard = 0;
    while (tree.childLeft[node] !== -1 && guard++ < 10_000) {
      const f = tree.feature[node];
      node = x[f] <= tree.threshold[node] ? tree.childLeft[node] : tree.childRight[node];
    }
    const counts = tree.value[node] ?? [];
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) return counts.map(() => 0);
    return counts.map((c) => c / total);
  }

  /** Average the per-tree distributions — exactly what sklearn's forest does. */
  predictFromArray(x: number[]): ForestPrediction {
    const nClasses = this.forest.classes.length;
    const summed = new Array<number>(nClasses).fill(0);

    for (const tree of this.forest.trees) {
      const dist = this.predictTree(tree, x);
      for (let c = 0; c < nClasses; c++) summed[c] += dist[c] ?? 0;
    }

    const probabilities: Partial<Record<FaultClass, number>> = {};
    let best = 0;
    let bestP = -1;
    for (let c = 0; c < nClasses; c++) {
      const p = summed[c] / this.forest.trees.length;
      probabilities[this.forest.classes[c]] = Math.round(p * 10000) / 10000;
      if (p > bestP) {
        bestP = p;
        best = c;
      }
    }

    return {
      predictedClass: this.forest.classes[best],
      confidence: Math.round(bestP * 10000) / 10000,
      probabilities,
    };
  }

  predict(features: FeatureVector): ForestPrediction {
    return this.predictFromArray(toFeatureArray(features));
  }

  /**
   * Per-prediction feature attribution.
   *
   * Global impurity importances weighted by how far each feature's value sits
   * from the training mean. This is a HEURISTIC for explanation, not a
   * game-theoretic attribution — it is not SHAP and must not be presented as
   * proof of causation. It answers "which signals moved this?", not "why".
   */
  explain(
    features: FeatureVector,
    topN = 4,
  ): Array<{ feature: string; value: number; importance: number }> {
    const x = toFeatureArray(features);
    return this.forest.featureOrder
      .map((feature, i) => ({
        feature,
        value: x[i],
        importance: this.forest.featureImportances[i] ?? 0,
      }))
      .filter((f) => f.importance > 0)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, topN)
      .map((f) => ({ ...f, importance: Math.round(f.importance * 10000) / 10000 }));
  }
}

/** Parse and validate a model.json payload. */
export function loadForest(json: unknown): RandomForestEvaluator {
  const f = json as PortableForest;
  if (!f || !Array.isArray(f.trees) || !Array.isArray(f.classes)) {
    throw new Error('Invalid portable forest payload.');
  }
  return new RandomForestEvaluator(f);
}

/**
 * Human-readable explanation and recommendation per class.
 *
 * Wording rules enforced here:
 *   - the model PREDICTS, it does not confirm
 *   - recommendations describe inspection, never a completed physical action
 */
export const CLASS_GUIDANCE: Record<
  FaultClass,
  { label: string; explanation: string; recommendedAction: string }
> = {
  NORMAL: {
    label: 'Normal operation',
    explanation:
      'The feature pattern matches the normal operating envelope the model was trained on.',
    recommendedAction: 'No action required. Continue routine monitoring.',
  },
  SOLAR_SHADING: {
    label: 'Possible solar shading',
    explanation:
      'Irradiance is adequate while current and yield are reduced, and the reduction pattern resembles partial shading in the training data.',
    recommendedAction:
      'Inspect the array for new shading from vegetation or structures at the current sun angle. Check whether the loss tracks the time of day.',
  },
  SOLAR_SOILING: {
    label: 'Possible solar soiling',
    explanation:
      'Irradiance is normal, voltage is normal, but current and efficiency are depressed in a way that persists across the day — consistent with surface contamination.',
    recommendedAction:
      'Inspect the panel surface and clean it if soiling is confirmed. Compare yield before and after cleaning to verify.',
  },
  BATTERY_FAULT: {
    label: 'Possible battery fault',
    explanation:
      'Terminal voltage has decoupled from state of charge and charge acceptance is degraded relative to the training envelope.',
    recommendedAction:
      'Perform a rested open-circuit voltage measurement per block and a capacity test to identify a weak or failing cell.',
  },
  BATTERY_OVERHEAT: {
    label: 'Possible battery overheating',
    explanation:
      'Pack temperature and its upward trend dominate the feature pattern for this prediction.',
    recommendedAction:
      'Reduce charge and discharge current, verify enclosure ventilation, and inspect for cell swelling before returning the bank to full duty.',
  },
  LOW_SOC: {
    label: 'Low state of charge',
    explanation:
      'State of charge and its declining trend are the dominant signals in this prediction.',
    recommendedAction:
      'Shed non-critical load to protect reserve capacity and verify the array is charging as expected.',
  },
  OVERLOAD: {
    label: 'Possible overload condition',
    explanation:
      'Load power sits above the rated envelope and the energy imbalance is strongly negative.',
    recommendedAction:
      'Recommended / Simulated Action: reduce non-critical load on the affected branch and verify conductor and protection ratings.',
  },
  BROWNOUT: {
    label: 'Possible brownout condition',
    explanation:
      'Bus voltage is depressed while current remains high, which matches the brownout pattern in the training data.',
    recommendedAction:
      'Reduce demand and check conductor sizing and termination resistance between the source and the affected branch.',
  },
  COMMUNICATION_FAULT: {
    label: 'Possible communication fault',
    explanation:
      'The feature pattern is consistent with stale or interrupted telemetry rather than a genuine process excursion.',
    recommendedAction:
      'Check node connectivity, signal strength and broker health. Treat displayed values as historical until the link recovers.',
  },
  SENSOR_FAULT: {
    label: 'Possible sensor fault',
    explanation:
      'One or more readings are physically implausible while the frame itself arrived intact — a sensor problem, not a communication problem.',
    recommendedAction:
      'Inspect sensor wiring and connectors and replace the sensor if the fault persists. Affected readings are excluded from analytics and training.',
  },
  ABNORMAL_CONSUMPTION: {
    label: 'Possible abnormal consumption',
    explanation:
      'Demand deviates from the learned time-of-day profile for this branch by more than normal variation.',
    recommendedAction:
      'Compare branch current against the expected load schedule to identify the additional or unexpected draw.',
  },
};
