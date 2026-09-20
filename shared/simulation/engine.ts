/**
 * GridSync simulation engine.
 *
 * ONE engine produces ALL telemetry. Nothing in the React tree ever invents a
 * number. The engine is deterministic given (seed, simulated time), stateful
 * across ticks (SOC and temperatures integrate properly), and physically
 * coherent (see shared/physics.ts for the assumptions it rests on).
 *
 * Tick order matters and mirrors how a real microgrid resolves:
 *   1. advance the simulated clock
 *   2. compute environment (irradiance, ambient temperature)
 *   3. compute generation from the environment
 *   4. compute demand from the time-of-day profile
 *   5. settle the battery against the resulting energy balance
 *   6. emit one frame per node, then apply network impairments
 *
 * The battery is settled AFTER generation and load because its behaviour is a
 * *consequence* of the energy balance, not an independent random walk.
 */

import {
  ambientTemperature,
  batteryTerminalVoltage,
  cellTemperature,
  clamp,
  createRng,
  currentFromPower,
  dailyLoadProfile,
  expectedSolarPower,
  INVERTER_EFFICIENCY,
  irradianceLux,
  noise,
  round,
  smoothNoise,
  solarElevation,
  solarOperatingPoint,
  stepBatteryTemperature,
  stepSoc,
} from '../physics';
import { DS18B20_ERROR_VALUE, SIMULATION_DEFAULTS, THRESHOLDS } from '../constants';
import { resolveNodes } from '../nodes.config';
import type { NodeConfig, ScenarioId, TelemetryFrame } from '../types';
import { getScenarioModifiers, type ScenarioModifiers } from './scenarios';

export interface EngineOptions {
  nodeCount?: number;
  scenario?: ScenarioId;
  /** Wall-clock ms between ticks. */
  intervalMs?: number;
  /** Simulated-time acceleration. 60 = one simulated hour per real minute. */
  speed?: number;
  seed?: number;
  /** Simulated clock start. Defaults to the real current time. */
  startTime?: Date;
  /**
   * Starting state of charge for every battery node, 0-100.
   *
   * A real bank begins each day wherever the previous night left it, so this is
   * varied across training episodes to produce the full SOC range — including
   * the low-SOC region a correctly-sized system rarely reaches on its own.
   */
  initialSoc?: number;
}

interface NodeRuntimeState {
  sequenceNumber: number;
  soc: number;
  temperature: number;
  /** Rolling spike counter used to make repeated-spike scenarios detectable. */
  consecutiveSpikes: number;
  uptimeSeconds: number;
  lastEmittedPower: number;
  /**
   * Tick index until which this node is unreachable.
   *
   * Real link failures are BURSTY — a node drops off for seconds at a time
   * rather than losing independent packets at a fixed rate. Modelling it as a
   * blackout is both more realistic and what actually lets a node cross the
   * stale/offline thresholds, which independent per-packet loss almost never
   * does at 1 Hz.
   *
   * Measured in TICKS, not simulated seconds: staleness is judged against
   * wall-clock frame timestamps, so the blackout has to last in wall-clock
   * terms too. At speed 60 a simulated minute passes per tick, so a blackout
   * expressed in simulated time would expire before a single tick elapsed.
   */
  blackoutUntilTick: number;
}

/** Output of one tick: the frames that actually survived the network. */
export interface TickResult {
  frames: TelemetryFrame[];
  /** Frames the network dropped this tick. Drives packet-loss statistics. */
  droppedNodeIds: string[];
  /** Frames duplicated this tick. */
  duplicatedNodeIds: string[];
  simulatedTime: Date;
  solarElevation: number;
  /** Generation/consumption before network impairment — the physical truth. */
  trueGenerationW: number;
  trueConsumptionW: number;
}

export class SimulationEngine {
  private nodes: NodeConfig[];
  private scenario: ScenarioId;
  private intervalMs: number;
  private speed: number;
  private rng: () => number;
  private simulatedTime: Date;
  private state = new Map<string, NodeRuntimeState>();
  private scenarioStartedAt = 0;
  /** Accumulated simulated seconds since the engine started. */
  private elapsedSimSeconds = 0;
  /** Wall-clock tick counter, used for network-impairment timing. */
  private tickCount = 0;
  private framesGenerated = 0;
  private lastFrame: TelemetryFrame | null = null;
  private initialSoc: number;

  constructor(options: EngineOptions = {}) {
    // Mid-morning charge level unless the caller specifies otherwise.
    this.initialSoc = clamp(options.initialSoc ?? 68, 0, 100);
    this.nodes = resolveNodes(options.nodeCount ?? SIMULATION_DEFAULTS.nodeCount);
    this.scenario = options.scenario ?? SIMULATION_DEFAULTS.scenario;
    this.intervalMs = options.intervalMs ?? SIMULATION_DEFAULTS.intervalMs;
    this.speed = options.speed ?? SIMULATION_DEFAULTS.speed;
    this.rng = createRng(options.seed ?? 20260918);
    this.simulatedTime = options.startTime ? new Date(options.startTime) : new Date();
    this.initNodeState();
  }

  private initNodeState(): void {
    for (const node of this.nodes) {
      this.state.set(node.id, {
        sequenceNumber: 0,
        soc: node.type === 'BATTERY' ? this.initialSoc : 0,
        temperature: 28,
        consecutiveSpikes: 0,
        uptimeSeconds: 0,
        lastEmittedPower: 0,
        blackoutUntilTick: 0,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Control surface (driven by the Demo Control page via the worker)
  // -------------------------------------------------------------------------

  setScenario(scenario: ScenarioId): void {
    if (scenario === this.scenario) return;
    this.scenario = scenario;
    this.scenarioStartedAt = this.elapsedSimSeconds;
  }

  getScenario(): ScenarioId {
    return this.scenario;
  }

  setNodeCount(count: number): void {
    this.nodes = resolveNodes(count);
    for (const node of this.nodes) {
      if (!this.state.has(node.id)) {
        this.state.set(node.id, {
          sequenceNumber: 0,
          soc: node.type === 'BATTERY' ? this.initialSoc : 0,
          temperature: 28,
          consecutiveSpikes: 0,
          uptimeSeconds: 0,
          lastEmittedPower: 0,
          blackoutUntilTick: 0,
        });
      }
    }
  }

  setIntervalMs(ms: number): void {
    this.intervalMs = clamp(ms, 200, 60_000);
  }

  setSpeed(speed: number): void {
    this.speed = clamp(speed, 1, 3600);
  }

  getNodes(): NodeConfig[] {
    return this.nodes;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  getSpeed(): number {
    return this.speed;
  }

  getSimulatedTime(): Date {
    return new Date(this.simulatedTime);
  }

  getFramesGenerated(): number {
    return this.framesGenerated;
  }

  getLastFrame(): TelemetryFrame | null {
    return this.lastFrame;
  }

  getNodeCount(): number {
    return this.nodes.length;
  }

  /** SOC of the primary battery, for callers that need a quick read. */
  getPrimarySoc(): number | null {
    const battery = this.nodes.find((n) => n.type === 'BATTERY');
    return battery ? (this.state.get(battery.id)?.soc ?? null) : null;
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  tick(): TickResult {
    // --- 1. advance the simulated clock -----------------------------------
    this.tickCount += 1;
    const simSecondsPerTick = (this.intervalMs / 1000) * this.speed;
    this.elapsedSimSeconds += simSecondsPerTick;
    this.simulatedTime = new Date(this.simulatedTime.getTime() + simSecondsPerTick * 1000);

    const scenarioElapsed = this.elapsedSimSeconds - this.scenarioStartedAt;
    const mod = getScenarioModifiers(this.scenario, scenarioElapsed);

    // --- 2. environment ----------------------------------------------------
    const hourOfDay =
      mod.forceHour ?? this.simulatedTime.getHours() + this.simulatedTime.getMinutes() / 60;
    const elevation = solarElevation(hourOfDay);
    const simulatedHours = this.elapsedSimSeconds / 3600;
    const lux = irradianceLux(elevation, simulatedHours, mod.cloudiness);
    const ambientC = ambientTemperature(hourOfDay);

    // --- 3. generation -----------------------------------------------------
    const solarNodes = this.nodes.filter((n) => n.type === 'SOLAR');
    const solarReadings = solarNodes.map((node) =>
      this.computeSolar(node, lux, ambientC, mod, simSecondsPerTick),
    );
    const trueGenerationW = solarReadings.reduce((sum, r) => sum + r.power, 0);

    // --- 4. demand ---------------------------------------------------------
    const loadNodes = this.nodes.filter((n) => n.type === 'AC_LOAD' || n.type === 'DC_LOAD');
    const loadReadings = loadNodes.map((node) =>
      this.computeLoad(node, hourOfDay, simulatedHours, mod),
    );
    // DC-side demand: AC branches are fed through the inverter, so their DC
    // draw is higher than their delivered AC power.
    const trueConsumptionW = loadReadings.reduce((sum, r) => sum + r.power, 0);
    const dcSideDemandW = loadReadings.reduce(
      (sum, r) => sum + (r.node.type === 'AC_LOAD' ? r.power / INVERTER_EFFICIENCY : r.power),
      0,
    );

    // --- 5. battery settles the balance -----------------------------------
    const batteryNodes = this.nodes.filter((n) => n.type === 'BATTERY');
    const netW = trueGenerationW - dcSideDemandW;
    const batteryReadings = batteryNodes.map((node, index) =>
      // Surplus/deficit is shared across banks in proportion to their count.
      this.computeBattery(node, netW / batteryNodes.length, ambientC, mod, simSecondsPerTick, index),
    );

    // --- 6. emit frames, then impair the network --------------------------
    const raw: TelemetryFrame[] = [
      ...solarReadings.map((r) => this.buildFrame(r.node, r, mod)),
      ...batteryReadings.map((r) => this.buildFrame(r.node, r, mod)),
      ...loadReadings.map((r) => this.buildFrame(r.node, r, mod)),
    ];

    const frames: TelemetryFrame[] = [];
    const droppedNodeIds: string[] = [];
    const duplicatedNodeIds: string[] = [];

    for (const frame of raw) {
      const st = this.state.get(frame.nodeId)!;

      // --- bursty link failure ---
      // Enter a blackout with a small per-tick probability, then stay dark for
      // a while. This is what drives a node through ONLINE -> STALE -> OFFLINE.
      if (mod.packetLossRate > 0) {
        if (this.tickCount < st.blackoutUntilTick) {
          droppedNodeIds.push(frame.nodeId);
          continue;
        }
        // Scale entry probability with the scenario's loss rate.
        if (this.rng() < mod.packetLossRate * 0.08) {
          // 12-40 ticks dark. At the default 1 Hz that is 12-40 wall-clock
          // seconds: long enough to cross the 8 s stale threshold and, often,
          // the 20 s offline threshold.
          st.blackoutUntilTick = this.tickCount + 12 + Math.floor(this.rng() * 28);
          droppedNodeIds.push(frame.nodeId);
          continue;
        }
        // Residual independent loss on top of the bursts.
        if (this.rng() < mod.packetLossRate * 0.25) {
          droppedNodeIds.push(frame.nodeId);
          continue;
        }
      }

      frames.push(frame);
      // A duplicate re-sends the SAME sequence number — that is precisely what
      // makes it detectable downstream as a duplicate rather than a new frame.
      if (mod.duplicateRate > 0 && this.rng() < mod.duplicateRate) {
        duplicatedNodeIds.push(frame.nodeId);
        frames.push({ ...frame });
      }
    }

    this.framesGenerated += frames.length;
    if (frames.length > 0) this.lastFrame = frames[frames.length - 1];

    return {
      frames,
      droppedNodeIds,
      duplicatedNodeIds,
      simulatedTime: new Date(this.simulatedTime),
      solarElevation: elevation,
      trueGenerationW: round(trueGenerationW, 2),
      trueConsumptionW: round(trueConsumptionW, 2),
    };
  }

  // -------------------------------------------------------------------------
  // Per-subsystem models
  // -------------------------------------------------------------------------

  private computeSolar(
    node: NodeConfig,
    lux: number,
    ambientC: number,
    mod: ScenarioModifiers,
    elapsedSeconds: number,
  ) {
    const st = this.state.get(node.id)!;
    st.uptimeSeconds += elapsedSeconds;

    // Per-node irradiance variation: different orientations see different light.
    const nodeSeed = hashToUnit(node.id);
    const nodeLux = Math.max(0, lux * (0.9 + 0.2 * nodeSeed) * (1 + 0.03 * smoothNoise(st.uptimeSeconds / 600, nodeSeed * 10)));

    const cellTempC = cellTemperature(ambientC, nodeLux) + mod.solarTempOffset;
    const expected = expectedSolarPower(node, nodeLux, cellTempC);
    // The fault derates the ARRAY; irradiance is untouched. That decoupling is
    // exactly what the rule engine and the ML model key on.
    const actual = Math.max(0, expected * mod.solarDerate * (1 + noise(this.rng, 0.02)));
    const { voltage, current } = solarOperatingPoint(actual, node, nodeLux);

    st.temperature = cellTempC;
    st.lastEmittedPower = actual;

    return {
      node,
      voltage,
      current: round(current, 3),
      power: round(voltage * current, 2),
      temperature: round(cellTempC, 2),
      lux: round(nodeLux, 0),
      soc: undefined as number | undefined,
      expectedPower: expected,
    };
  }

  private computeLoad(
    node: NodeConfig,
    hourOfDay: number,
    simulatedHours: number,
    mod: ScenarioModifiers,
  ) {
    const st = this.state.get(node.id)!;
    const nodeSeed = hashToUnit(node.id);

    // Deterministic time-of-day shape + slow drift + small bounded noise.
    const profile = dailyLoadProfile(hourOfDay + nodeSeed * 0.8);
    const drift = 1 + 0.08 * smoothNoise(simulatedHours * 3, nodeSeed * 20);
    // Critical loads are steadier; non-critical loads are burstier.
    const burstAmplitude = node.criticality === 'CRITICAL' ? 0.03 : 0.09;

    let demandW = node.ratedPower * profile * drift * mod.loadMultiplier;
    demandW *= 1 + noise(this.rng, burstAmplitude);

    // Occasional appliance switching spike on non-critical branches.
    const spiking = node.criticality === 'NON_CRITICAL' && this.rng() < 0.04;
    if (spiking) {
      demandW *= 1.4;
      st.consecutiveSpikes += 1;
    } else {
      st.consecutiveSpikes = Math.max(0, st.consecutiveSpikes - 1);
    }

    demandW = Math.max(0, demandW);

    const voltage = node.nominalVoltage * mod.loadVoltageSag * (1 + noise(this.rng, 0.006));
    const current = currentFromPower(demandW, voltage);
    st.lastEmittedPower = demandW;

    return {
      node,
      voltage: round(voltage, 2),
      current: round(current, 3),
      power: round(voltage * current, 2),
      temperature: undefined as number | undefined,
      lux: undefined as number | undefined,
      soc: undefined as number | undefined,
      expectedPower: node.ratedPower * profile,
    };
  }

  private computeBattery(
    node: NodeConfig,
    netW: number,
    ambientC: number,
    mod: ScenarioModifiers,
    elapsedSeconds: number,
    index: number,
  ) {
    const st = this.state.get(node.id)!;

    // Positive netW = surplus available to charge; negative = must discharge.
    let batteryPowerW = netW - mod.batteryParasiticDrainW;
    if (batteryPowerW > 0) {
      batteryPowerW *= mod.batteryChargeAcceptance;
      // Taper charging as the pack approaches full (absorption stage).
      const headroom = clamp((100 - st.soc) / 20, 0, 1);
      batteryPowerW *= headroom;
    }
    // Respect the bank's power rating in both directions.
    batteryPowerW = clamp(batteryPowerW, -node.ratedPower, node.ratedPower);

    // A flat pack cannot keep supplying; an overfull one cannot keep absorbing.
    if (st.soc <= 0.5 && batteryPowerW < 0) batteryPowerW = 0;
    if (st.soc >= 99.9 && batteryPowerW > 0) batteryPowerW = 0;

    const capacityAh = node.capacityAh ?? 100;
    st.soc = stepSoc(st.soc, batteryPowerW, capacityAh, node.nominalVoltage, elapsedSeconds);

    const currentA = currentFromPower(batteryPowerW, node.nominalVoltage);
    st.temperature = stepBatteryTemperature(st.temperature, ambientC, currentA, elapsedSeconds);
    const packTempC = st.temperature + mod.batteryTempOffset;

    // Under BATTERY_FAULT the voltage error decouples terminal voltage from SOC.
    const voltage =
      batteryTerminalVoltage(st.soc, currentA) +
      mod.batteryVoltageError +
      noise(this.rng, 0.015) +
      index * 0.01;

    st.lastEmittedPower = batteryPowerW;

    return {
      node,
      voltage: round(voltage, 3),
      current: round(currentA, 3),
      power: round(voltage * currentA, 2),
      temperature: round(packTempC, 2),
      lux: undefined as number | undefined,
      soc: round(st.soc, 2),
      expectedPower: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Frame assembly
  // -------------------------------------------------------------------------

  private buildFrame(
    node: NodeConfig,
    reading: {
      voltage: number;
      current: number;
      power: number;
      temperature?: number;
      lux?: number;
      soc?: number;
    },
    mod: ScenarioModifiers,
  ): TelemetryFrame {
    const st = this.state.get(node.id)!;
    st.sequenceNumber += 1;

    let { voltage, current, temperature, lux } = reading;
    let power = reading.power;

    // SENSOR_FAILURE injects physically impossible readings. The frame still
    // ARRIVES — that is what separates a sensor fault from a comms fault.
    if (mod.sensorFaultRate > 0 && this.rng() < mod.sensorFaultRate) {
      const pick = this.rng();
      if (pick < 0.4 && temperature !== undefined) {
        temperature = DS18B20_ERROR_VALUE; // classic 1-Wire read failure
      } else if (pick < 0.7) {
        voltage = -1 * Math.abs(voltage) * 3; // impossible negative rail
      } else if (lux !== undefined) {
        lux = 999_999; // beyond any real illuminance
      } else {
        current = 9_999;
      }
      power = voltage * current;
    }

    // Round FIRST, then derive power from the rounded values. A real device
    // transmits quantised readings, and downstream validation checks that
    // P equals V x I — so the frame must be self-consistent at the precision it
    // is actually transmitted at, not at full float precision.
    const vOut = round(voltage, 3);
    const iOut = round(current, 3);

    return {
      nodeId: node.id,
      nodeType: node.type,
      timestamp: new Date().toISOString(),
      voltage: vOut,
      current: iOut,
      power: round(vOut * iOut, 2),
      temperature: temperature === undefined ? undefined : round(temperature, 2),
      lux: lux === undefined ? undefined : round(lux, 0),
      soc: reading.soc === undefined ? undefined : round(reading.soc, 2),
      status: 'ONLINE',
      mode: 'SIMULATION',
      source: 'SIMULATION',
      sequenceNumber: st.sequenceNumber,
      firmwareVersion: 'sim-2.0.0',
      // Plausible ESP32 Wi-Fi signal; degrades when the network scenario bites.
      rssi: round(-52 - 18 * mod.packetLossRate + noise(this.rng, 3), 0),
      uptime: Math.floor(st.uptimeSeconds),
      // Validation is performed on INGEST, not here — the simulator must be
      // able to emit bad data on purpose without pre-judging it.
      valid: true,
    };
  }
}

/** Stable per-node variation in [0,1) so each node behaves slightly differently. */
function hashToUnit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export { THRESHOLDS };
