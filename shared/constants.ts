/**
 * GridSync tunable constants.
 *
 * Every threshold the rule engine uses lives here — no magic numbers in rules.
 * Values marked "carried forward" come from the original GridSync prototype
 * configuration (backend/config.py in v1) and describe the physical 12 V system.
 */

import type { BillingAssumptions, ScenarioDefinition, ScenarioId } from './types.js';

// ---------------------------------------------------------------------------
// Physical plausibility bounds — used by sensor validation.
// A reading outside these bounds is a SENSOR fault, not a process excursion.
// ---------------------------------------------------------------------------

export const PLAUSIBLE = {
  /** AC nodes are checked against their own NodeConfig range instead. */
  voltage: { min: -1, max: 300 },
  current: { min: -40, max: 40 },
  temperature: { min: -40, max: 125 },
  lux: { min: 0, max: 150_000 },
  soc: { min: 0, max: 100 },
} as const;

/**
 * DS18B20 temperature sensors report exactly -127 degC when the 1-Wire bus read
 * fails. Treating it as a real measurement would poison ML training, so it is
 * matched explicitly and classified as SENSOR_FAULT.
 */
export const DS18B20_ERROR_VALUE = -127;

// ---------------------------------------------------------------------------
// Rule thresholds (carried forward from the v1 prototype, then extended)
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  battery: {
    /** Below this SOC, warn. */
    socWarning: 30,
    /** Below this SOC, critical — deep-discharge risk. */
    socCritical: 20,
    voltageMin: 10.5,
    voltageMax: 14.5,
    /** Above this, the charger is likely misbehaving. */
    overchargeVoltage: 14.8,
    temperatureWarning: 40,
    temperatureCritical: 45,
    /** SOC percentage points per minute that counts as an abnormal decline. */
    rapidSocDeclinePerMin: 1.5,
  },
  solar: {
    /** Above this irradiance proxy, meaningful generation is expected. */
    daylightLuxThreshold: 12_000,
    /** Measured/expected below this in good light suggests shading or soiling. */
    efficiencyWarning: 0.75,
    efficiencyCritical: 0.45,
    temperatureWarning: 55,
    temperatureCritical: 70,
    /** Panel temperature coefficient: fractional power loss per degC above 25. */
    temperatureCoefficient: 0.004,
    /** Irradiance at which a panel delivers its nameplate rating. */
    referenceLux: 100_000,
  },
  load: {
    /** Fraction of rated power that counts as an overload. */
    overloadRatio: 1.15,
    criticalOverloadRatio: 1.35,
    /** Fraction of nominal voltage below which the branch is browning out. */
    brownoutRatio: 0.88,
    /** Consecutive spikes before "repeated spikes" is raised. */
    spikeCountThreshold: 3,
  },
  network: {
    /** No frame for this long and the node is STALE. */
    staleMs: 8_000,
    /** No frame for this long and the node is OFFLINE. */
    offlineMs: 20_000,
    packetLossWarningPercent: 5,
    packetLossCriticalPercent: 20,
    latencyWarningMs: 800,
    latencyCriticalMs: 3_000,
  },
  system: {
    /** Net deficit (W) sustained before an energy-deficit alert. */
    energyDeficitW: 50,
  },
} as const;

// ---------------------------------------------------------------------------
// Simulation defaults
// ---------------------------------------------------------------------------

export const SIMULATION_DEFAULTS = {
  intervalMs: 1_000,
  /** 60 = one simulated hour per real minute, so a demo sees a full solar day. */
  speed: 60,
  nodeCount: 4,
  scenario: 'NORMAL' as ScenarioId,
  /** Frames retained in the in-memory rolling window per node (for trends). */
  historyWindow: 120,
} as const;

/** Rolling window used for trend features and rate-of-change rules. */
export const TREND_WINDOW = 20;

// ---------------------------------------------------------------------------
// Billing / impact assumptions.
// These are ASSUMPTIONS, surfaced as such everywhere they influence a number.
// Indicative Indian residential values; user-editable in Settings.
// ---------------------------------------------------------------------------

export const DEFAULT_BILLING: BillingAssumptions = {
  tariffPerKwh: 8.0,
  fixedCharge: 100,
  additionalChargeRate: 0.05,
  dieselPricePerLitre: 95,
  generatorKwhPerLitre: 3.2,
  gridEmissionFactor: 0.71,
  currency: 'INR',
};

// ---------------------------------------------------------------------------
// Scenario catalogue
// ---------------------------------------------------------------------------

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  NORMAL: {
    id: 'NORMAL',
    name: 'Normal Operation',
    description: 'All nodes healthy. Generation follows the daily solar curve and the battery buffers the load.',
    expectedEffects: ['Nodes report ONLINE', 'Efficiency near the modelled expectation', 'No new rule alerts'],
    severity: 'NORMAL',
  },
  SOLAR_FAULT: {
    id: 'SOLAR_FAULT',
    name: 'Solar Fault',
    description: 'Irradiance stays high but the array delivers far less power than the model expects.',
    expectedEffects: [
      'Lux remains high',
      'Solar current and power collapse',
      'Computed efficiency falls sharply',
      'Rule SOLAR_LOW_YIELD fires; model leans SOLAR_SOILING / SOLAR_SHADING',
    ],
    severity: 'CRITICAL',
  },
  BATTERY_FAULT: {
    id: 'BATTERY_FAULT',
    name: 'Battery Fault',
    description: 'Pack voltage decouples from SOC and charge acceptance degrades.',
    expectedEffects: [
      'Voltage no longer tracks SOC',
      'Charge/discharge current becomes erratic',
      'Pack temperature climbs',
      'Rule BATTERY_ABNORMAL_VOLTAGE fires',
    ],
    severity: 'CRITICAL',
  },
  OVERLOAD: {
    id: 'OVERLOAD',
    name: 'Load Overload',
    description: 'Load branches draw well beyond their rated power.',
    expectedEffects: [
      'Load current and power rise above rating',
      'Net power goes strongly negative',
      'Battery SOC falls faster',
      'Rule LOAD_OVERLOAD fires as CRITICAL',
    ],
    severity: 'CRITICAL',
  },
  NETWORK_FAILURE: {
    id: 'NETWORK_FAILURE',
    name: 'Network Failure',
    description: 'Node heartbeats become intermittent: packet loss, duplicates and rising latency.',
    expectedEffects: [
      'Frames are dropped and occasionally duplicated',
      'Nodes transition ONLINE -> STALE -> OFFLINE',
      'System health shows degraded communication',
      'EDGE MODE ACTIVE is displayed',
    ],
    severity: 'CRITICAL',
  },
  BROWNOUT: {
    id: 'BROWNOUT',
    name: 'Brownout',
    description: 'Bus voltage sags under load while current stays high.',
    expectedEffects: ['Load voltage drops below the brownout ratio', 'Rule LOAD_BROWNOUT fires'],
    severity: 'WARNING',
  },
  SENSOR_FAILURE: {
    id: 'SENSOR_FAILURE',
    name: 'Sensor Failure',
    description: 'A sensor reports physically impossible values (e.g. DS18B20 returning -127 degC).',
    expectedEffects: [
      'Frames arrive but fail validation',
      'Telemetry is flagged invalid and withheld from ML training',
      'Classified as SENSOR fault, explicitly not a communication fault',
    ],
    severity: 'WARNING',
  },
  PANEL_SOILING: {
    id: 'PANEL_SOILING',
    name: 'Panel Soiling',
    description: 'Gradual accumulation of dust progressively derates the array.',
    expectedEffects: ['Efficiency decays slowly over time', 'Lux unaffected', 'Maintenance recommendation appears'],
    severity: 'WARNING',
  },
  BATTERY_OVERHEATING: {
    id: 'BATTERY_OVERHEATING',
    name: 'Battery Overheating',
    description: 'Pack temperature rises steadily beyond its safe operating limit.',
    expectedEffects: ['Battery temperature crosses 45 degC', 'Rule BATTERY_OVERTEMP fires as CRITICAL'],
    severity: 'CRITICAL',
  },
  HIGH_DEMAND: {
    id: 'HIGH_DEMAND',
    name: 'High Demand',
    description: 'A sustained evening demand peak without an outright overload.',
    expectedEffects: ['Load rises toward rating', 'Battery discharges continuously', 'Load-shifting recommendation appears'],
    severity: 'WARNING',
  },
  NIGHT_MODE: {
    id: 'NIGHT_MODE',
    name: 'Night Mode',
    description: 'Forces the simulated clock to night: no generation, battery carries the load.',
    expectedEffects: ['Solar power near zero', 'Lux near zero', 'Battery discharging', 'No false solar-fault alerts'],
    severity: 'NORMAL',
  },
};

export const SCENARIO_LIST = Object.values(SCENARIOS);

/** Collection names. Kept in one place so scripts and API cannot drift. */
export const COLLECTIONS = {
  users: 'users',
  nodes: 'nodes',
  telemetry: 'telemetry',
  alerts: 'alerts',
  predictions: 'predictions',
  maintenance: 'maintenance',
  systemEvents: 'system_events',
  simulationState: 'simulation_state',
  usageRecords: 'usage_records',
  settings: 'settings',
} as const;
