/**
 * Scenario coherence tests.
 *
 * The critical property: a scenario must change telemetry in a way that is
 * PHYSICALLY CONSISTENT, so the rule engine detects a real relationship rather
 * than a value someone overwrote. A solar fault that simply set power to zero
 * would pass a naive test while making the whole detection story fake.
 */

import { describe, expect, it } from 'vitest';

import { SimulationEngine } from '../shared/simulation/engine';
import { getScenarioModifiers, NEUTRAL_MODIFIERS } from '../shared/simulation/scenarios';
import { expectedSolarPower } from '../shared/physics';
import { getNodeConfig } from '../shared/nodes.config';
import { DS18B20_ERROR_VALUE, SCENARIOS, THRESHOLDS } from '../shared/constants';
import { validateFrame } from '../shared/validation';
import type { ScenarioId, TelemetryFrame } from '../shared/types';

const SOLAR = getNodeConfig('sigma')!;

/** Run a scenario for `ticks` and collect every frame produced. */
function run(
  scenario: ScenarioId,
  ticks = 60,
  options: { startTime?: Date; speed?: number; seed?: number } = {},
): TelemetryFrame[] {
  const engine = new SimulationEngine({
    nodeCount: 4,
    scenario,
    seed: options.seed ?? 314,
    speed: options.speed ?? 1,
    startTime: options.startTime ?? new Date('2026-04-12T12:00:00'),
  });
  const frames: TelemetryFrame[] = [];
  for (let i = 0; i < ticks; i++) frames.push(...engine.tick().frames);
  return frames;
}

describe('scenario catalogue', () => {
  it('defines every scenario referenced by the type union', () => {
    const ids: ScenarioId[] = [
      'NORMAL',
      'SOLAR_FAULT',
      'BATTERY_FAULT',
      'OVERLOAD',
      'NETWORK_FAILURE',
      'BROWNOUT',
      'SENSOR_FAILURE',
      'PANEL_SOILING',
      'BATTERY_OVERHEATING',
      'HIGH_DEMAND',
      'NIGHT_MODE',
    ];
    for (const id of ids) {
      expect(SCENARIOS[id]).toBeDefined();
      expect(SCENARIOS[id].expectedEffects.length).toBeGreaterThan(0);
    }
  });

  it('leaves NORMAL entirely unmodified', () => {
    expect(getScenarioModifiers('NORMAL', 0)).toEqual(NEUTRAL_MODIFIERS);
  });
});

describe('SOLAR_FAULT', () => {
  it('keeps irradiance high while yield collapses', () => {
    const frames = run('SOLAR_FAULT').filter((f) => f.nodeType === 'SOLAR');
    expect(frames.length).toBeGreaterThan(0);

    for (const frame of frames) {
      // Irradiance is untouched — this is the whole point.
      expect(frame.lux ?? 0).toBeGreaterThan(THRESHOLDS.solar.daylightLuxThreshold);

      const expected = expectedSolarPower(SOLAR, frame.lux!, frame.temperature ?? 25);
      // Measured yield is far below the model's expectation.
      expect(frame.power).toBeLessThan(expected * 0.5);
    }
  });

  it('is detectably different from NORMAL at the same time of day', () => {
    const opts = { startTime: new Date('2026-04-12T12:00:00'), seed: 99 };
    const normal = run('NORMAL', 30, opts).filter((f) => f.nodeType === 'SOLAR');
    const faulted = run('SOLAR_FAULT', 30, opts).filter((f) => f.nodeType === 'SOLAR');

    const meanPower = (fs: TelemetryFrame[]) => fs.reduce((s, f) => s + f.power, 0) / fs.length;
    expect(meanPower(faulted)).toBeLessThan(meanPower(normal) * 0.5);
  });

  it('reduces current rather than rewriting power directly', () => {
    const opts = { startTime: new Date('2026-04-12T12:00:00'), seed: 77 };
    const normal = run('NORMAL', 20, opts).filter((f) => f.nodeType === 'SOLAR');
    const faulted = run('SOLAR_FAULT', 20, opts).filter((f) => f.nodeType === 'SOLAR');

    const meanCurrent = (fs: TelemetryFrame[]) => fs.reduce((s, f) => s + f.current, 0) / fs.length;
    // Current falls, and P = V x I still holds — the physics was not bypassed.
    expect(meanCurrent(faulted)).toBeLessThan(meanCurrent(normal));
    for (const frame of faulted) {
      expect(frame.power).toBeCloseTo(frame.voltage * frame.current, 1);
    }
  });
});

describe('PANEL_SOILING', () => {
  it('degrades gradually rather than instantly', () => {
    const early = getScenarioModifiers('PANEL_SOILING', 1);
    const mid = getScenarioModifiers('PANEL_SOILING', 90);
    const late = getScenarioModifiers('PANEL_SOILING', 180);

    expect(early.solarDerate).toBeGreaterThan(mid.solarDerate);
    expect(mid.solarDerate).toBeGreaterThan(late.solarDerate);
    expect(early.progressiveSoiling).toBe(true);
  });

  it('is distinguishable from SOLAR_FAULT by its rate of onset', () => {
    // A sharp fault is already deep at t=1 s; soiling is still near healthy.
    const sharp = getScenarioModifiers('SOLAR_FAULT', 1).solarDerate;
    const gradual = getScenarioModifiers('PANEL_SOILING', 1).solarDerate;
    expect(gradual).toBeGreaterThan(sharp);
  });
});

describe('BATTERY_FAULT', () => {
  it('decouples terminal voltage from state of charge', () => {
    const frames = run('BATTERY_FAULT', 60).filter((f) => f.nodeType === 'BATTERY');
    expect(frames.length).toBeGreaterThan(0);

    const mod = getScenarioModifiers('BATTERY_FAULT', 60);
    expect(mod.batteryVoltageError).toBeLessThan(-0.45);
    expect(mod.batteryChargeAcceptance).toBeLessThan(1);
  });

  it('raises pack temperature', () => {
    expect(getScenarioModifiers('BATTERY_FAULT', 30).batteryTempOffset).toBeGreaterThan(0);
  });
});

describe('BATTERY_OVERHEATING', () => {
  it('ramps temperature over time', () => {
    const early = getScenarioModifiers('BATTERY_OVERHEATING', 5).batteryTempOffset;
    const late = getScenarioModifiers('BATTERY_OVERHEATING', 120).batteryTempOffset;
    expect(late).toBeGreaterThan(early);
  });

  it('eventually pushes the pack past the critical threshold', () => {
    const engine = new SimulationEngine({
      nodeCount: 4,
      scenario: 'BATTERY_OVERHEATING',
      seed: 55,
      speed: 30,
    });
    let maxTemp = -Infinity;
    for (let i = 0; i < 300; i++) {
      for (const frame of engine.tick().frames) {
        if (frame.nodeType === 'BATTERY' && frame.temperature !== undefined) {
          maxTemp = Math.max(maxTemp, frame.temperature);
        }
      }
    }
    expect(maxTemp).toBeGreaterThan(THRESHOLDS.battery.temperatureCritical);
  });
});

describe('OVERLOAD', () => {
  it('drives load branches above their rating during the demand peak', () => {
    const frames = run('OVERLOAD', 60, {
      // Evening peak, when the multiplier can actually exceed the rating.
      startTime: new Date('2026-04-12T19:30:00'),
      speed: 1,
    }).filter((f) => f.nodeType === 'AC_LOAD' || f.nodeType === 'DC_LOAD');

    const overloaded = frames.filter((f) => {
      const node = getNodeConfig(f.nodeId)!;
      return f.power > node.ratedPower * THRESHOLDS.load.overloadRatio;
    });
    expect(overloaded.length).toBeGreaterThan(0);
  });

  it('pushes the system into an energy deficit', () => {
    const engine = new SimulationEngine({
      nodeCount: 4,
      scenario: 'OVERLOAD',
      seed: 31,
      speed: 1,
      startTime: new Date('2026-04-12T19:30:00'),
    });
    let deficitTicks = 0;
    for (let i = 0; i < 40; i++) {
      const r = engine.tick();
      if (r.trueConsumptionW > r.trueGenerationW) deficitTicks++;
    }
    expect(deficitTicks).toBeGreaterThan(20);
  });
});

describe('BROWNOUT', () => {
  it('sags load voltage below the brownout threshold', () => {
    const frames = run('BROWNOUT', 40, {
      startTime: new Date('2026-04-12T19:30:00'),
    }).filter((f) => f.nodeType === 'AC_LOAD' || f.nodeType === 'DC_LOAD');

    for (const frame of frames) {
      const node = getNodeConfig(frame.nodeId)!;
      expect(frame.voltage).toBeLessThan(node.nominalVoltage * THRESHOLDS.load.brownoutRatio);
    }
  });
});

describe('NETWORK_FAILURE', () => {
  it('drops frames', () => {
    const engine = new SimulationEngine({ nodeCount: 4, scenario: 'NETWORK_FAILURE', seed: 17 });
    let dropped = 0;
    for (let i = 0; i < 120; i++) dropped += engine.tick().droppedNodeIds.length;
    expect(dropped).toBeGreaterThan(0);
  });

  it('produces sustained blackouts, not just isolated losses', () => {
    // Bursty loss is what actually drives a node to STALE/OFFLINE.
    const engine = new SimulationEngine({ nodeCount: 4, scenario: 'NETWORK_FAILURE', seed: 23 });
    let longestGap = 0;
    let currentGap = 0;

    for (let i = 0; i < 200; i++) {
      const result = engine.tick();
      const sigmaReported = result.frames.some((f) => f.nodeId === 'sigma');
      if (sigmaReported) {
        longestGap = Math.max(longestGap, currentGap);
        currentGap = 0;
      } else {
        currentGap++;
      }
    }
    longestGap = Math.max(longestGap, currentGap);

    // At 1 Hz the stale threshold is 8 ticks; blackouts must be able to exceed it.
    expect(longestGap).toBeGreaterThanOrEqual(8);
  });

  it('can duplicate frames with a repeated sequence number', () => {
    const engine = new SimulationEngine({ nodeCount: 4, scenario: 'NETWORK_FAILURE', seed: 19 });
    let duplicates = 0;
    for (let i = 0; i < 200; i++) {
      const result = engine.tick();
      duplicates += result.duplicatedNodeIds.length;

      // A duplicate carries the SAME sequence number — that is what makes it
      // detectable as a duplicate rather than a new reading.
      const bySeq = new Map<string, number>();
      for (const frame of result.frames) {
        const key = `${frame.nodeId}:${frame.sequenceNumber}`;
        bySeq.set(key, (bySeq.get(key) ?? 0) + 1);
      }
      for (const [, count] of bySeq) {
        if (count > 1) expect(count).toBe(2);
      }
    }
    expect(duplicates).toBeGreaterThan(0);
  });
});

describe('SENSOR_FAILURE', () => {
  it('emits physically impossible readings that fail validation', () => {
    const frames = run('SENSOR_FAILURE', 120);
    const invalid = frames.filter((f) => {
      const node = getNodeConfig(f.nodeId);
      return !validateFrame(f, node).valid;
    });
    expect(invalid.length).toBeGreaterThan(0);
  });

  it('produces the DS18B20 -127 degC failure value', () => {
    const frames = run('SENSOR_FAILURE', 400, { seed: 8 });
    const ds18b20 = frames.filter((f) => f.temperature === DS18B20_ERROR_VALUE);
    expect(ds18b20.length).toBeGreaterThan(0);

    // And it must be rejected, with a message naming the sensor.
    const result = validateFrame(ds18b20[0], getNodeConfig(ds18b20[0].nodeId));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('DS18B20');
  });

  it('still DELIVERS the frames — a sensor fault is not a comms fault', () => {
    const engine = new SimulationEngine({ nodeCount: 4, scenario: 'SENSOR_FAILURE', seed: 4 });
    for (let i = 0; i < 30; i++) {
      const result = engine.tick();
      // Frames arrive; nothing is dropped. That distinction is the point.
      expect(result.frames.length).toBeGreaterThan(0);
      expect(result.droppedNodeIds).toHaveLength(0);
    }
  });
});

describe('NIGHT_MODE', () => {
  it('forces the simulated hour to night', () => {
    expect(getScenarioModifiers('NIGHT_MODE', 0).forceHour).toBe(22);
  });

  it('discharges the battery to carry the load', () => {
    const engine = new SimulationEngine({ nodeCount: 4, scenario: 'NIGHT_MODE', seed: 61, speed: 1 });
    engine.tick();
    let dischargingTicks = 0;
    for (let i = 0; i < 40; i++) {
      const battery = engine.tick().frames.find((f) => f.nodeType === 'BATTERY');
      if (battery && battery.current < 0) dischargingTicks++;
    }
    expect(dischargingTicks).toBeGreaterThan(20);
  });
});

describe('scenario switching', () => {
  it('takes effect on the next tick', () => {
    const engine = new SimulationEngine({
      nodeCount: 4,
      seed: 12,
      speed: 1,
      startTime: new Date('2026-04-12T12:00:00'),
    });

    const before: number[] = [];
    for (let i = 0; i < 15; i++) {
      const solar = engine.tick().frames.find((f) => f.nodeType === 'SOLAR');
      if (solar) before.push(solar.power);
    }

    engine.setScenario('SOLAR_FAULT');

    const after: number[] = [];
    for (let i = 0; i < 15; i++) {
      const solar = engine.tick().frames.find((f) => f.nodeType === 'SOLAR');
      if (solar) after.push(solar.power);
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(after)).toBeLessThan(mean(before) * 0.5);
  });
});
