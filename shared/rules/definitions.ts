/**
 * GridSync deterministic rule definitions.
 *
 * THESE RULES ARE SAFETY LOGIC. They are deterministic, auditable, and they run
 * regardless of whether any ML model exists or is healthy. The ML model NEVER
 * replaces, suppresses or overrides a rule — it only adds a separate, clearly
 * labelled opinion. See docs/ARCHITECTURE.md ("Rules vs ML").
 *
 * Every rule:
 *   - has a stable id (used for de-duplication and acknowledgement)
 *   - reads its thresholds from shared/constants.ts (no magic numbers)
 *   - states a LIKELY cause, phrased as a hypothesis, never as a finding
 *   - recommends an action a human can actually take
 */

import { THRESHOLDS } from '../constants';
import { expectedSolarPower } from '../physics';
import type { RuleContext, RuleDefinition, RuleHit } from '../types';

/** Mean of the last `n` values of a numeric field, ignoring undefined. */
function recentMean(ctx: RuleContext, pick: (f: RuleContext['history'][number]) => number | undefined, n: number): number | null {
  const values = ctx.history.slice(-n).map(pick).filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Linear slope (units per minute) of a field over the recent window. */
function slopePerMinute(
  ctx: RuleContext,
  pick: (f: RuleContext['history'][number]) => number | undefined,
  n: number,
): number | null {
  const points = ctx.history
    .slice(-n)
    .map((f) => ({ t: new Date(f.timestamp).getTime(), v: pick(f) }))
    .filter((p): p is { t: number; v: number } => typeof p.v === 'number');
  if (points.length < 3) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 60_000);
  const ys = points.map((p) => p.v);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

export const RULES: RuleDefinition[] = [
  // =========================================================================
  // SOLAR
  // =========================================================================
  {
    id: 'SOLAR_LOW_YIELD',
    name: 'Generation below irradiance expectation',
    appliesTo: ['SOLAR'],
    severity: 'WARNING',
    source: 'RULE',
    condition: 'lux >= daylightThreshold AND measured/expected power < efficiencyWarning',
    evaluate(ctx): RuleHit | null {
      const { frame, node } = ctx;
      if (frame.lux === undefined || frame.lux < THRESHOLDS.solar.daylightLuxThreshold) return null;
      const expected = expectedSolarPower(node, frame.lux, frame.temperature ?? 25);
      if (expected <= 1) return null;
      const ratio = frame.power / expected;
      if (ratio >= THRESHOLDS.solar.efficiencyWarning) return null;

      // Sustained, not a single sample — avoids alerting on a passing cloud.
      const meanPower = recentMean(ctx, (f) => f.power, 10);
      if (meanPower !== null && meanPower / expected >= THRESHOLDS.solar.efficiencyWarning) return null;

      return {
        actualValue: Math.round(ratio * 100),
        expectedValue: Math.round(THRESHOLDS.solar.efficiencyWarning * 100),
        unit: '%',
        message: `${node.shortName} is delivering ${frame.power.toFixed(1)} W against a modelled expectation of ${expected.toFixed(1)} W at ${Math.round(frame.lux)} lx.`,
        likelyCause:
          'Irradiance is adequate but yield is not, which is consistent with panel soiling, partial shading, or a degraded string connection. This is an inference from the power/irradiance relationship, not a confirmed physical inspection.',
        recommendedAction:
          'Inspect the panel surface for dust or soiling, check for new shading obstructions, and verify string wiring and connector integrity.',
      };
    },
  },
  {
    id: 'SOLAR_ZERO_YIELD_DAYLIGHT',
    name: 'No generation during expected daylight',
    appliesTo: ['SOLAR'],
    severity: 'CRITICAL',
    source: 'RULE',
    condition: 'solarElevation > 0.25 AND lux >= daylightThreshold AND power < 1 W sustained',
    evaluate(ctx): RuleHit | null {
      const { frame, node, solarElevation } = ctx;
      if (solarElevation < 0.25) return null;
      if (frame.lux === undefined || frame.lux < THRESHOLDS.solar.daylightLuxThreshold) return null;
      if (frame.power >= 1) return null;
      const meanPower = recentMean(ctx, (f) => f.power, 8);
      if (meanPower === null || meanPower >= 1) return null;

      return {
        actualValue: frame.power,
        expectedValue: expectedSolarPower(node, frame.lux, frame.temperature ?? 25),
        unit: 'W',
        message: `${node.shortName} is producing no measurable power despite ${Math.round(frame.lux)} lx of available irradiance.`,
        likelyCause:
          'Possible open circuit, tripped protection device, disconnected string, or failed MPPT stage. Requires physical verification.',
        recommendedAction:
          'Check the array isolator and protection devices, verify open-circuit voltage at the combiner, and inspect the charge controller for fault indications.',
      };
    },
  },
  {
    id: 'SOLAR_OVERTEMP',
    name: 'Panel temperature high',
    appliesTo: ['SOLAR'],
    severity: 'WARNING',
    source: 'RULE',
    condition: 'temperature > solar.temperatureWarning',
    evaluate(ctx): RuleHit | null {
      const t = ctx.frame.temperature;
      if (t === undefined || t <= THRESHOLDS.solar.temperatureWarning) return null;
      const critical = t > THRESHOLDS.solar.temperatureCritical;
      return {
        actualValue: t,
        expectedValue: THRESHOLDS.solar.temperatureWarning,
        unit: 'degC',
        message: `${ctx.node.shortName} cell temperature is ${t.toFixed(1)} degC${critical ? ' (above the critical limit)' : ''}.`,
        likelyCause:
          'The temperature itself is measured; the cause is not. It is consistent with high ambient temperature combined with restricted airflow behind the module. Output derates by roughly 0.4 % per degC above 25 degC.',
        recommendedAction:
          'Verify the mounting standoff allows rear ventilation and confirm there is no accumulated debris trapping heat under the array.',
      };
    },
  },
  {
    id: 'SOLAR_VOLTAGE_DROP',
    name: 'Unexpected array voltage drop',
    appliesTo: ['SOLAR'],
    severity: 'WARNING',
    source: 'RULE',
    condition: 'lux adequate AND voltage < 60 % of nominal',
    evaluate(ctx): RuleHit | null {
      const { frame, node } = ctx;
      if (frame.lux === undefined || frame.lux < THRESHOLDS.solar.daylightLuxThreshold) return null;
      const floor = node.nominalVoltage * 0.6;
      if (frame.voltage >= floor) return null;
      return {
        actualValue: frame.voltage,
        expectedValue: Math.round(floor * 10) / 10,
        unit: 'V',
        message: `${node.shortName} array voltage is ${frame.voltage.toFixed(2)} V, well below the expected operating point in present light.`,
        likelyCause:
          'Consistent with a bypass diode conducting, a shorted module, or a high-resistance joint in the string.',
        recommendedAction:
          'Measure per-module voltage across the string to locate the deviation, and thermally inspect junction boxes for hot joints.',
      };
    },
  },

  // =========================================================================
  // BATTERY
  // =========================================================================
  {
    id: 'BATTERY_LOW_SOC',
    name: 'Battery state of charge low',
    appliesTo: ['BATTERY'],
    severity: 'WARNING',
    source: 'RULE',
    condition: 'soc < battery.socWarning',
    evaluate(ctx): RuleHit | null {
      const soc = ctx.frame.soc;
      if (soc === undefined || soc >= THRESHOLDS.battery.socWarning) return null;
      if (soc < THRESHOLDS.battery.socCritical) return null; // handled by the critical rule
      return {
        actualValue: soc,
        expectedValue: THRESHOLDS.battery.socWarning,
        unit: '%',
        message: `${ctx.node.shortName} state of charge is ${soc.toFixed(1)} %.`,
        likelyCause:
          'Consistent with demand having exceeded generation for a sustained period, or with charging having been limited. The state of charge is measured; the reason for it is inferred.',
        recommendedAction:
          'Reduce non-critical load to preserve reserve capacity and confirm the array is charging normally.',
      };
    },
  },
  {
    id: 'BATTERY_CRITICAL_SOC',
    name: 'Battery state of charge critical',
    appliesTo: ['BATTERY'],
    severity: 'CRITICAL',
    source: 'RULE',
    condition: 'soc < battery.socCritical',
    evaluate(ctx): RuleHit | null {
      const soc = ctx.frame.soc;
      if (soc === undefined || soc >= THRESHOLDS.battery.socCritical) return null;
      return {
        actualValue: soc,
        expectedValue: THRESHOLDS.battery.socCritical,
        unit: '%',
        message: `${ctx.node.shortName} state of charge is ${soc.toFixed(1)} %, inside the deep-discharge region.`,
        likelyCause:
          'Consistent with a sustained energy deficit. Continued discharge below this level is known to accelerate permanent capacity loss in a lead-acid bank.',
        recommendedAction:
          'Shed non-critical load immediately and prioritise critical branches until the bank recovers above 40 %.',
      };
    },
  },
  {
    id: 'BATTERY_OVERTEMP',
    name: 'Battery temperature above limit',
    appliesTo: ['BATTERY'],
    severity: 'CRITICAL',
    source: 'RULE',
    condition: 'temperature > battery.temperatureCritical',
    evaluate(ctx): RuleHit | null {
      const t = ctx.frame.temperature;
      if (t === undefined || t <= THRESHOLDS.battery.temperatureCritical) return null;
      return {
        actualValue: t,
        expectedValue: THRESHOLDS.battery.temperatureCritical,
        unit: 'degC',
        message: `${ctx.node.shortName} pack temperature is ${t.toFixed(1)} degC, above the ${THRESHOLDS.battery.temperatureCritical} degC limit.`,
        likelyCause:
          'Possible causes, in order of likelihood: excessive charge or discharge current, elevated ambient temperature, inadequate ventilation, or an internal cell fault. Only inspection can distinguish them.',
        recommendedAction:
          'Reduce charge and discharge current, verify enclosure ventilation, and inspect for cell swelling or electrolyte loss before returning to service.',
      };
    },
  },
  {
    id: 'BATTERY_OVERCHARGE_VOLTAGE',
    name: 'Abnormal charging voltage',
    appliesTo: ['BATTERY'],
    severity: 'CRITICAL',
    source: 'RULE',
    condition: 'voltage > battery.overchargeVoltage while charging',
    evaluate(ctx): RuleHit | null {
      const { frame } = ctx;
      if (frame.current <= 0) return null;
      if (frame.voltage <= THRESHOLDS.battery.overchargeVoltage) return null;
      return {
        actualValue: frame.voltage,
        expectedValue: THRESHOLDS.battery.overchargeVoltage,
        unit: 'V',
        message: `${ctx.node.shortName} terminal voltage reached ${frame.voltage.toFixed(2)} V while charging.`,
        likelyCause:
          'Charge controller regulation setpoint may be misconfigured or the regulation stage may have failed. Sustained overcharge causes gassing and water loss.',
        recommendedAction:
          'Verify the charge controller absorption and float setpoints against the battery datasheet and confirm the temperature compensation sensor is attached.',
      };
    },
  },
  {
    id: 'BATTERY_ABNORMAL_VOLTAGE',
    name: 'Terminal voltage inconsistent with state of charge',
    appliesTo: ['BATTERY'],
    severity: 'CRITICAL',
    source: 'RULE',
    condition: '|measured V - modelled OCV(soc)| > 0.45 V at low current',
    evaluate(ctx): RuleHit | null {
      const { frame, node } = ctx;
      if (frame.soc === undefined) return null;
      // Only meaningful near rest: under heavy current, IR drop legitimately
      // separates terminal voltage from open-circuit voltage.
      if (Math.abs(frame.current) > 3) return null;

      // Reuse the same OCV model the simulator and UI use.
      const ocv = ocvFromSoc(frame.soc);
      const deviation = frame.voltage - ocv;
      if (Math.abs(deviation) <= 0.45) return null;

      return {
        actualValue: Math.round(frame.voltage * 100) / 100,
        expectedValue: Math.round(ocv * 100) / 100,
        unit: 'V',
        message: `${node.shortName} reads ${frame.voltage.toFixed(2)} V at ${frame.soc.toFixed(0)} % SOC, where roughly ${ocv.toFixed(2)} V is expected.`,
        likelyCause:
          'Terminal voltage has decoupled from state of charge, which is consistent with a failing cell, sulfation, or elevated internal resistance. Not a confirmed diagnosis.',
        recommendedAction:
          'Perform a rested open-circuit voltage measurement per block and a capacity discharge test to identify a weak cell.',
      };
    },
  },
  {
    id: 'BATTERY_RAPID_SOC_DECLINE',
    name: 'State of charge falling abnormally fast',
    appliesTo: ['BATTERY'],
    severity: 'WARNING',
    source: 'RULE',
    condition: 'd(soc)/dt < -battery.rapidSocDeclinePerMin',
    evaluate(ctx): RuleHit | null {
      const slope = slopePerMinute(ctx, (f) => f.soc, 30);
      if (slope === null || slope > -THRESHOLDS.battery.rapidSocDeclinePerMin) return null;
      return {
        actualValue: Math.round(slope * 100) / 100,
        expectedValue: -THRESHOLDS.battery.rapidSocDeclinePerMin,
        unit: '%/min',
        message: `${ctx.node.shortName} state of charge is falling at ${Math.abs(slope).toFixed(2)} %/min.`,
        likelyCause:
          'Discharge rate exceeds the recent demand profile, which may indicate an unexpected load, a parasitic drain, or reduced usable capacity.',
        recommendedAction:
          'Compare branch currents against the expected load schedule to locate the additional draw, and consider shifting non-critical load.',
      };
    },
  },

  // =========================================================================
  // LOADS
  // =========================================================================
  {
    id: 'LOAD_OVERLOAD',
    name: 'Branch load above rating',
    appliesTo: ['AC_LOAD', 'DC_LOAD'],
    severity: 'CRITICAL',
    source: 'RULE',
    condition: 'power > ratedPower * load.overloadRatio',
    evaluate(ctx): RuleHit | null {
      const { frame, node } = ctx;
      const limit = node.ratedPower * THRESHOLDS.load.overloadRatio;
      if (frame.power <= limit) return null;
      const severe = frame.power > node.ratedPower * THRESHOLDS.load.criticalOverloadRatio;
      return {
        actualValue: Math.round(frame.power),
        expectedValue: Math.round(limit),
        unit: 'W',
        message: `${node.shortName} is drawing ${frame.power.toFixed(0)} W against a ${node.ratedPower} W rating${severe ? ' — severe overload' : ''}.`,
        likelyCause:
          'Consistent with more load having been connected than the branch is rated for, or with a connected appliance having developed a fault drawing excess current. The current is measured; which of these applies is not.',
        recommendedAction:
          node.criticality === 'CRITICAL'
            ? 'Investigate the connected appliances on this critical branch. Do not shed this branch without confirming the dependent loads.'
            : 'Recommended / Simulated Action: shed non-critical load on this branch to bring current within rating.',
      };
    },
  },
  {
    id: 'LOAD_BROWNOUT',
    name: 'Branch voltage below brownout threshold',
    appliesTo: ['AC_LOAD', 'DC_LOAD'],
    severity: 'WARNING',
    source: 'RULE',
    condition: 'voltage < nominalVoltage * load.brownoutRatio',
    evaluate(ctx): RuleHit | null {
      const { frame, node } = ctx;
      const floor = node.nominalVoltage * THRESHOLDS.load.brownoutRatio;
      if (frame.voltage >= floor) return null;
      return {
        actualValue: Math.round(frame.voltage * 100) / 100,
        expectedValue: Math.round(floor * 10) / 10,
        unit: 'V',
        message: `${node.shortName} bus voltage has sagged to ${frame.voltage.toFixed(1)} V (nominal ${node.nominalVoltage} V).`,
        likelyCause:
          'Supply cannot hold voltage under the present demand. Consistent with an undersized conductor, a depleted battery, or inverter current limiting.',
        recommendedAction:
          'Reduce branch demand and check conductor sizing and termination resistance between the source and this branch.',
      };
    },
  },
  {
    id: 'LOAD_REPEATED_SPIKES',
    name: 'Repeated demand spikes',
    appliesTo: ['AC_LOAD', 'DC_LOAD'],
    severity: 'INFO',
    source: 'RULE',
    condition: 'count(power > 1.3 * rolling mean) >= load.spikeCountThreshold in window',
    evaluate(ctx): RuleHit | null {
      const mean = recentMean(ctx, (f) => f.power, 30);
      if (mean === null || mean <= 5) return null;
      const spikes = ctx.history.slice(-30).filter((f) => f.power > mean * 1.3).length;
      if (spikes < THRESHOLDS.load.spikeCountThreshold) return null;
      return {
        actualValue: spikes,
        expectedValue: THRESHOLDS.load.spikeCountThreshold,
        unit: 'events',
        message: `${ctx.node.shortName} recorded ${spikes} demand spikes above 130 % of its recent average.`,
        likelyCause:
          'Consistent with cyclic switching of an inductive appliance such as a pump or compressor, or with an intermittent connection.',
        recommendedAction:
          'Identify the cycling appliance and consider scheduling it away from the evening demand peak.',
      };
    },
  },
  {
    id: 'SYSTEM_ENERGY_DEFICIT',
    name: 'Demand exceeds available generation',
    appliesTo: 'ALL',
    severity: 'WARNING',
    source: 'RULE',
    condition: 'netPowerW < -system.energyDeficitW sustained',
    evaluate(ctx): RuleHit | null {
      // System-wide: evaluate once, on the battery node, to avoid N duplicates.
      if (ctx.node.type !== 'BATTERY') return null;
      const { snapshot } = ctx;
      if (snapshot.netPowerW >= -THRESHOLDS.system.energyDeficitW) return null;
      return {
        actualValue: Math.round(snapshot.netPowerW),
        expectedValue: -THRESHOLDS.system.energyDeficitW,
        unit: 'W',
        message: `Microgrid demand exceeds generation by ${Math.abs(snapshot.netPowerW).toFixed(0)} W; the shortfall is being drawn from storage.`,
        likelyCause:
          'Normal after sunset. During daylight it suggests reduced generation or elevated demand.',
        recommendedAction:
          'Shift deferrable load into the generation window and verify the array is performing to expectation.',
      };
    },
  },

  // =========================================================================
  // SENSOR INTEGRITY  (data arrived, but it is not physically possible)
  // =========================================================================
  {
    id: 'SENSOR_INVALID_READING',
    name: 'Implausible sensor reading',
    appliesTo: 'ALL',
    severity: 'WARNING',
    source: 'SYSTEM',
    condition: 'frame.valid === false',
    evaluate(ctx): RuleHit | null {
      const { frame } = ctx;
      if (frame.valid) return null;
      const detail = (frame.validationErrors ?? []).join('; ');
      const isDs18b20 = detail.includes('DS18B20');
      return {
        unit: '',
        message: `${ctx.node.shortName} returned an implausible reading: ${detail || 'failed validation'}.`,
        likelyCause: isDs18b20
          ? 'The DS18B20 reported its bus-read failure value of -127 degC. This is a SENSOR fault — the frame arrived intact, so communication is working.'
          : 'A sensor reported a value outside its physical range. This is a SENSOR fault, distinct from a communication fault: the data arrived, but it cannot be true.',
        recommendedAction:
          'Inspect the sensor wiring and connector, verify the pull-up resistor and bus length, and replace the sensor if the fault persists. This reading has been excluded from analytics and model training.',
      };
    },
  },
];

/** Same piecewise OCV table as shared/physics.ts, inlined to avoid a cycle. */
function ocvFromSoc(soc: number): number {
  const curve: Array<[number, number]> = [
    [0, 11.5],
    [10, 11.8],
    [25, 12.0],
    [50, 12.2],
    [75, 12.4],
    [100, 12.75],
  ];
  const s = Math.max(0, Math.min(100, soc));
  for (let i = 0; i < curve.length - 1; i++) {
    const [s0, v0] = curve[i];
    const [s1, v1] = curve[i + 1];
    if (s >= s0 && s <= s1) return v0 + ((s - s0) / (s1 - s0)) * (v1 - v0);
  }
  return 12.75;
}

export function getRule(id: string): RuleDefinition | undefined {
  return RULES.find((r) => r.id === id);
}
