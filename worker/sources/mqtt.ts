/**
 * MQTT telemetry source — the real-hardware path.
 *
 * STATUS: implemented and wired, but UNDER DEVELOPMENT because the physical
 * ESP32 nodes and Raspberry Pi broker are not yet deployed. It is not a stub:
 * point MQTT_URL at a broker publishing the documented payload and it works.
 * Nothing here fabricates a reading — if no hardware publishes, no frames flow
 * and every node correctly ages to STALE and then OFFLINE.
 *
 *   ESP32 ──publish──> MQTT broker (Raspberry Pi 5) ──subscribe──> this source
 *        ──> Pipeline ──> MongoDB ──> rules + ML ──> API ──> dashboard
 *
 * TOPIC SCHEME (carried forward from the v1 prototype's mqtt_listener.py)
 *   gridsync/<nodeId>            telemetry payload
 *   gridsync/<nodeId>/status     optional last-will / heartbeat
 *
 * EXPECTED PAYLOAD (JSON) — matches TelemetryFrame; unknown fields are ignored
 *   {
 *     "nodeId": "sigma",  "nodeType": "SOLAR",
 *     "voltage": 17.8,    "current": 4.2,      "power": 74.8,
 *     "temperature": 41.2,"lux": 68000,        "soc": null,
 *     "sequenceNumber": 10432,
 *     "timestamp": "2026-09-18T09:15:02.000Z",
 *     "firmwareVersion": "1.4.2", "rssi": -61, "uptime": 86400
 *   }
 *
 * A device that cannot keep wall-clock time may omit `timestamp`; ingest then
 * stamps arrival time and `normaliseFrame` records that it did so.
 */

import mqtt, { type MqttClient } from 'mqtt';

import { resolveNodes } from '../../shared/nodes.config';
import { normaliseFrame } from '../../shared/validation';
import { solarElevation } from '../../shared/physics';
import type { NodeConfig, TelemetryFrame } from '../../shared/types';
import { env } from '../../server/env';
import { errorFields, logger } from '../../server/logger';
import type { SourceMeta, TelemetrySource } from './types';

const log = logger('source:mqtt');

export class MqttSource implements TelemetrySource {
  readonly kind = 'mqtt' as const;

  private client: MqttClient | null = null;
  private running = false;
  private handler: ((frames: TelemetryFrame[], meta: SourceMeta) => void) | null = null;
  private nodes: NodeConfig[];

  /**
   * Frames are batched over a short window rather than processed one at a time.
   * Four nodes publishing independently at 1 Hz would otherwise trigger four
   * separate pipeline runs per second, each computing a system-wide snapshot
   * from partial data.
   */
  private buffer: TelemetryFrame[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs = 1000;

  constructor(nodeCount = 4) {
    this.nodes = resolveNodes(nodeCount);
  }

  getNodes(): NodeConfig[] {
    return this.nodes;
  }

  onFrames(handler: (frames: TelemetryFrame[], meta: SourceMeta) => void): void {
    this.handler = handler;
  }

  isRunning(): boolean {
    return this.running && (this.client?.connected ?? false);
  }

  async start(): Promise<void> {
    if (this.running) return;

    const url = env.mqttUrl;
    log.info('Connecting to MQTT broker', { url, topicPrefix: env.mqttTopicPrefix });

    this.client = mqtt.connect(url, {
      username: env.mqttUsername || undefined,
      password: env.mqttPassword || undefined,
      // Bounded backoff: a broker that is down must not be hammered.
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      clean: true,
      clientId: `gridsync-worker-${Math.random().toString(16).slice(2, 10)}`,
    });

    this.client.on('connect', () => {
      const topic = `${env.mqttTopicPrefix}/+`;
      this.client?.subscribe(topic, { qos: 1 }, (err) => {
        if (err) log.error('MQTT subscribe failed', errorFields(err));
        else log.info('Subscribed', { topic });
      });
    });

    this.client.on('message', (topic, payload) => this.handleMessage(topic, payload));

    this.client.on('error', (err) => log.error('MQTT error', errorFields(err)));
    this.client.on('reconnect', () => log.warn('MQTT reconnecting'));
    this.client.on('close', () => log.warn('MQTT connection closed'));

    this.running = true;
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await new Promise<void>((resolve) => {
      if (!this.client) return resolve();
      this.client.end(false, {}, () => resolve());
    });
    this.client = null;
    log.info('MQTT source stopped');
  }

  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const nodeId = topic.split('/').pop() ?? '';
      const node = this.nodes.find((n) => n.id === nodeId);
      if (!node) {
        log.warn('Message for unknown node ignored', { topic });
        return;
      }

      const raw = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;

      // Normalise + validate. A malformed payload from a faulty device is
      // recorded as a sensor fault, not silently dropped and not trusted.
      const frame = normaliseFrame(
        { ...raw, nodeId: node.id, nodeType: node.type, mode: 'REALTIME', source: 'ESP32' },
        node,
        'ESP32',
      );

      this.buffer.push(frame);
    } catch (err) {
      log.warn('Unparseable MQTT payload discarded', { topic, ...errorFields(err) });
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const frames = this.buffer;
    this.buffer = [];

    const now = new Date();
    const hourOfDay = now.getHours() + now.getMinutes() / 60;

    this.handler?.(frames, {
      // Real deployments compute elevation from the real clock and, later,
      // from site latitude/longitude.
      solarElevation: solarElevation(hourOfDay),
      simulatedTime: now,
      droppedNodeIds: [],
      duplicatedNodeIds: [],
    });
  }
}
