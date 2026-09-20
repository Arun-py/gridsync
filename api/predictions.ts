/**
 * GET /api/predictions — model output for the AI / Predictive Intelligence page.
 *
 * Returns predictions AND the model's real evaluation metrics together, so the
 * page can never show a confidence figure without the context of how the model
 * was validated and on what data.
 *
 * If no model has been trained, this returns `model.available: false` with the
 * reason. It does not invent a prediction to fill the space.
 */

import { handler, intParam } from './_lib/handler.js';
import { resolveNodes } from '../shared/nodes.config.js';
import { loadModel } from '../server/ml.js';
import { predictionRepo, simulationRepo } from '../server/repositories.js';
import type { ModelMetrics, SimulationState } from '../shared/types.js';

export default handler({ methods: ['GET'], auth: true }, async ({ query }) => {
  const limit = intParam(query.limit, 50, 1, 200);
  const { evaluator, metrics, error } = loadModel();

  let nodeCount = 4;
  try {
    const state = await simulationRepo.get<SimulationState>();
    nodeCount = state?.nodeCount ?? 4;
  } catch {
    /* default */
  }
  const nodes = resolveNodes(nodeCount);

  let latest: Awaited<ReturnType<typeof predictionRepo.latestPerNode>> = [];
  let recent: Awaited<ReturnType<typeof predictionRepo.recent>> = [];
  try {
    [latest, recent] = await Promise.all([
      predictionRepo.latestPerNode(nodes.map((n) => n.id)),
      predictionRepo.recent(limit),
    ]);
  } catch {
    // Database unavailable: report the model honestly, with no predictions.
  }

  return {
    latest,
    recent,
    model: {
      available: Boolean(evaluator),
      version: evaluator?.modelVersion ?? null,
      algorithm: 'RandomForestClassifier (scikit-learn)',
      // Surfaced prominently in the UI — never buried.
      trainedOnSyntheticData: evaluator?.trainedOnSyntheticData ?? null,
      error: error ?? null,
      classes: evaluator?.classes ?? [],
      featureImportances: evaluator?.featureImportances.slice(0, 10) ?? [],
    },
    metrics: presentMetrics(metrics),
  };
});

/**
 * Pass through only what the evaluation pipeline actually computed.
 *
 * When `accuracy` is null the pipeline decided the held-out data was too small
 * to characterise, and `insufficientDataNote` carries the exact sentence the UI
 * must display instead of a number.
 */
function presentMetrics(metrics: ModelMetrics | null) {
  if (!metrics) {
    return {
      available: false,
      note: 'No evaluation has been run. Execute: npm run ml:evaluate',
    };
  }

  return {
    available: true,
    modelVersion: metrics.modelVersion,
    trainedAt: metrics.trainedAt,
    algorithm: metrics.algorithm,
    trainedOnSyntheticData: metrics.trainedOnSyntheticData,
    datasetSize: metrics.datasetSize,
    trainSize: metrics.trainSize,
    validationSize: metrics.validationSize,
    testSize: metrics.testSize,
    accuracy: metrics.accuracy,
    macroPrecision: metrics.macroPrecision,
    macroRecall: metrics.macroRecall,
    macroF1: metrics.macroF1,
    perClass: metrics.perClass,
    confusionMatrix: metrics.confusionMatrix,
    labels: metrics.labels,
    featureImportances: metrics.featureImportances?.slice(0, 12) ?? [],
    insufficientDataNote: metrics.insufficientDataNote ?? null,
    notes: (metrics as ModelMetrics & { notes?: string[] }).notes ?? [],
    splitStrategy:
      (metrics as ModelMetrics & { splitStrategy?: string }).splitStrategy ?? null,
  };
}
