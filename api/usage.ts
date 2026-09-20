/**
 * GET  /api/usage — previously generated usage reports for the current user.
 * POST /api/usage — compute and persist a usage/bill estimate for a period.
 *
 * Energy figures come from the SAME aggregation the Analytics page uses, so a
 * report and the charts can never disagree. `dataSource` is stored on every
 * record so a simulation-derived report is permanently identifiable as such.
 */

import { z } from 'zod';

import { handler, intParam } from './_lib/handler';
import { calculateBill } from '../shared/billing';
import { DEFAULT_BILLING } from '../shared/constants';
import type { BillingAssumptions, SimulationState, UsageRecord } from '../shared/types';
import { simulationRepo, telemetryRepo, usageRepo } from '../server/repositories';
import { logger } from '../server/logger';

const log = logger('usage');

const assumptionsSchema = z.object({
  tariffPerKwh: z.number().min(0).max(1000),
  fixedCharge: z.number().min(0).max(100_000),
  additionalChargeRate: z.number().min(0).max(1),
  dieselPricePerLitre: z.number().min(0).max(10_000),
  generatorKwhPerLitre: z.number().min(0.1).max(20),
  gridEmissionFactor: z.number().min(0).max(5),
  currency: z.string().min(1).max(8),
});

const schema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  /** Grid import is not metered by the microgrid, so the user supplies it. */
  gridImportKwh: z.number().min(0).max(1_000_000).optional(),
  assumptions: assumptionsSchema.partial().optional(),
  save: z.boolean().optional(),
});

export default handler(
  { methods: ['GET', 'POST'], permission: 'reports:generate', schema: undefined },
  async ({ req, user, query, res }) => {
    // --- GET: list past reports -------------------------------------------
    if (req.method === 'GET') {
      const limit = intParam(query.limit, 25, 1, 100);
      const items = await usageRepo.listForUser(user!.sub, limit);
      return { items, total: items.length };
    }

    // --- POST: compute a new one ------------------------------------------
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400);
      return {
        error: 'Request body is invalid.',
        code: 'VALIDATION_FAILED',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    const body = parsed.data;

    const periodStart = new Date(body.periodStart);
    const periodEnd = new Date(body.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      res.status(400);
      return { error: 'periodStart and periodEnd must be valid dates.', code: 'BAD_PERIOD' };
    }
    if (periodEnd <= periodStart) {
      res.status(400);
      return { error: 'periodEnd must be after periodStart.', code: 'BAD_PERIOD' };
    }

    const periodMs = periodEnd.getTime() - periodStart.getTime();
    const periodDays = periodMs / 86_400_000;

    // Bucket size scales with the period so the aggregation stays bounded.
    const bucketMs = Math.max(60_000, Math.floor(periodMs / 500));
    const buckets = await telemetryRepo.aggregate(periodStart, periodEnd, bucketMs);

    const hours = bucketMs / 3_600_000;
    let solarGeneratedKwh = 0;
    let totalConsumedKwh = 0;
    let peakDemandW = 0;

    for (const b of buckets) {
      solarGeneratedKwh += (b.generationW * hours) / 1000;
      totalConsumedKwh += (b.consumptionW * hours) / 1000;
      peakDemandW = Math.max(peakDemandW, b.consumptionW);
    }

    // Storage throughput is not separately metered in the simulation; it is
    // reported as zero rather than estimated, so no invented number enters the
    // calculation.
    const batteryDischargedKwh = 0;

    const gridImportKwh = body.gridImportKwh ?? Math.max(0, totalConsumedKwh - solarGeneratedKwh);

    const assumptions: BillingAssumptions = { ...DEFAULT_BILLING, ...(body.assumptions ?? {}) };

    const bill = calculateBill({
      gridImportKwh,
      solarGeneratedKwh,
      batteryDischargedKwh,
      totalConsumedKwh,
      periodDays,
      assumptions,
    });

    let state: SimulationState | null = null;
    try {
      state = await simulationRepo.get<SimulationState>();
    } catch {
      /* default below */
    }

    const record: UsageRecord = {
      id: `use_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      userId: user!.sub,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      energyGeneratedKwh: round3(solarGeneratedKwh),
      energyConsumedKwh: round3(totalConsumedKwh),
      gridImportKwh: round3(gridImportKwh),
      peakDemandW: round2(peakDemandW),
      averageDailyKwh: bill.averageDailyKwh,
      estimatedCost: bill.estimatedBill,
      estimatedSavings: bill.estimatedSavings,
      estimatedCo2AvoidedKg: bill.estimatedCo2AvoidedKg,
      assumptions,
      // Permanently records whether this came from simulated or real telemetry.
      dataSource: state?.mode ?? 'SIMULATION',
      createdAt: new Date().toISOString(),
    };

    if (body.save !== false) {
      try {
        await usageRepo.create(record);
        log.info('Usage report saved', { recordId: record.id, userId: user!.sub });
      } catch (err) {
        // Return the calculation even if we could not persist it.
        log.error('Usage report persistence failed', {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      record,
      bill,
      dataPoints: buckets.length,
      dataSource: record.dataSource,
    };
  },
);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
