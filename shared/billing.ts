/**
 * Bill and impact estimation.
 *
 * EVERY NUMBER THIS MODULE PRODUCES IS AN ESTIMATE DERIVED FROM ASSUMPTIONS.
 *
 * None of it is a metered reading, a measured saving, or a verified emissions
 * figure. The assumptions are user-editable, returned alongside every result,
 * and the formulas are exposed so anyone can check the arithmetic. The UI is
 * required to label all of it "Estimate" (spec §27, §68).
 *
 * The CO2 figure in particular is *avoided grid emissions under an assumed grid
 * emission factor* — not a certified offset and not a project result.
 */

import type { BillingAssumptions } from './types';

export interface BillInput {
  /** Energy drawn from the grid over the period. */
  gridImportKwh: number;
  /** Energy produced by the microgrid over the period. */
  solarGeneratedKwh: number;
  /** Energy delivered from storage over the period. */
  batteryDischargedKwh: number;
  /** Total site consumption over the period. */
  totalConsumedKwh: number;
  periodDays: number;
  assumptions: BillingAssumptions;
}

export interface BillResult {
  /** Grid energy charge = gridImportKwh x tariff. */
  energyCharge: number;
  fixedCharge: number;
  /** Levies applied to (energy + fixed). */
  additionalCharges: number;
  /** What the site actually pays. */
  estimatedBill: number;

  /** What the same consumption would have cost entirely from the grid. */
  billWithoutMicrogrid: number;
  /** billWithoutMicrogrid - estimatedBill. */
  estimatedSavings: number;

  /** Cost of generating the renewable share with a diesel genset instead. */
  dieselEquivalentCost: number;
  dieselLitresAvoided: number;

  /** Avoided grid emissions under the assumed emission factor. */
  estimatedCo2AvoidedKg: number;

  averageDailyKwh: number;
  /** Fraction of consumption met without the grid, 0-1. */
  selfSufficiency: number;

  /** Human-readable formulas, rendered in the UI beside the numbers. */
  formulas: Array<{ label: string; expression: string; value: string }>;
}

export function calculateBill(input: BillInput): BillResult {
  const a = input.assumptions;

  // Renewable energy actually consumed on site.
  const renewableKwh = Math.max(0, input.totalConsumedKwh - input.gridImportKwh);

  // --- what is actually paid ---
  const energyCharge = input.gridImportKwh * a.tariffPerKwh;
  const fixedCharge = a.fixedCharge;
  const additionalCharges = (energyCharge + fixedCharge) * a.additionalChargeRate;
  const estimatedBill = energyCharge + fixedCharge + additionalCharges;

  // --- counterfactual: the same consumption bought entirely from the grid ---
  const counterfactualEnergy = input.totalConsumedKwh * a.tariffPerKwh;
  const billWithoutMicrogrid =
    counterfactualEnergy + fixedCharge + (counterfactualEnergy + fixedCharge) * a.additionalChargeRate;

  const estimatedSavings = Math.max(0, billWithoutMicrogrid - estimatedBill);

  // --- diesel-equivalent comparison ---
  const dieselLitresAvoided = a.generatorKwhPerLitre > 0 ? renewableKwh / a.generatorKwhPerLitre : 0;
  const dieselEquivalentCost = dieselLitresAvoided * a.dieselPricePerLitre;

  // --- emissions ---
  const estimatedCo2AvoidedKg = renewableKwh * a.gridEmissionFactor;

  const averageDailyKwh = input.periodDays > 0 ? input.totalConsumedKwh / input.periodDays : 0;
  const selfSufficiency =
    input.totalConsumedKwh > 0 ? Math.min(1, renewableKwh / input.totalConsumedKwh) : 0;

  const cur = a.currency === 'INR' ? '₹' : a.currency;
  const money = (n: number) => `${cur}${round2(n).toLocaleString()}`;

  return {
    energyCharge: round2(energyCharge),
    fixedCharge: round2(fixedCharge),
    additionalCharges: round2(additionalCharges),
    estimatedBill: round2(estimatedBill),
    billWithoutMicrogrid: round2(billWithoutMicrogrid),
    estimatedSavings: round2(estimatedSavings),
    dieselEquivalentCost: round2(dieselEquivalentCost),
    dieselLitresAvoided: round2(dieselLitresAvoided),
    estimatedCo2AvoidedKg: round2(estimatedCo2AvoidedKg),
    averageDailyKwh: round3(averageDailyKwh),
    selfSufficiency: round3(selfSufficiency),
    formulas: [
      {
        label: 'Grid energy charge',
        expression: 'grid import (kWh) × tariff',
        value: `${round2(input.gridImportKwh)} × ${a.tariffPerKwh} = ${money(energyCharge)}`,
      },
      {
        label: 'Additional charges',
        expression: '(energy + fixed) × levy rate',
        value: `(${round2(energyCharge)} + ${fixedCharge}) × ${a.additionalChargeRate} = ${money(additionalCharges)}`,
      },
      {
        label: 'Estimated bill',
        expression: 'energy + fixed + additional',
        value: money(estimatedBill),
      },
      {
        label: 'Estimated saving',
        expression: 'bill if fully grid-supplied − estimated bill',
        value: `${money(billWithoutMicrogrid)} − ${money(estimatedBill)} = ${money(estimatedSavings)}`,
      },
      {
        label: 'Diesel litres avoided',
        expression: 'renewable energy consumed ÷ generator yield',
        value: `${round2(renewableKwh)} ÷ ${a.generatorKwhPerLitre} = ${round2(dieselLitresAvoided)} L`,
      },
      {
        label: 'Estimated CO₂ avoided',
        expression: 'renewable energy consumed × grid emission factor',
        value: `${round2(renewableKwh)} × ${a.gridEmissionFactor} = ${round2(estimatedCo2AvoidedKg)} kg`,
      },
      {
        label: 'Self-sufficiency',
        expression: 'renewable consumed ÷ total consumed',
        value: `${round2(renewableKwh)} ÷ ${round2(input.totalConsumedKwh)} = ${(selfSufficiency * 100).toFixed(1)}%`,
      },
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The disclaimer the UI and every exported PDF must carry. */
export const ESTIMATE_DISCLAIMER =
  'All financial and emissions figures are ESTIMATES derived from the configurable assumptions shown. They are not metered readings, audited savings or certified emissions reductions.';
