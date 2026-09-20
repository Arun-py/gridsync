/**
 * GridSync physical models.
 *
 * SIMULATION ASSUMPTIONS — read this before trusting any number downstream.
 *
 * The goal is a *believable* engineering simulation, not a validated electrical
 * model. Every function here is a deliberate simplification:
 *
 *  - Irradiance is modelled as a clear-sky sinusoid in `lux`, used as a linear
 *    proxy for W/m2. Real irradiance is not linear in illuminance (lux is
 *    photopically weighted) but it is monotonic and adequate for demonstration.
 *  - PV output uses the standard linear temperature-derating form
 *    P = P_rated * (G/G_ref) * (1 - beta * (T_cell - 25)), beta = 0.4 %/degC.
 *  - The battery is a coulomb-counting model with a piecewise-linear
 *    open-circuit-voltage curve for a 12 V lead-acid bank. No Peukert effect,
 *    no hysteresis, no ageing.
 *  - Round-trip efficiency is applied as a flat 90 % on charge, 95 % on
 *    discharge; inverter conversion is a flat 92 %.
 *  - Load profiles are deterministic time-of-day curves plus bounded noise.
 *
 * None of these constants are measured from the physical prototype. They are
 * engineering estimates chosen to produce coherent, explainable behaviour.
 */

import { THRESHOLDS } from './constants';
import type { NodeConfig } from './types';

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/**
 * Small, fast, seedable PRNG (mulberry32).
 *
 * The simulator must be reproducible: given the same seed and the same
 * simulated time, it produces the same telemetry. That is what makes a bug
 * reproducible and a test meaningful — `Math.random()` would not.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bounded, zero-centred noise. */
export function noise(rng: () => number, amplitude: number): number {
  return (rng() * 2 - 1) * amplitude;
}

/**
 * Smooth value noise over a continuous input — gives drift that wanders
 * plausibly instead of jittering independently each tick.
 */
export function smoothNoise(t: number, seed = 1): number {
  const s = Math.sin(t * 0.7 + seed * 12.9898) * 0.5;
  const c = Math.cos(t * 0.31 + seed * 78.233) * 0.3;
  const h = Math.sin(t * 1.9 + seed * 43.758) * 0.2;
  return s + c + h; // roughly in [-1, 1]
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// Solar
// ---------------------------------------------------------------------------

/**
 * Solar elevation proxy for a given time of day, 0 at night, 1 at solar noon.
 *
 * Sunrise 06:00, sunset 18:00 local. A half-sine over that window approximates
 * the clear-sky irradiance envelope closely enough for demonstration.
 */
export function solarElevation(hourOfDay: number): number {
  const sunrise = 6;
  const sunset = 18;
  if (hourOfDay <= sunrise || hourOfDay >= sunset) return 0;
  const dayFraction = (hourOfDay - sunrise) / (sunset - sunrise);
  return Math.sin(dayFraction * Math.PI);
}

/**
 * Illuminance in lux for a given elevation, with slow cloud modulation.
 * Clear-sky noon is ~100 klx, which matches `THRESHOLDS.solar.referenceLux`.
 */
export function irradianceLux(elevation: number, simulatedHours: number, cloudiness = 0): number {
  if (elevation <= 0) return 0;
  const clearSky = THRESHOLDS.solar.referenceLux * elevation;
  // Slow-moving cloud field; `cloudiness` scales how much it bites.
  const cloudFactor = 1 - cloudiness * (0.5 + 0.5 * smoothNoise(simulatedHours * 2, 7));
  return Math.max(0, clearSky * clamp(cloudFactor, 0.05, 1));
}

/** Cell temperature rises above ambient roughly in proportion to irradiance. */
export function cellTemperature(ambientC: number, lux: number): number {
  const irradianceRatio = lux / THRESHOLDS.solar.referenceLux;
  // ~30 degC rise at full sun — typical for an unventilated rooftop module.
  return ambientC + 30 * irradianceRatio;
}

/**
 * Expected PV power under the model, before any fault derating.
 * This is the reference the rule engine and the efficiency metric compare against.
 */
export function expectedSolarPower(node: NodeConfig, lux: number, cellTempC: number): number {
  const irradianceRatio = clamp(lux / THRESHOLDS.solar.referenceLux, 0, 1.1);
  const tempDerate = 1 - THRESHOLDS.solar.temperatureCoefficient * Math.max(0, cellTempC - 25);
  return Math.max(0, node.ratedPower * irradianceRatio * clamp(tempDerate, 0.5, 1));
}

/**
 * Split a PV power figure into a plausible operating point on the I-V curve.
 *
 * A real MPPT tracker holds voltage near Vmp and varies current with
 * irradiance, so voltage is modelled as weakly irradiance-dependent and
 * current carries the variation. Below ~2 % irradiance the array is dark.
 */
export function solarOperatingPoint(
  powerW: number,
  node: NodeConfig,
  lux: number,
): { voltage: number; current: number } {
  const irradianceRatio = clamp(lux / THRESHOLDS.solar.referenceLux, 0, 1.1);
  if (irradianceRatio < 0.02 || powerW <= 0.1) {
    // Dark array: open-circuit-ish voltage decays, no meaningful current.
    return { voltage: round(node.nominalVoltage * 0.25 * irradianceRatio * 10, 2), current: 0 };
  }
  // Vmp sags slightly at low irradiance and under heat.
  const voltage = node.nominalVoltage * (0.88 + 0.12 * Math.min(1, irradianceRatio * 3));
  const current = powerW / Math.max(voltage, 1);
  return { voltage: round(voltage, 2), current: round(current, 3) };
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

/**
 * Open-circuit voltage of a 12 V lead-acid bank at a given SOC.
 *
 * Piecewise-linear through the classic resting-voltage table carried forward
 * from the v1 prototype (12.7 V = 100 %, 12.0 V = 25 %, 11.8 V = 10 %).
 */
export function socToOpenCircuitVoltage(soc: number): number {
  const curve: Array<[number, number]> = [
    [0, 11.5],
    [10, 11.8],
    [25, 12.0],
    [50, 12.2],
    [75, 12.4],
    [100, 12.75],
  ];
  const s = clamp(soc, 0, 100);
  for (let i = 0; i < curve.length - 1; i++) {
    const [s0, v0] = curve[i];
    const [s1, v1] = curve[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return v0 + t * (v1 - v0);
    }
  }
  return 12.75;
}

/** Inverse of the curve above — used by legacy voltage-only estimates. */
export function voltageToSoc(voltage: number): number {
  const curve: Array<[number, number]> = [
    [11.5, 0],
    [11.8, 10],
    [12.0, 25],
    [12.2, 50],
    [12.4, 75],
    [12.75, 100],
  ];
  if (voltage <= curve[0][0]) return 0;
  if (voltage >= curve[curve.length - 1][0]) return 100;
  for (let i = 0; i < curve.length - 1; i++) {
    const [v0, s0] = curve[i];
    const [v1, s1] = curve[i + 1];
    if (voltage >= v0 && voltage <= v1) {
      const t = (voltage - v0) / (v1 - v0);
      return s0 + t * (s1 - s0);
    }
  }
  return 50;
}

/**
 * Terminal voltage = OCV + I*R_internal.
 *
 * Charging (positive current by our sign convention) pushes terminal voltage
 * above OCV; discharging pulls it below. R grows as the pack empties, which is
 * what makes a low battery sag under load.
 */
export function batteryTerminalVoltage(soc: number, currentA: number): number {
  const ocv = socToOpenCircuitVoltage(soc);
  const internalR = 0.02 + 0.04 * (1 - clamp(soc, 0, 100) / 100);
  return ocv + currentA * internalR;
}

export const BATTERY_CHARGE_EFFICIENCY = 0.9;
export const BATTERY_DISCHARGE_EFFICIENCY = 0.95;
/** DC -> AC conversion efficiency for the inverter feeding the AC branch. */
export const INVERTER_EFFICIENCY = 0.92;

/**
 * Advance SOC by coulomb counting.
 *
 * `powerW` is the power flowing INTO the battery (positive = charging).
 * Efficiency is applied on the way in and on the way out, so a full
 * charge/discharge round trip loses ~14.5 %.
 */
export function stepSoc(
  soc: number,
  powerW: number,
  capacityAh: number,
  nominalVoltage: number,
  elapsedSeconds: number,
): number {
  const capacityWh = capacityAh * nominalVoltage;
  if (capacityWh <= 0) return soc;
  const efficiency = powerW >= 0 ? BATTERY_CHARGE_EFFICIENCY : 1 / BATTERY_DISCHARGE_EFFICIENCY;
  const deltaWh = (powerW * efficiency * elapsedSeconds) / 3600;
  return clamp(soc + (deltaWh / capacityWh) * 100, 0, 100);
}

/**
 * Pack temperature relaxes toward ambient and self-heats with I^2*R losses.
 * First-order lag; `tau` is the thermal time constant in seconds.
 */
export function stepBatteryTemperature(
  currentTempC: number,
  ambientC: number,
  currentA: number,
  elapsedSeconds: number,
  tau = 600,
): number {
  const internalR = 0.03;
  const selfHeatC = (currentA * currentA * internalR) / 12; // degC of steady-state rise
  const target = ambientC + selfHeatC;
  const alpha = 1 - Math.exp(-elapsedSeconds / tau);
  return currentTempC + (target - currentTempC) * alpha;
}

// ---------------------------------------------------------------------------
// Loads
// ---------------------------------------------------------------------------

/**
 * Normalised daily demand profile, 0-1, for a rural microgrid.
 *
 * Two peaks: a modest morning peak around 07:00 and the dominant evening
 * lighting peak around 19:00-20:00. Overnight base load is ~18 %.
 */
export function dailyLoadProfile(hourOfDay: number): number {
  const h = ((hourOfDay % 24) + 24) % 24;
  const base = 0.18;
  const morning = 0.35 * Math.exp(-((h - 7) ** 2) / 3.0);
  const midday = 0.2 * Math.exp(-((h - 13) ** 2) / 8.0);
  const evening = 0.62 * Math.exp(-((h - 19.5) ** 2) / 4.0);
  return clamp(base + morning + midday + evening, 0, 1.2);
}

/** Ambient air temperature over the day: coolest ~05:00, warmest ~15:00. */
export function ambientTemperature(hourOfDay: number, dailyMin = 22, dailyMax = 34): number {
  const mid = (dailyMin + dailyMax) / 2;
  const amplitude = (dailyMax - dailyMin) / 2;
  return mid - amplitude * Math.cos(((hourOfDay - 5) / 24) * 2 * Math.PI);
}

/** Convert an instantaneous power reading to the current at a given voltage. */
export function currentFromPower(powerW: number, voltage: number): number {
  if (Math.abs(voltage) < 0.5) return 0;
  return powerW / voltage;
}

/** P = V x I. The one relationship the whole platform depends on. */
export function power(voltage: number, current: number): number {
  return voltage * current;
}

/** Watt-seconds to kilowatt-hours. */
export function wsToKwh(wattSeconds: number): number {
  return wattSeconds / 3_600_000;
}

/** Integrate a power series (W) sampled at `intervalMs` into kWh. */
export function energyKwh(powerSamplesW: number[], intervalMs: number): number {
  const totalWs = powerSamplesW.reduce((sum, p) => sum + p * (intervalMs / 1000), 0);
  return wsToKwh(totalWs);
}
