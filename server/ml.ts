/**
 * Model loading and inference for the Node runtime.
 *
 * Reads the portable forest that `ml/training/train_classifier.py` exported and
 * runs it through `shared/ml/forest.ts`. No Python at runtime.
 *
 * DEGRADED OPERATION IS A FIRST-CLASS CASE
 * If no model has been trained, or the artefact is corrupt, or the feature
 * contract has changed, inference is DISABLED and the reason is reported. The
 * platform keeps running on the deterministic rule engine alone — which is the
 * correct behaviour, because rules are the safety layer and ML is advisory.
 * Nothing here ever fabricates a prediction to fill the gap.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLASS_GUIDANCE, loadForest, type RandomForestEvaluator } from '../shared/ml/forest.js';
import { FEATURE_LABELS } from '../shared/ml/features.js';
import type { FeatureVector, ModelMetrics, Prediction } from '../shared/types.js';
import { errorFields, logger } from './logger.js';

const log = logger('ml');

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_ROOT = resolve(__dirname, '../ml/models');

export interface LoadedModel {
  evaluator: RandomForestEvaluator | null;
  metrics: ModelMetrics | null;
  error: string | null;
}

/** Cached per process — the forest JSON is a megabyte or so and never changes. */
let cached: LoadedModel | null = null;

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    log.warn('Failed to read JSON artefact', { path, ...errorFields(err) });
    return null;
  }
}

/**
 * Locate the promoted model.
 *
 * `ml/models/current/` is the committed, deployed location and is checked
 * first — it is the only model directory that ships. The `current.json` pointer
 * is a fallback for a development machine that has trained locally but not yet
 * published, so a fresh clone and a working tree both resolve correctly.
 */
function resolveCurrentVersionDir(): string | null {
  const stable = join(MODEL_ROOT, 'current');
  if (existsSync(join(stable, 'model.json'))) return stable;

  const pointer = readJson<{ current: string }>(join(MODEL_ROOT, 'current.json'));
  if (!pointer?.current) return null;
  const dir = join(MODEL_ROOT, pointer.current);
  return existsSync(dir) ? dir : null;
}

export function loadModel(): LoadedModel {
  if (cached) return cached;

  const versionDir = resolveCurrentVersionDir();
  if (!versionDir) {
    cached = {
      evaluator: null,
      metrics: null,
      error: 'No trained model found. Run: npm run ml:pipeline',
    };
    return cached;
  }

  const metrics = readJson<ModelMetrics>(join(versionDir, 'metrics.json'));
  const forestJson = readJson<unknown>(join(versionDir, 'model.json'));

  if (!forestJson) {
    cached = { evaluator: null, metrics, error: 'Model artefact missing or unreadable.' };
    return cached;
  }

  try {
    const evaluator = loadForest(forestJson);
    log.info('Model loaded', {
      version: evaluator.modelVersion,
      synthetic: evaluator.trainedOnSyntheticData,
    });
    cached = { evaluator, metrics, error: null };
  } catch (err) {
    // A feature-contract mismatch lands here. Refusing to run is correct:
    // predictions from a mismatched vector would be confident nonsense.
    const message = err instanceof Error ? err.message : 'Failed to load model.';
    log.error('Model load failed — inference disabled', errorFields(err));
    cached = { evaluator: null, metrics, error: message };
  }

  return cached;
}

/** Drop the cache so a freshly trained model is picked up without a restart. */
export function reloadModel(): LoadedModel {
  cached = null;
  return loadModel();
}

export interface InferenceResult {
  prediction: Omit<Prediction, 'id'> | null;
  error: string | null;
}

/**
 * Run inference for one node.
 *
 * Wording is deliberate throughout: the returned text says the model PREDICTS a
 * possibility and RECOMMENDS an inspection. It never asserts that a physical
 * fault exists — only a technician looking at the hardware can establish that.
 */
export function predict(nodeId: string, features: FeatureVector): InferenceResult {
  const { evaluator } = loadModel();
  if (!evaluator) {
    return { prediction: null, error: loadModel().error };
  }

  try {
    const result = evaluator.predict(features);
    const guidance = CLASS_GUIDANCE[result.predictedClass];
    const contributing = evaluator.explain(features).map((f) => ({
      feature: FEATURE_LABELS[f.feature as keyof typeof FEATURE_LABELS] ?? f.feature,
      value: Math.round(f.value * 1000) / 1000,
      importance: f.importance,
    }));

    return {
      prediction: {
        nodeId,
        timestamp: new Date().toISOString(),
        predictedClass: result.predictedClass,
        confidence: result.confidence,
        classProbabilities: result.probabilities,
        contributingFeatures: contributing,
        explanation: guidance.explanation,
        recommendedAction: guidance.recommendedAction,
        modelVersion: evaluator.modelVersion,
        trainedOnSyntheticData: evaluator.trainedOnSyntheticData,
      },
      error: null,
    };
  } catch (err) {
    log.error('Inference failed', { nodeId, ...errorFields(err) });
    return { prediction: null, error: 'Inference failed.' };
  }
}

export { CLASS_GUIDANCE };
