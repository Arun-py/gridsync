/**
 * Simulation telemetry source.
 *
 * Wraps the shared simulation engine behind the `TelemetrySource` interface and
 * drives it on a wall-clock timer.
 *
 * Uses a self-rescheduling `setTimeout` rather than `setInterval`: if a tick
 * overruns its budget (a slow database write, a garbage-collection pause),
 * setInterval would queue up backlogged ticks and then fire them in a burst.
 * Rescheduling after each tick completes means the worker degrades to a lower
 * frame rate under load instead of thrashing.
 */

import { SimulationEngine } from '../../shared/simulation/engine';
import { SIMULATION_DEFAULTS } from '../../shared/constants';
import type { NodeConfig, ScenarioId, TelemetryFrame } from '../../shared/types';
import { logger } from '../../server/logger';
import type { SourceMeta, SourceState, TelemetrySource } from './types';

const log = logger('source:simulation');

export interface SimulationSourceOptions {
  nodeCount?: number;
  scenario?: ScenarioId;
  intervalMs?: number;
  speed?: number;
  seed?: number;
}

export class SimulationSource implements TelemetrySource {
  readonly kind = 'simulation' as const;

  private engine: SimulationEngine;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private handler: ((frames: TelemetryFrame[], meta: SourceMeta) => void) | null = null;
  private startedAt: string | null = null;
  private lastFrameAt: string | null = null;

  constructor(options: SimulationSourceOptions = {}) {
    this.engine = new SimulationEngine({
      nodeCount: options.nodeCount ?? SIMULATION_DEFAULTS.nodeCount,
      scenario: options.scenario ?? SIMULATION_DEFAULTS.scenario,
      intervalMs: options.intervalMs ?? SIMULATION_DEFAULTS.intervalMs,
      speed: options.speed ?? SIMULATION_DEFAULTS.speed,
      seed: options.seed,
    });
  }

  getNodes(): NodeConfig[] {
    return this.engine.getNodes();
  }

  onFrames(handler: (frames: TelemetryFrame[], meta: SourceMeta) => void): void {
    this.handler = handler;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date().toISOString();
    log.info('Simulation started', {
      nodes: this.engine.getNodeCount(),
      scenario: this.engine.getScenario(),
      intervalMs: this.engine.getIntervalMs(),
      speed: this.engine.getSpeed(),
    });
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log.info('Simulation stopped', { framesGenerated: this.engine.getFramesGenerated() });
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.runTick();
    }, this.engine.getIntervalMs());
  }

  private async runTick(): Promise<void> {
    if (!this.running) return;

    try {
      const result = this.engine.tick();
      this.lastFrameAt = new Date().toISOString();

      this.handler?.(result.frames, {
        solarElevation: result.solarElevation,
        simulatedTime: result.simulatedTime,
        droppedNodeIds: result.droppedNodeIds,
        duplicatedNodeIds: result.duplicatedNodeIds,
      });
    } catch (err) {
      // A crash inside one tick must not kill the simulator.
      log.error('Simulation tick failed', {
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.scheduleNext();
    }
  }

  // --- control surface ------------------------------------------------------

  setScenario(scenario: ScenarioId): void {
    this.engine.setScenario(scenario);
    log.info('Scenario changed', { scenario });
  }

  setIntervalMs(ms: number): void {
    this.engine.setIntervalMs(ms);
    log.info('Interval changed', { intervalMs: this.engine.getIntervalMs() });
  }

  setSpeed(speed: number): void {
    this.engine.setSpeed(speed);
    log.info('Speed changed', { speed: this.engine.getSpeed() });
  }

  setNodeCount(count: number): void {
    this.engine.setNodeCount(count);
    log.info('Node count changed', { nodeCount: this.engine.getNodeCount() });
  }

  getState(): SourceState {
    return {
      running: this.running,
      scenario: this.engine.getScenario(),
      intervalMs: this.engine.getIntervalMs(),
      speed: this.engine.getSpeed(),
      nodeCount: this.engine.getNodeCount(),
      framesGenerated: this.engine.getFramesGenerated(),
      startedAt: this.startedAt,
      lastFrameAt: this.lastFrameAt,
      lastFrame: this.engine.getLastFrame(),
      simulatedTime: this.engine.getSimulatedTime().toISOString(),
    };
  }
}
