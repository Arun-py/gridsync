/**
 * Physics and simulation-engine tests.
 *
 * These assert the RELATIONSHIPS that make the simulation believable, not
 * specific magic numbers. A test that pins `power === 73.4` would break on any
 * tuning change while proving nothing; a test that asserts "power rises with
 * irradiance and falls with heat" protects the actual contract.
 */

import { describe, expect, it } from 'vitest';

import {
  ambientTemperature,
  batteryTerminalVoltage,
  cellTemperature,
  createRng,
  dailyLoadProfile,
  energyKwh,
  expectedSolarPower,
  irradianceLux,
  power,
  socToOpenCircuitVoltage,
  solarElevation,
  solarOperatingPoint,
  stepSoc,
  voltageToSoc,
} from '../shared/physics';
import { SimulationEngine } from '../shared/simulation/engine';
import { getNodeConfig, resolveNodes } from '../shared/nodes.config';
import { THRESHOLDS } from '../shared/constants';

const SOLAR = getNodeConfig('sigma')!;
const BATTERY = getNodeConfig('beta')!;

describe('power', () => {
  it('computes P = V x I', () => {
    expect(power(12, 5)).toBe(60);
    expect(power(0, 5)).toBe(0);
    // Sign is preserved: a discharging battery has negative power.
    expect(power(12, -3)).toBe(-36);
  });
});

describe('solar elevation', () => {
  it('is zero outside daylight hours', () => {
    expect(solarElevation(0)).toBe(0);
    expect(solarElevation(5)).toBe(0);
    expect(solarElevation(18)).toBe(0);
    expect(solarElevation(23)).toBe(0);
  });

  it('peaks at solar noon', () => {
    const noon = solarElevation(12);
    expect(noon).toBeGreaterThan(0.99);
    expect(noon).toBeGreaterThan(solarElevation(9));
    expect(noon).toBeGreaterThan(solarElevation(15));
  });

  it('is symmetric about noon', () => {
    expect(solarElevation(9)).toBeCloseTo(solarElevation(15), 5);
  });
});

describe('irradiance', () => {
  it('is zero at night', () => {
    expect(irradianceLux(0, 10)).toBe(0);
  });

  it('never exceeds the clear-sky reference', () => {
    for (let h = 6; h < 18; h += 0.5) {
      const lux = irradianceLux(solarElevation(h), h);
      expect(lux).toBeLessThanOrEqual(THRESHOLDS.solar.referenceLux);
      expect(lux).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('expected solar power', () => {
  it('rises monotonically with irradiance', () => {
    const at25 = (lux: number) => expectedSolarPower(SOLAR, lux, 25);
    expect(at25(0)).toBe(0);
    expect(at25(50_000)).toBeGreaterThan(at25(20_000));
    expect(at25(100_000)).toBeGreaterThan(at25(50_000));
  });

  it('reaches roughly the nameplate rating at reference irradiance and 25 degC', () => {
    const p = expectedSolarPower(SOLAR, THRESHOLDS.solar.referenceLux, 25);
    expect(p).toBeCloseTo(SOLAR.ratedPower, 0);
  });

  it('derates with cell temperature', () => {
    const cool = expectedSolarPower(SOLAR, 80_000, 25);
    const hot = expectedSolarPower(SOLAR, 80_000, 65);
    expect(hot).toBeLessThan(cool);
    // 0.4 %/degC over 40 degC = 16 % loss.
    expect(hot / cool).toBeCloseTo(1 - 0.004 * 40, 3);
  });

  it('never returns a negative value', () => {
    expect(expectedSolarPower(SOLAR, 100_000, 300)).toBeGreaterThanOrEqual(0);
  });
});

describe('solar operating point', () => {
  it('reproduces the requested power as V x I', () => {
    const { voltage, current } = solarOperatingPoint(60, SOLAR, 70_000);
    // Voltage and current are quantised to transmission precision (2 and 3
    // decimals), so the product carries a small rounding residual. Tolerance is
    // set to that quantisation, not to float precision.
    expect(voltage * current).toBeCloseTo(60, 1);
  });

  it('produces no current on a dark array', () => {
    const { current } = solarOperatingPoint(0, SOLAR, 0);
    expect(current).toBe(0);
  });
});

describe('battery state of charge', () => {
  it('maps SOC to open-circuit voltage monotonically', () => {
    let previous = -Infinity;
    for (let soc = 0; soc <= 100; soc += 5) {
      const v = socToOpenCircuitVoltage(soc);
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
  });

  it('matches the documented 12 V lead-acid table', () => {
    expect(socToOpenCircuitVoltage(100)).toBeCloseTo(12.75, 2);
    expect(socToOpenCircuitVoltage(75)).toBeCloseTo(12.4, 2);
    expect(socToOpenCircuitVoltage(50)).toBeCloseTo(12.2, 2);
    expect(socToOpenCircuitVoltage(25)).toBeCloseTo(12.0, 2);
  });

  it('round-trips through voltageToSoc', () => {
    for (const soc of [10, 25, 50, 75, 100]) {
      expect(voltageToSoc(socToOpenCircuitVoltage(soc))).toBeCloseTo(soc, 0);
    }
  });

  it('clamps out-of-range input', () => {
    expect(socToOpenCircuitVoltage(-10)).toBe(socToOpenCircuitVoltage(0));
    expect(socToOpenCircuitVoltage(150)).toBe(socToOpenCircuitVoltage(100));
  });
});

describe('terminal voltage', () => {
  it('rises above OCV when charging and falls below when discharging', () => {
    const ocv = socToOpenCircuitVoltage(60);
    expect(batteryTerminalVoltage(60, 10)).toBeGreaterThan(ocv);
    expect(batteryTerminalVoltage(60, -10)).toBeLessThan(ocv);
    expect(batteryTerminalVoltage(60, 0)).toBeCloseTo(ocv, 6);
  });

  it('sags more under load when the pack is empty', () => {
    const fullSag = socToOpenCircuitVoltage(90) - batteryTerminalVoltage(90, -20);
    const emptySag = socToOpenCircuitVoltage(10) - batteryTerminalVoltage(10, -20);
    expect(emptySag).toBeGreaterThan(fullSag);
  });
});

describe('SOC integration', () => {
  it('increases when charging and decreases when discharging', () => {
    const start = 50;
    expect(stepSoc(start, 300, 100, 12, 60)).toBeGreaterThan(start);
    expect(stepSoc(start, -300, 100, 12, 60)).toBeLessThan(start);
  });

  it('clamps to the 0-100 range', () => {
    expect(stepSoc(99, 100_000, 100, 12, 3600)).toBe(100);
    expect(stepSoc(1, -100_000, 100, 12, 3600)).toBe(0);
  });

  it('loses energy on a charge/discharge round trip', () => {
    const start = 50;
    // Charge 1 kWh in, then take the same 1 kWh out.
    const charged = stepSoc(start, 1000, 100, 12, 3600);
    const back = stepSoc(charged, -1000, 100, 12, 3600);
    // Round-trip efficiency is below 100 %, so we end lower than we started.
    expect(back).toBeLessThan(start);
  });

  it('is proportional to elapsed time', () => {
    const oneMinute = stepSoc(50, 600, 100, 12, 60) - 50;
    const twoMinutes = stepSoc(50, 600, 100, 12, 120) - 50;
    expect(twoMinutes).toBeCloseTo(oneMinute * 2, 5);
  });
});

describe('load profile', () => {
  it('stays within sane bounds across the day', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const p = dailyLoadProfile(h);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1.2);
    }
  });

  it('peaks in the evening', () => {
    const evening = dailyLoadProfile(19.5);
    expect(evening).toBeGreaterThan(dailyLoadProfile(3));
    expect(evening).toBeGreaterThan(dailyLoadProfile(13));
  });

  it('wraps around midnight', () => {
    expect(dailyLoadProfile(25)).toBeCloseTo(dailyLoadProfile(1), 6);
  });
});

describe('ambient temperature', () => {
  it('is coolest before dawn and warmest mid-afternoon', () => {
    expect(ambientTemperature(5)).toBeLessThan(ambientTemperature(15));
  });

  it('stays within the configured daily band', () => {
    for (let h = 0; h < 24; h++) {
      const t = ambientTemperature(h, 22, 34);
      expect(t).toBeGreaterThanOrEqual(21.9);
      expect(t).toBeLessThanOrEqual(34.1);
    }
  });
});

describe('cell temperature', () => {
  it('equals ambient in darkness and rises with irradiance', () => {
    expect(cellTemperature(30, 0)).toBe(30);
    expect(cellTemperature(30, 100_000)).toBeGreaterThan(30);
  });
});

describe('energy integration', () => {
  it('converts a constant power series to kWh', () => {
    // 1000 W held for 3600 samples of 1 s = 1 kWh.
    const samples = new Array(3600).fill(1000);
    expect(energyKwh(samples, 1000)).toBeCloseTo(1, 6);
  });
});

describe('deterministic RNG', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('simulation engine', () => {
  it('emits one frame per node on a healthy tick', () => {
    const engine = new SimulationEngine({ nodeCount: 4, seed: 7 });
    const result = engine.tick();
    expect(result.frames).toHaveLength(4);
    expect(new Set(result.frames.map((f) => f.nodeId)).size).toBe(4);
  });

  it('is reproducible for a given seed and start time', () => {
    const opts = { nodeCount: 4, seed: 42, startTime: new Date('2026-04-12T10:00:00Z') };
    const a = new SimulationEngine(opts);
    const b = new SimulationEngine(opts);
    for (let i = 0; i < 20; i++) {
      const fa = a.tick().frames;
      const fb = b.tick().frames;
      expect(fa.map((f) => [f.nodeId, f.voltage, f.current])).toEqual(
        fb.map((f) => [f.nodeId, f.voltage, f.current]),
      );
    }
  });

  it('keeps power exactly consistent with the transmitted V x I', () => {
    // The frame must be self-consistent at the precision it is transmitted at,
    // because ingest validation checks exactly this relationship.
    const engine = new SimulationEngine({ nodeCount: 8, seed: 3 });
    for (let i = 0; i < 40; i++) {
      for (const frame of engine.tick().frames) {
        expect(frame.power).toBeCloseTo(
          Math.round(frame.voltage * frame.current * 100) / 100,
          2,
        );
      }
    }
  });

  it('increments sequence numbers monotonically per node', () => {
    const engine = new SimulationEngine({ nodeCount: 4, seed: 11 });
    const last = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      for (const frame of engine.tick().frames) {
        const previous = last.get(frame.nodeId) ?? 0;
        expect(frame.sequenceNumber).toBeGreaterThan(previous);
        last.set(frame.nodeId, frame.sequenceNumber);
      }
    }
  });

  it('produces near-zero solar generation at night', () => {
    const engine = new SimulationEngine({
      nodeCount: 4,
      seed: 5,
      scenario: 'NIGHT_MODE',
      speed: 1,
    });
    // Discard the first tick while state settles.
    engine.tick();
    for (let i = 0; i < 10; i++) {
      const solar = engine.tick().frames.filter((f) => f.nodeType === 'SOLAR');
      for (const frame of solar) {
        expect(frame.power).toBeLessThan(1);
        expect(frame.lux ?? 0).toBeLessThan(100);
      }
    }
  });

  it('scales from 4 to 10 nodes without changing frame shape', () => {
    for (const count of [4, 6, 8, 10]) {
      const engine = new SimulationEngine({ nodeCount: count, seed: 2 });
      const frames = engine.tick().frames;
      expect(frames).toHaveLength(count);
      expect(resolveNodes(count)).toHaveLength(count);
      for (const frame of frames) {
        expect(frame).toHaveProperty('nodeId');
        expect(frame).toHaveProperty('sequenceNumber');
        expect(frame.source).toBe('SIMULATION');
        expect(frame.mode).toBe('SIMULATION');
      }
    }
  });

  it('keeps battery SOC within 0-100 over a long run', () => {
    const engine = new SimulationEngine({ nodeCount: 4, seed: 8, speed: 300 });
    for (let i = 0; i < 400; i++) {
      for (const frame of engine.tick().frames) {
        if (frame.soc !== undefined) {
          expect(frame.soc).toBeGreaterThanOrEqual(0);
          expect(frame.soc).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('charges the battery when generation exceeds demand', () => {
    // Midday, healthy array: there should be surplus to store.
    const engine = new SimulationEngine({
      nodeCount: 4,
      seed: 21,
      speed: 1,
      startTime: new Date('2026-04-12T12:00:00'),
    });

    let chargingTicks = 0;
    for (let i = 0; i < 40; i++) {
      const result = engine.tick();
      const battery = result.frames.find((f) => f.nodeType === 'BATTERY');
      if (result.trueGenerationW > result.trueConsumptionW && battery && battery.current > 0) {
        chargingTicks++;
      }
    }
    expect(chargingTicks).toBeGreaterThan(0);
  });

  it('respects the battery power rating', () => {
    const engine = new SimulationEngine({ nodeCount: 4, seed: 13, speed: 120 });
    for (let i = 0; i < 200; i++) {
      for (const frame of engine.tick().frames) {
        if (frame.nodeType === 'BATTERY') {
          expect(Math.abs(frame.power)).toBeLessThanOrEqual(BATTERY.ratedPower * 1.05);
        }
      }
    }
  });
});
