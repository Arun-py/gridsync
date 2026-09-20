/**
 * Billing and impact-estimate tests.
 *
 * These verify the arithmetic AND the honesty constraints: every result must
 * carry its formulas, and the disclaimer must state plainly that the figures
 * are estimates rather than measurements.
 */

import { describe, expect, it } from 'vitest';

import { ESTIMATE_DISCLAIMER, calculateBill } from '../shared/billing';
import { DEFAULT_BILLING } from '../shared/constants';

const A = DEFAULT_BILLING;

function bill(overrides: Partial<Parameters<typeof calculateBill>[0]> = {}) {
  return calculateBill({
    gridImportKwh: 100,
    solarGeneratedKwh: 150,
    batteryDischargedKwh: 0,
    totalConsumedKwh: 200,
    periodDays: 30,
    assumptions: A,
    ...overrides,
  });
}

describe('bill calculation', () => {
  it('computes the energy charge as import x tariff', () => {
    const r = bill({ gridImportKwh: 100 });
    expect(r.energyCharge).toBeCloseTo(100 * A.tariffPerKwh, 2);
  });

  it('applies levies to energy plus fixed charge', () => {
    const r = bill({ gridImportKwh: 100 });
    const expected = (100 * A.tariffPerKwh + A.fixedCharge) * A.additionalChargeRate;
    expect(r.additionalCharges).toBeCloseTo(expected, 2);
  });

  it('sums the bill correctly', () => {
    const r = bill();
    expect(r.estimatedBill).toBeCloseTo(r.energyCharge + r.fixedCharge + r.additionalCharges, 2);
  });

  it('shows a saving when the microgrid supplies part of the load', () => {
    const r = bill({ gridImportKwh: 100, totalConsumedKwh: 200 });
    expect(r.billWithoutMicrogrid).toBeGreaterThan(r.estimatedBill);
    expect(r.estimatedSavings).toBeGreaterThan(0);
  });

  it('shows no saving when everything comes from the grid', () => {
    const r = bill({ gridImportKwh: 200, totalConsumedKwh: 200 });
    expect(r.estimatedSavings).toBeCloseTo(0, 2);
    expect(r.estimatedCo2AvoidedKg).toBeCloseTo(0, 2);
    expect(r.selfSufficiency).toBeCloseTo(0, 3);
  });

  it('never reports a negative saving', () => {
    // Import exceeding consumption is nonsensical input; it must not produce a
    // negative "saving" that would read as a penalty.
    const r = bill({ gridImportKwh: 300, totalConsumedKwh: 200 });
    expect(r.estimatedSavings).toBeGreaterThanOrEqual(0);
  });

  it('computes self-sufficiency as the renewable share of consumption', () => {
    const r = bill({ gridImportKwh: 50, totalConsumedKwh: 200 });
    expect(r.selfSufficiency).toBeCloseTo(0.75, 3);
  });

  it('caps self-sufficiency at 1', () => {
    const r = bill({ gridImportKwh: 0, totalConsumedKwh: 100 });
    expect(r.selfSufficiency).toBeLessThanOrEqual(1);
  });

  it('derives diesel litres from the renewable share and generator yield', () => {
    const r = bill({ gridImportKwh: 100, totalConsumedKwh: 200 });
    const renewable = 100;
    expect(r.dieselLitresAvoided).toBeCloseTo(renewable / A.generatorKwhPerLitre, 2);
    expect(r.dieselEquivalentCost).toBeCloseTo(r.dieselLitresAvoided * A.dieselPricePerLitre, 2);
  });

  it('derives CO2 from the renewable share and the emission factor', () => {
    const r = bill({ gridImportKwh: 100, totalConsumedKwh: 200 });
    expect(r.estimatedCo2AvoidedKg).toBeCloseTo(100 * A.gridEmissionFactor, 2);
  });

  it('computes the daily average from the period length', () => {
    const r = bill({ totalConsumedKwh: 300, periodDays: 30 });
    expect(r.averageDailyKwh).toBeCloseTo(10, 3);
  });

  it('handles a zero-length period without dividing by zero', () => {
    const r = bill({ periodDays: 0 });
    expect(Number.isFinite(r.averageDailyKwh)).toBe(true);
    expect(r.averageDailyKwh).toBe(0);
  });

  it('handles zero consumption without producing NaN', () => {
    const r = bill({ gridImportKwh: 0, totalConsumedKwh: 0 });
    for (const value of [
      r.estimatedBill,
      r.estimatedSavings,
      r.estimatedCo2AvoidedKg,
      r.selfSufficiency,
      r.averageDailyKwh,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('scales linearly with the tariff', () => {
    const cheap = bill({ gridImportKwh: 100 });
    const expensive = calculateBill({
      gridImportKwh: 100,
      solarGeneratedKwh: 150,
      batteryDischargedKwh: 0,
      totalConsumedKwh: 200,
      periodDays: 30,
      assumptions: { ...A, tariffPerKwh: A.tariffPerKwh * 2 },
    });
    expect(expensive.energyCharge).toBeCloseTo(cheap.energyCharge * 2, 2);
  });

  it('tolerates a zero generator yield without dividing by zero', () => {
    const r = calculateBill({
      gridImportKwh: 100,
      solarGeneratedKwh: 150,
      batteryDischargedKwh: 0,
      totalConsumedKwh: 200,
      periodDays: 30,
      assumptions: { ...A, generatorKwhPerLitre: 0 },
    });
    expect(Number.isFinite(r.dieselLitresAvoided)).toBe(true);
    expect(r.dieselLitresAvoided).toBe(0);
  });
});

describe('transparency requirements', () => {
  it('returns a formula for every headline figure', () => {
    const r = bill();
    expect(r.formulas.length).toBeGreaterThanOrEqual(6);
    for (const f of r.formulas) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.expression.length).toBeGreaterThan(0);
      expect(f.value.length).toBeGreaterThan(0);
    }
  });

  it('includes the key calculations by name', () => {
    const labels = bill().formulas.map((f) => f.label.toLowerCase());
    expect(labels.some((l) => l.includes('energy charge'))).toBe(true);
    expect(labels.some((l) => l.includes('saving'))).toBe(true);
    expect(labels.some((l) => l.includes('co'))).toBe(true);
    expect(labels.some((l) => l.includes('self-sufficiency'))).toBe(true);
  });

  it('states plainly that the figures are estimates', () => {
    expect(ESTIMATE_DISCLAIMER).toMatch(/ESTIMATES/);
    expect(ESTIMATE_DISCLAIMER).toMatch(/not metered readings/i);
    expect(ESTIMATE_DISCLAIMER).toMatch(/assumptions/i);
  });
});

describe('default assumptions', () => {
  it('are all positive and physically sensible', () => {
    expect(A.tariffPerKwh).toBeGreaterThan(0);
    expect(A.fixedCharge).toBeGreaterThanOrEqual(0);
    expect(A.additionalChargeRate).toBeGreaterThanOrEqual(0);
    expect(A.additionalChargeRate).toBeLessThan(1);
    expect(A.dieselPricePerLitre).toBeGreaterThan(0);
    // A diesel genset yields roughly 3-4 kWh per litre.
    expect(A.generatorKwhPerLitre).toBeGreaterThan(1);
    expect(A.generatorKwhPerLitre).toBeLessThan(10);
    // Grid emission factors sit well under 2 kg CO2/kWh.
    expect(A.gridEmissionFactor).toBeGreaterThan(0);
    expect(A.gridEmissionFactor).toBeLessThan(2);
  });
});
