/**
 * GET /api/analytics?range=24H
 *
 * Everything the Analytics page needs, aggregated server-side into at most a
 * few hundred buckets. The browser never receives raw telemetry for this page.
 *
 * Energy totals integrate bucket-average power over bucket duration
 * (E = sum(P_avg * dt)), which is a Riemann sum — accurate to the bucket
 * resolution, and clearly an approximation rather than a metered reading.
 */

import { handler } from './_lib/handler';
import { resolveNodes } from '../shared/nodes.config';
import type { AnalyticsResponse, SimulationState, TimeRange } from '../shared/types';
import {
  alertRepo,
  predictionRepo,
  rangeToWindow,
  simulationRepo,
  telemetryRepo,
} from '../server/repositories';

const VALID: TimeRange[] = ['1H', '6H', '24H', '7D', '30D'];

export default handler({ methods: ['GET'], permission: 'view:analytics' }, async ({ query }) => {
  const range = (VALID.includes(query.range as TimeRange) ? query.range : '24H') as TimeRange;
  const { ms, bucketMs } = rangeToWindow(range);

  const until = new Date();
  const since = new Date(until.getTime() - ms);

  let state: SimulationState | null = null;
  try {
    state = await simulationRepo.get<SimulationState>();
  } catch {
    /* default below */
  }
  const nodes = resolveNodes(state?.nodeCount ?? 4);

  const [buckets, alertFreqRaw, anomalyFreqRaw] = await Promise.all([
    telemetryRepo.aggregate(since, until, bucketMs),
    alertRepo.frequency(since, until, bucketMs).catch(() => []),
    predictionRepo.anomalyFrequency(since, until, bucketMs).catch(() => []),
  ]);

  // --- totals -------------------------------------------------------------
  const hours = bucketMs / 3_600_000;
  let generatedKwh = 0;
  let consumedKwh = 0;
  let peakDemandW = 0;
  const efficiencies: number[] = [];

  for (const b of buckets) {
    generatedKwh += (b.generationW * hours) / 1000;
    consumedKwh += (b.consumptionW * hours) / 1000;
    peakDemandW = Math.max(peakDemandW, b.consumptionW);
    if (b.efficiency !== null) efficiencies.push(b.efficiency);
  }

  const averageEfficiency = efficiencies.length
    ? round3(efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length)
    : null;

  // --- per-node performance ----------------------------------------------
  const nodePerformance = await Promise.all(
    nodes.map(async (node) => {
      try {
        const series = await telemetryRepo.history(node.id, since, until, 200);
        const valid = series.filter((f) => f.valid);
        // Average power over the window, integrated across the window length.
        const avgPower = valid.length
          ? valid.reduce((s, f) => s + Math.abs(f.power), 0) / valid.length
          : 0;
        const energyKwh = (avgPower * (ms / 3_600_000)) / 1000;
        return {
          nodeId: node.id,
          name: node.shortName,
          energyKwh: round3(energyKwh),
          // Fraction of returned samples that passed validation.
          availability: series.length ? round3(valid.length / series.length) : 0,
        };
      } catch {
        return { nodeId: node.id, name: node.shortName, energyKwh: 0, availability: 0 };
      }
    }),
  );

  const response: AnalyticsResponse = {
    range,
    bucketMs,
    buckets,
    totals: {
      generatedKwh: round3(generatedKwh),
      consumedKwh: round3(consumedKwh),
      // Difference between generation and delivered load: conversion and
      // storage round-trip losses, plus anything unaccounted.
      lossesKwh: round3(Math.max(0, generatedKwh - consumedKwh)),
      peakDemandW: round2(peakDemandW),
      averageEfficiency,
    },
    alertFrequency: alertFreqRaw.map((a) => ({
      timestamp: new Date(a._id).toISOString(),
      info: a.info,
      warning: a.warning,
      critical: a.critical,
    })),
    anomalyFrequency: anomalyFreqRaw.map((a) => ({
      timestamp: new Date(a._id).toISOString(),
      count: a.count,
    })),
    nodePerformance,
    dataSource: state?.mode ?? 'SIMULATION',
  };

  return response;
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
