/**
 * Telemetry source abstraction.
 *
 * THIS INTERFACE IS THE HARDWARE SWAP POINT.
 *
 * Today `SimulationSource` produces frames from the physics engine. Tomorrow
 * `MqttSource` produces them from real ESP32 nodes publishing through a
 * Raspberry Pi broker. The worker, the pipeline, the rule engine, the ML layer,
 * the API and the entire frontend are identical in both cases, because they all
 * consume `TelemetryFrame` and nothing else.
 *
 * Migrating to hardware means:
 *   1. set GRIDSYNC_SOURCE=mqtt
 *   2. point MQTT_URL at the broker on the Pi
 *   3. flash the ESP32 firmware to publish the documented payload
 *
 * No change to any other layer. That is the design goal from §74 of the spec.
 */

import type { NodeConfig, ScenarioId, TelemetryFrame } from '../../shared/types';

export interface TelemetrySource {
  /** Stable identifier, surfaced on the System Health page. */
  readonly kind: 'simulation' | 'mqtt' | 'rest';

  /** Nodes this source will report for. */
  getNodes(): NodeConfig[];

  start(): Promise<void>;
  stop(): Promise<void>;

  /**
   * Register the callback that receives each batch of frames.
   * A batch, not a single frame, because a poll or a tick can yield several.
   */
  onFrames(handler: (frames: TelemetryFrame[], meta: SourceMeta) => void): void;

  /** Whether the source is currently producing. */
  isRunning(): boolean;

  // --- Optional control surface. Only the simulator implements these; the ---
  // --- MQTT source cannot tell real hardware to have a battery fault.     ---
  setScenario?(scenario: ScenarioId): void;
  setIntervalMs?(ms: number): void;
  setSpeed?(speed: number): void;
  setNodeCount?(count: number): void;
  getState?(): SourceState;
}

/** Per-batch context the pipeline needs but that is not part of a frame. */
export interface SourceMeta {
  /** 0 at night, 1 at solar noon. Rules use it to know if daylight is expected. */
  solarElevation: number;
  /** Simulated clock, which may lead wall-clock time when speed > 1. */
  simulatedTime: Date;
  /** Nodes whose frame did not arrive this cycle. */
  droppedNodeIds: string[];
  duplicatedNodeIds: string[];
}

export interface SourceState {
  running: boolean;
  scenario: ScenarioId;
  intervalMs: number;
  speed: number;
  nodeCount: number;
  framesGenerated: number;
  startedAt: string | null;
  lastFrameAt: string | null;
  lastFrame: TelemetryFrame | null;
  simulatedTime: string;
}
