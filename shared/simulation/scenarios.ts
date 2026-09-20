/**
 * Scenario effects.
 *
 * A scenario is a set of COHERENT modifiers applied to the physical model —
 * never a direct override of an output value. That distinction matters: if a
 * solar fault simply wrote `power = 3`, the lux/voltage/current relationship
 * would break and the rule engine would be detecting a lie. Instead a solar
 * fault derates the array, and the reduced current, reduced power and falling
 * efficiency all fall out of the physics.
 */

import type { ScenarioId } from '../types';

export interface ScenarioModifiers {
  /** Multiplies PV output after the irradiance/temperature model. 1 = healthy. */
  solarDerate: number;
  /** Extra cell temperature, degC. */
  solarTempOffset: number;
  /** Scales cloud modulation of irradiance, 0-1. */
  cloudiness: number;

  /** Multiplies battery charge acceptance. */
  batteryChargeAcceptance: number;
  /** Extra pack temperature, degC. */
  batteryTempOffset: number;
  /** Additive terminal-voltage error, V — decouples voltage from SOC. */
  batteryVoltageError: number;
  /** Extra parasitic drain, W. */
  batteryParasiticDrainW: number;

  /** Multiplies load demand. */
  loadMultiplier: number;
  /** Multiplies load bus voltage — below 1 produces a brownout. */
  loadVoltageSag: number;

  /** Probability in [0,1] that a frame is dropped. */
  packetLossRate: number;
  /** Probability in [0,1] that a frame is duplicated. */
  duplicateRate: number;
  /** Extra transport latency, ms. */
  extraLatencyMs: number;

  /** Probability a sensor emits a physically impossible reading. */
  sensorFaultRate: number;

  /** Forces the simulated clock to a fixed hour. null = follow the clock. */
  forceHour: number | null;

  /** Soiling accumulates over scenario runtime rather than applying instantly. */
  progressiveSoiling: boolean;
  /** Battery temperature ramps over runtime rather than stepping. */
  progressiveHeating: boolean;
}

export const NEUTRAL_MODIFIERS: ScenarioModifiers = {
  solarDerate: 1,
  solarTempOffset: 0,
  cloudiness: 0.15,
  batteryChargeAcceptance: 1,
  batteryTempOffset: 0,
  batteryVoltageError: 0,
  batteryParasiticDrainW: 0,
  loadMultiplier: 1,
  loadVoltageSag: 1,
  packetLossRate: 0,
  duplicateRate: 0,
  extraLatencyMs: 0,
  sensorFaultRate: 0,
  forceHour: null,
  progressiveSoiling: false,
  progressiveHeating: false,
};

/**
 * Resolve the modifiers for a scenario.
 *
 * `elapsedSeconds` is how long the scenario has been active, which lets
 * progressive faults (soiling, overheating) ramp instead of snapping — much
 * more convincing in a live demo, and it gives trend features something to
 * actually detect.
 */
export function getScenarioModifiers(scenario: ScenarioId, elapsedSeconds: number): ScenarioModifiers {
  const m: ScenarioModifiers = { ...NEUTRAL_MODIFIERS };
  /** 0 -> 1 over the first `seconds` of the scenario. */
  const ramp = (seconds: number) => Math.min(1, elapsedSeconds / Math.max(1, seconds));

  switch (scenario) {
    case 'NORMAL':
      return m;

    case 'SOLAR_FAULT':
      // Irradiance is fine; the array is not. Efficiency collapses to ~25 %.
      m.solarDerate = 0.25 - 0.05 * ramp(30);
      m.solarTempOffset = 4;
      return m;

    case 'PANEL_SOILING':
      // Dust builds up: a slow slide to ~60 % of expected output.
      m.progressiveSoiling = true;
      m.solarDerate = 1 - 0.4 * ramp(180);
      return m;

    case 'BATTERY_FAULT':
      // Voltage stops tracking SOC and charge acceptance degrades.
      m.batteryVoltageError = -0.55 - 0.25 * ramp(60);
      m.batteryChargeAcceptance = 0.35;
      m.batteryTempOffset = 6;
      m.batteryParasiticDrainW = 25;
      return m;

    case 'BATTERY_OVERHEATING':
      m.progressiveHeating = true;
      m.batteryTempOffset = 26 * ramp(120);
      return m;

    case 'OVERLOAD':
      m.loadMultiplier = 1.9 + 0.3 * ramp(45);
      m.loadVoltageSag = 0.96;
      return m;

    case 'HIGH_DEMAND':
      m.loadMultiplier = 1.45;
      return m;

    case 'BROWNOUT':
      // Voltage sags hard while demand stays elevated.
      m.loadMultiplier = 1.35;
      m.loadVoltageSag = 0.82;
      return m;

    case 'NETWORK_FAILURE':
      m.packetLossRate = 0.45;
      m.duplicateRate = 0.12;
      m.extraLatencyMs = 1800;
      return m;

    case 'SENSOR_FAILURE':
      m.sensorFaultRate = 0.3;
      return m;

    case 'NIGHT_MODE':
      m.forceHour = 22;
      return m;

    default:
      return m;
  }
}
