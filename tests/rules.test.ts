/**
 * Rule engine, validation and RBAC tests.
 *
 * These cover the parts that must not silently regress: the safety rules, the
 * sensor-vs-communication distinction, and the permission matrix.
 */

import { describe, expect, it } from 'vitest';

import { RULES, getRule } from '../shared/rules/definitions';
import {
  RuleEngine,
  createCommState,
  deriveNodeStatus,
  recordFrameArrival,
} from '../shared/rules/engine';
import { validateFrame, normaliseFrame } from '../shared/validation';
import { expectedSolarPower } from '../shared/physics';
import { getNodeConfig } from '../shared/nodes.config';
import { DS18B20_ERROR_VALUE, THRESHOLDS } from '../shared/constants';
import { can, permissionsFor, roleForEmail } from '../server/auth';
import type { EnrichedFrame, NodeConfig, SystemSnapshot } from '../shared/types';

const SOLAR = getNodeConfig('sigma')!;
const BATTERY = getNodeConfig('beta')!;
const DC_LOAD = getNodeConfig('dc_load')!;

function frame(node: NodeConfig, overrides: Partial<EnrichedFrame> = {}): EnrichedFrame {
  const voltage = overrides.voltage ?? node.nominalVoltage;
  const current = overrides.current ?? 1;
  return {
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
    voltage,
    current,
    power: overrides.power ?? voltage * current,
    status: 'ONLINE',
    mode: 'SIMULATION',
    source: 'SIMULATION',
    sequenceNumber: 1,
    valid: true,
    ageMs: 0,
    ...overrides,
  };
}

const SNAPSHOT: SystemSnapshot = {
  timestamp: new Date().toISOString(),
  mode: 'SIMULATION',
  scenario: 'NORMAL',
  generationW: 100,
  consumptionW: 80,
  netPowerW: 20,
  batterySoc: 70,
  batteryPowerW: 20,
  batteryState: 'CHARGING',
  acLoadW: 50,
  dcLoadW: 30,
  systemEfficiency: 0.8,
  nodesOnline: 4,
  nodesTotal: 4,
  activeAlerts: { info: 0, warning: 0, critical: 0 },
  edgeMode: false,
};

/** Build a plausible history window so trend-based rules have data. */
function history(node: NodeConfig, count: number, build: (i: number) => Partial<EnrichedFrame>) {
  const out: EnrichedFrame[] = [];
  const base = Date.now() - count * 1000;
  for (let i = 0; i < count; i++) {
    out.push(
      frame(node, { timestamp: new Date(base + i * 1000).toISOString(), ...build(i) }),
    );
  }
  return out;
}

describe('rule definitions', () => {
  it('all have unique ids', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all declare a severity, source and condition', () => {
    for (const rule of RULES) {
      expect(rule.severity).toMatch(/INFO|WARNING|CRITICAL/);
      expect(rule.source).toMatch(/RULE|ML|SYSTEM|COMMUNICATION/);
      expect(rule.condition.length).toBeGreaterThan(0);
      expect(rule.name.length).toBeGreaterThan(0);
    }
  });

  it('are retrievable by id', () => {
    expect(getRule('BATTERY_LOW_SOC')).toBeDefined();
    expect(getRule('NOT_A_RULE')).toBeUndefined();
  });
});

describe('solar rules', () => {
  const ctxBase = { snapshot: SNAPSHOT, solarElevation: 0.9 };

  it('SOLAR_LOW_YIELD fires when irradiance is high but yield is poor', () => {
    const rule = getRule('SOLAR_LOW_YIELD')!;
    const f = frame(SOLAR, { lux: 80_000, temperature: 40, voltage: 17, current: 0.5, power: 8.5 });
    const hit = rule.evaluate({
      ...ctxBase,
      frame: f,
      node: SOLAR,
      history: history(SOLAR, 12, () => ({ power: 8.5, lux: 80_000, temperature: 40 })),
    });
    expect(hit).not.toBeNull();
    expect(hit!.recommendedAction).toMatch(/soiling|shading|inspect/i);
  });

  it('SOLAR_LOW_YIELD stays silent at night', () => {
    const rule = getRule('SOLAR_LOW_YIELD')!;
    const f = frame(SOLAR, { lux: 0, temperature: 22, voltage: 0.4, current: 0, power: 0 });
    expect(
      rule.evaluate({ ...ctxBase, solarElevation: 0, frame: f, node: SOLAR, history: [] }),
    ).toBeNull();
  });

  it('SOLAR_LOW_YIELD stays silent when yield matches the model', () => {
    const rule = getRule('SOLAR_LOW_YIELD')!;
    // Derive the healthy figure from the model rather than hardcoding a watt
    // value — otherwise the test breaks whenever the array is resized, which
    // tells us nothing about the rule.
    const lux = 80_000;
    const temperature = 30;
    const healthy = expectedSolarPower(SOLAR, lux, temperature);
    const voltage = 17.5;
    const f = frame(SOLAR, {
      lux,
      temperature,
      voltage,
      current: healthy / voltage,
      power: healthy,
    });
    expect(
      rule.evaluate({
        ...ctxBase,
        frame: f,
        node: SOLAR,
        history: history(SOLAR, 12, () => ({ power: healthy, lux, temperature })),
      }),
    ).toBeNull();
  });

  it('SOLAR_OVERTEMP fires above the warning threshold', () => {
    const rule = getRule('SOLAR_OVERTEMP')!;
    const f = frame(SOLAR, { temperature: THRESHOLDS.solar.temperatureWarning + 5, lux: 70_000 });
    expect(rule.evaluate({ ...ctxBase, frame: f, node: SOLAR, history: [] })).not.toBeNull();
  });
});

describe('battery rules', () => {
  const ctxBase = { snapshot: SNAPSHOT, solarElevation: 0.5 };

  it('BATTERY_CRITICAL_SOC fires below the critical threshold', () => {
    const rule = getRule('BATTERY_CRITICAL_SOC')!;
    const f = frame(BATTERY, { soc: 15, voltage: 11.8, current: -5 });
    const hit = rule.evaluate({ ...ctxBase, frame: f, node: BATTERY, history: [] });
    expect(hit).not.toBeNull();
    expect(hit!.recommendedAction).toMatch(/shed|critical/i);
  });

  it('BATTERY_LOW_SOC does not double-fire in the critical band', () => {
    // The critical rule owns that band; the warning rule must defer.
    const warning = getRule('BATTERY_LOW_SOC')!;
    const f = frame(BATTERY, { soc: 15 });
    expect(warning.evaluate({ ...ctxBase, frame: f, node: BATTERY, history: [] })).toBeNull();
  });

  it('BATTERY_OVERTEMP fires above the critical temperature', () => {
    const rule = getRule('BATTERY_OVERTEMP')!;
    const f = frame(BATTERY, { temperature: THRESHOLDS.battery.temperatureCritical + 3, soc: 60 });
    expect(rule.evaluate({ ...ctxBase, frame: f, node: BATTERY, history: [] })).not.toBeNull();
  });

  it('BATTERY_ABNORMAL_VOLTAGE fires when voltage decouples from SOC at rest', () => {
    const rule = getRule('BATTERY_ABNORMAL_VOLTAGE')!;
    // 80 % SOC implies ~12.45 V; 11.6 V is a large deviation.
    const f = frame(BATTERY, { soc: 80, voltage: 11.6, current: 0.5 });
    expect(rule.evaluate({ ...ctxBase, frame: f, node: BATTERY, history: [] })).not.toBeNull();
  });

  it('BATTERY_ABNORMAL_VOLTAGE stays silent under heavy current', () => {
    // Under load, IR drop legitimately separates terminal voltage from OCV.
    const rule = getRule('BATTERY_ABNORMAL_VOLTAGE')!;
    const f = frame(BATTERY, { soc: 80, voltage: 11.6, current: -20 });
    expect(rule.evaluate({ ...ctxBase, frame: f, node: BATTERY, history: [] })).toBeNull();
  });

  it('BATTERY_RAPID_SOC_DECLINE fires on a steep downward trend', () => {
    const rule = getRule('BATTERY_RAPID_SOC_DECLINE')!;
    // Drop 3 %/min over the window.
    const hist = history(BATTERY, 40, (i) => ({ soc: 80 - i * 0.05 }));
    const f = hist[hist.length - 1];
    expect(rule.evaluate({ ...ctxBase, frame: f, node: BATTERY, history: hist })).not.toBeNull();
  });

  it('BATTERY_RAPID_SOC_DECLINE stays silent on a stable pack', () => {
    const rule = getRule('BATTERY_RAPID_SOC_DECLINE')!;
    const hist = history(BATTERY, 40, () => ({ soc: 70 }));
    const f = hist[hist.length - 1];
    expect(rule.evaluate({ ...ctxBase, frame: f, node: BATTERY, history: hist })).toBeNull();
  });
});

describe('load rules', () => {
  const ctxBase = { snapshot: SNAPSHOT, solarElevation: 0.5 };

  it('LOAD_OVERLOAD fires above the overload ratio', () => {
    const rule = getRule('LOAD_OVERLOAD')!;
    const overloadW = DC_LOAD.ratedPower * (THRESHOLDS.load.overloadRatio + 0.2);
    const f = frame(DC_LOAD, { power: overloadW, voltage: 12, current: overloadW / 12 });
    const hit = rule.evaluate({ ...ctxBase, frame: f, node: DC_LOAD, history: [] });
    expect(hit).not.toBeNull();
    // A non-critical branch must be labelled as a recommendation, not an action.
    expect(hit!.recommendedAction).toMatch(/Recommended \/ Simulated Action/);
  });

  it('LOAD_OVERLOAD stays silent at rated load', () => {
    const rule = getRule('LOAD_OVERLOAD')!;
    const f = frame(DC_LOAD, { power: DC_LOAD.ratedPower * 0.9, voltage: 12, current: 11 });
    expect(rule.evaluate({ ...ctxBase, frame: f, node: DC_LOAD, history: [] })).toBeNull();
  });

  it('LOAD_BROWNOUT fires when voltage sags', () => {
    const rule = getRule('LOAD_BROWNOUT')!;
    const f = frame(DC_LOAD, { voltage: DC_LOAD.nominalVoltage * 0.8, current: 5 });
    expect(rule.evaluate({ ...ctxBase, frame: f, node: DC_LOAD, history: [] })).not.toBeNull();
  });
});

describe('sensor validation', () => {
  it('accepts a healthy frame', () => {
    const f = frame(SOLAR, { voltage: 17.5, current: 4, power: 70, temperature: 45, lux: 80_000 });
    expect(validateFrame(f, SOLAR).valid).toBe(true);
  });

  it('rejects the DS18B20 bus-failure value specifically', () => {
    const f = frame(SOLAR, { temperature: DS18B20_ERROR_VALUE, lux: 50_000 });
    const result = validateFrame(f, SOLAR);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('DS18B20');
  });

  it('rejects impossible illuminance', () => {
    const f = frame(SOLAR, { lux: 999_999 });
    expect(validateFrame(f, SOLAR).valid).toBe(false);
  });

  it('rejects an out-of-range SOC', () => {
    const f = frame(BATTERY, { soc: 150 });
    expect(validateFrame(f, BATTERY).valid).toBe(false);
  });

  it('rejects power inconsistent with V x I', () => {
    const f = frame(DC_LOAD, { voltage: 12, current: 5, power: 500 });
    const result = validateFrame(f, DC_LOAD);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/inconsistent/i);
  });

  it('rejects a missing required field', () => {
    const result = validateFrame({ nodeId: 'sigma', nodeType: 'SOLAR' }, SOLAR);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Missing required field/);
  });

  it('rejects a timestamp from the future', () => {
    const f = frame(SOLAR, { timestamp: new Date(Date.now() + 3600_000).toISOString() });
    expect(validateFrame(f, SOLAR).valid).toBe(false);
  });

  it('normalises an untrusted payload and flags it', () => {
    const normalised = normaliseFrame(
      { nodeId: 'beta', voltage: 12.4, current: 2, soc: 200 },
      BATTERY,
      'ESP32',
    );
    expect(normalised.valid).toBe(false);
    expect(normalised.validationErrors?.length).toBeGreaterThan(0);
    expect(normalised.source).toBe('ESP32');
    // Power is computed when the device omits it.
    expect(normalised.power).toBeCloseTo(24.8, 5);
  });
});

describe('communication tracking', () => {
  it('detects a duplicate by repeated sequence number', () => {
    const state = createCommState('sigma');
    const now = Date.now();
    expect(recordFrameArrival(state, 1, now, now)).toBe(false);
    expect(recordFrameArrival(state, 2, now, now)).toBe(false);
    // Same sequence again: duplicate.
    expect(recordFrameArrival(state, 2, now, now)).toBe(true);
    expect(state.duplicatesSeen).toBe(1);
  });

  it('counts sequence gaps as expected-but-missing frames', () => {
    const state = createCommState('sigma');
    const now = Date.now();
    recordFrameArrival(state, 1, now, now);
    // Jump from 1 to 6: four frames were lost.
    recordFrameArrival(state, 6, now, now);
    expect(state.framesReceived).toBe(2);
    expect(state.framesExpected).toBe(6);
  });

  it('derives node status from age', () => {
    const now = Date.now();
    expect(deriveNodeStatus(now, now)).toBe('ONLINE');
    expect(deriveNodeStatus(now - THRESHOLDS.network.staleMs - 1000, now)).toBe('STALE');
    expect(deriveNodeStatus(now - THRESHOLDS.network.offlineMs - 1000, now)).toBe('OFFLINE');
    expect(deriveNodeStatus(null, now)).toBe('OFFLINE');
  });

  it('reports FAULT for a fresh but invalid frame', () => {
    const now = Date.now();
    expect(deriveNodeStatus(now, now, false)).toBe('FAULT');
  });
});

describe('rule engine', () => {
  function evaluateOnce(frames: EnrichedFrame[], nodes: NodeConfig[]) {
    const engine = new RuleEngine(0); // no cooldown, for deterministic tests
    const commState = new Map(nodes.map((n) => [n.id, createCommState(n.id)]));
    for (const f of frames) {
      recordFrameArrival(commState.get(f.nodeId)!, f.sequenceNumber, Date.now(), Date.now());
    }
    return engine.evaluate({
      frames,
      nodes,
      history: new Map(nodes.map((n) => [n.id, frames.filter((f) => f.nodeId === n.id)])),
      snapshot: SNAPSHOT,
      solarElevation: 0.9,
      commState,
    });
  }

  it('raises an alert for a critical battery condition', () => {
    const f = frame(BATTERY, { soc: 12, voltage: 11.6, current: -5 });
    const alerts = evaluateOnce([f], [BATTERY]);
    expect(alerts.some((a) => a.ruleId === 'BATTERY_CRITICAL_SOC')).toBe(true);
  });

  it('marks rule alerts as DETECTED, never PREDICTED', () => {
    const f = frame(BATTERY, { soc: 12 });
    for (const alert of evaluateOnce([f], [BATTERY])) {
      expect(alert.kind).toBe('DETECTED');
    }
  });

  it('routes an invalid frame to the sensor rule and away from process rules', () => {
    const f = frame(BATTERY, {
      temperature: DS18B20_ERROR_VALUE,
      soc: 60,
      valid: false,
      validationErrors: ['Temperature reads -127 degC (DS18B20 bus read failure)'],
    });
    const alerts = evaluateOnce([f], [BATTERY]);

    expect(alerts.some((a) => a.ruleId === 'SENSOR_INVALID_READING')).toBe(true);
    // The bogus -127 must NOT trip any temperature process rule.
    expect(alerts.some((a) => a.ruleId === 'BATTERY_OVERTEMP')).toBe(false);
  });

  it('describes a sensor fault as distinct from a communication fault', () => {
    const f = frame(SOLAR, {
      valid: false,
      validationErrors: ['Temperature reads -127 degC (DS18B20 bus read failure)'],
    });
    const alert = evaluateOnce([f], [SOLAR]).find((a) => a.ruleId === 'SENSOR_INVALID_READING');
    expect(alert).toBeDefined();
    expect(alert!.likelyCause).toMatch(/SENSOR fault/);
    expect(alert!.likelyCause).toMatch(/communication is working|distinct from a communication/i);
  });

  it('suppresses repeats within the cooldown window', () => {
    const engine = new RuleEngine(60_000);
    const commState = new Map([['beta', createCommState('beta')]]);
    const f = frame(BATTERY, { soc: 12 });
    const input = {
      frames: [f],
      nodes: [BATTERY],
      history: new Map([['beta', [f]]]),
      snapshot: SNAPSHOT,
      solarElevation: 0.5,
      commState,
    };

    const first = engine.evaluate(input);
    const second = engine.evaluate(input);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toHaveLength(0);
  });

  it('re-arms immediately after a reset, so a scenario switch is visible', () => {
    const engine = new RuleEngine(60_000);
    const commState = new Map([['beta', createCommState('beta')]]);
    const f = frame(BATTERY, { soc: 12 });
    const input = {
      frames: [f],
      nodes: [BATTERY],
      history: new Map([['beta', [f]]]),
      snapshot: SNAPSHOT,
      solarElevation: 0.5,
      commState,
    };

    expect(engine.evaluate(input).length).toBeGreaterThan(0);
    expect(engine.evaluate(input)).toHaveLength(0);
    engine.reset();
    expect(engine.evaluate(input).length).toBeGreaterThan(0);
  });

  it('raises a COMMUNICATION alert for a stale node', () => {
    const engine = new RuleEngine(0);
    const state = createCommState('sigma');
    state.lastSeen = Date.now() - THRESHOLDS.network.offlineMs - 5000;

    const alerts = engine.evaluate({
      frames: [],
      nodes: [SOLAR],
      history: new Map(),
      snapshot: SNAPSHOT,
      solarElevation: 0.9,
      commState: new Map([['sigma', state]]),
    });

    const offline = alerts.find((a) => a.ruleId === 'COMM_NODE_OFFLINE');
    expect(offline).toBeDefined();
    expect(offline!.source).toBe('COMMUNICATION');
    expect(offline!.likelyCause).toMatch(/COMMUNICATION fault/);
  });
});

describe('role-based access control', () => {
  it('gives ADMIN every permission', () => {
    for (const p of permissionsFor('ADMIN')) expect(can('ADMIN', p)).toBe(true);
    expect(can('ADMIN', 'users:manage')).toBe(true);
    expect(can('ADMIN', 'simulation:control')).toBe(true);
  });

  it('denies a VIEWER every write action', () => {
    expect(can('VIEWER', 'alerts:acknowledge')).toBe(false);
    expect(can('VIEWER', 'alerts:resolve')).toBe(false);
    expect(can('VIEWER', 'simulation:control')).toBe(false);
    expect(can('VIEWER', 'settings:write')).toBe(false);
    expect(can('VIEWER', 'users:manage')).toBe(false);
    // But read access is intact.
    expect(can('VIEWER', 'view:dashboard')).toBe(true);
    expect(can('VIEWER', 'view:analytics')).toBe(true);
  });

  it('lets an OPERATOR acknowledge and resolve', () => {
    expect(can('OPERATOR', 'alerts:acknowledge')).toBe(true);
    expect(can('OPERATOR', 'alerts:resolve')).toBe(true);
    expect(can('OPERATOR', 'users:manage')).toBe(false);
  });

  it('gives a TECHNICIAN diagnostics but not resolve', () => {
    expect(can('TECHNICIAN', 'view:diagnostics')).toBe(true);
    expect(can('TECHNICIAN', 'view:maintenance')).toBe(true);
    expect(can('TECHNICIAN', 'alerts:acknowledge')).toBe(true);
    // Deliberately narrower than OPERATOR.
    expect(can('TECHNICIAN', 'alerts:resolve')).toBe(false);
    expect(can('TECHNICIAN', 'simulation:control')).toBe(false);
  });

  it('defaults an unlisted Google email to VIEWER', () => {
    expect(roleForEmail('someone@example.com')).toBe('VIEWER');
  });
});
