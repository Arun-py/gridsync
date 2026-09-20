/**
 * Rule engine runner.
 *
 * Two families of check run here:
 *
 *  1. FRAME RULES (shared/rules/definitions.ts) — evaluated against data that
 *     arrived. These catch process excursions and sensor faults.
 *
 *  2. COMMUNICATION RULES (below) — evaluated against the ABSENCE of data.
 *     They cannot live in the frame rules because there is no frame to pass in.
 *     This is the structural reason a stale node is a communication fault while
 *     a -127 degC reading is a sensor fault.
 *
 * De-duplication: a rule that keeps firing every second must not create 3600
 * alerts an hour. `RuleEngine` keeps a cooldown per (ruleId, nodeId) so a
 * persistent condition produces one alert that stays ACTIVE, not a flood.
 */

import { THRESHOLDS } from '../constants';
import type {
  Alert,
  AlertSource,
  EnrichedFrame,
  NodeConfig,
  RuleContext,
  Severity,
  SystemSnapshot,
} from '../types';
import { RULES } from './definitions';

export interface NodeCommunicationState {
  nodeId: string;
  lastSeen: number | null;
  lastSequence: number;
  /** Sequence numbers seen recently, for duplicate detection. */
  recentSequences: Set<number>;
  framesReceived: number;
  framesExpected: number;
  duplicatesSeen: number;
  latencySamples: number[];
}

export interface RuleEvaluationInput {
  frames: EnrichedFrame[];
  nodes: NodeConfig[];
  history: Map<string, EnrichedFrame[]>;
  snapshot: SystemSnapshot;
  solarElevation: number;
  commState: Map<string, NodeCommunicationState>;
}

/** An alert the engine wants created, before it is persisted and given an id. */
export type PendingAlert = Omit<Alert, 'id' | 'status'>;

/** Default cooldown: re-raise a still-true condition at most this often. */
const DEFAULT_COOLDOWN_MS = 120_000;

export class RuleEngine {
  private lastFired = new Map<string, number>();
  private cooldownMs: number;

  constructor(cooldownMs: number = DEFAULT_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
  }

  /** Clear cooldowns — used when a scenario changes so the demo reacts at once. */
  reset(): void {
    this.lastFired.clear();
  }

  private key(ruleId: string, nodeId: string | null): string {
    return `${ruleId}::${nodeId ?? 'system'}`;
  }

  private onCooldown(ruleId: string, nodeId: string | null, now: number): boolean {
    const last = this.lastFired.get(this.key(ruleId, nodeId));
    return last !== undefined && now - last < this.cooldownMs;
  }

  private markFired(ruleId: string, nodeId: string | null, now: number): void {
    this.lastFired.set(this.key(ruleId, nodeId), now);
  }

  evaluate(input: RuleEvaluationInput): PendingAlert[] {
    const now = Date.now();
    const alerts: PendingAlert[] = [];

    // --- 1. frame rules ----------------------------------------------------
    for (const frame of input.frames) {
      const node = input.nodes.find((n) => n.id === frame.nodeId);
      if (!node) continue;

      const ctx: RuleContext = {
        frame,
        node,
        history: input.history.get(node.id) ?? [],
        snapshot: input.snapshot,
        solarElevation: input.solarElevation,
      };

      for (const rule of RULES) {
        if (rule.appliesTo !== 'ALL' && !rule.appliesTo.includes(node.type)) continue;
        // An invalid frame must not drive PROCESS rules — a -127 degC reading
        // would otherwise trip the "temperature low" logic and mask the real
        // sensor fault. Only the sensor-integrity rule sees invalid frames.
        if (!frame.valid && rule.id !== 'SENSOR_INVALID_READING') continue;
        if (frame.valid && rule.id === 'SENSOR_INVALID_READING') continue;

        let hit;
        try {
          hit = rule.evaluate(ctx);
        } catch {
          // A broken rule must never take down the pipeline.
          continue;
        }
        if (!hit) continue;
        if (this.onCooldown(rule.id, node.id, now)) continue;
        this.markFired(rule.id, node.id, now);

        alerts.push({
          ruleId: rule.id,
          nodeId: node.id,
          timestamp: new Date(now).toISOString(),
          severity: rule.severity,
          source: rule.source,
          kind: 'DETECTED',
          condition: rule.name,
          actualValue: hit.actualValue,
          expectedValue: hit.expectedValue,
          unit: hit.unit,
          message: hit.message,
          likelyCause: hit.likelyCause,
          recommendedAction: hit.recommendedAction,
        });
      }
    }

    // --- 2. communication rules -------------------------------------------
    alerts.push(...this.evaluateCommunication(input, now));

    return alerts;
  }

  /**
   * Communication health. Evaluated from the comms state, not from frames,
   * because the signal here is data that did NOT arrive.
   */
  private evaluateCommunication(input: RuleEvaluationInput, now: number): PendingAlert[] {
    const alerts: PendingAlert[] = [];

    for (const node of input.nodes) {
      const state = input.commState.get(node.id);
      if (!state) continue;

      // --- stale / offline ---
      if (state.lastSeen !== null) {
        const age = now - state.lastSeen;

        if (age > THRESHOLDS.network.offlineMs) {
          if (!this.onCooldown('COMM_NODE_OFFLINE', node.id, now)) {
            this.markFired('COMM_NODE_OFFLINE', node.id, now);
            alerts.push(
              commAlert(node.id, 'COMM_NODE_OFFLINE', 'Node offline', 'CRITICAL', now, {
                actualValue: Math.round(age / 1000),
                expectedValue: Math.round(THRESHOLDS.network.offlineMs / 1000),
                unit: 's',
                message: `No telemetry received from ${node.shortName} for ${Math.round(age / 1000)} s.`,
                likelyCause:
                  'COMMUNICATION fault: the node has stopped reporting. The last values received remain valid measurements, but they no longer describe the present state. Possible causes are loss of power at the node, Wi-Fi or MQTT disconnection, or a crashed firmware task.',
                recommendedAction:
                  'Verify power at the node, check MQTT broker connectivity and signal strength, and power-cycle the node if it remains unreachable.',
              }),
            );
          }
        } else if (age > THRESHOLDS.network.staleMs) {
          if (!this.onCooldown('COMM_NODE_STALE', node.id, now)) {
            this.markFired('COMM_NODE_STALE', node.id, now);
            alerts.push(
              commAlert(node.id, 'COMM_NODE_STALE', 'Node data stale', 'WARNING', now, {
                actualValue: Math.round(age / 1000),
                expectedValue: Math.round(THRESHOLDS.network.staleMs / 1000),
                unit: 's',
                message: `${node.shortName} telemetry is ${Math.round(age / 1000)} s old and no longer current.`,
                likelyCause:
                  'COMMUNICATION fault: frames are being delayed or dropped in transit. The node itself may still be operating normally.',
                recommendedAction:
                  'Check link quality and broker latency. Values shown for this node should be treated as historical until it recovers.',
              }),
            );
          }
        }
      }

      // --- packet loss ---
      if (state.framesExpected >= 20) {
        const lossPercent = ((state.framesExpected - state.framesReceived) / state.framesExpected) * 100;
        if (lossPercent >= THRESHOLDS.network.packetLossWarningPercent) {
          const critical = lossPercent >= THRESHOLDS.network.packetLossCriticalPercent;
          const ruleId = 'COMM_PACKET_LOSS';
          if (!this.onCooldown(ruleId, node.id, now)) {
            this.markFired(ruleId, node.id, now);
            alerts.push(
              commAlert(node.id, ruleId, 'Packet loss', critical ? 'CRITICAL' : 'WARNING', now, {
                actualValue: Math.round(lossPercent * 10) / 10,
                expectedValue: THRESHOLDS.network.packetLossWarningPercent,
                unit: '%',
                message: `${node.shortName} is losing ${lossPercent.toFixed(1)} % of telemetry frames.`,
                likelyCause:
                  'COMMUNICATION fault: sequence-number gaps indicate frames are being dropped between the node and the broker. Weak signal, RF interference or broker saturation are typical causes.',
                recommendedAction:
                  'Check RSSI at the node, reduce distance or add a repeater, and confirm the broker is not dropping messages under load.',
              }),
            );
          }
        }
      }

      // --- duplicate packets ---
      if (state.duplicatesSeen > 0 && !this.onCooldown('COMM_DUPLICATE_PACKET', node.id, now)) {
        this.markFired('COMM_DUPLICATE_PACKET', node.id, now);
        alerts.push(
          commAlert(node.id, 'COMM_DUPLICATE_PACKET', 'Duplicate packets', 'INFO', now, {
            actualValue: state.duplicatesSeen,
            unit: 'frames',
            message: `${state.duplicatesSeen} duplicate frame(s) received from ${node.shortName} (repeated sequence numbers).`,
            likelyCause:
              'COMMUNICATION fault: QoS-1 redelivery after an unacknowledged publish, or a node retransmitting because it did not see the broker acknowledgement.',
            recommendedAction:
              'Duplicates are de-duplicated on ingest by sequence number and do not corrupt stored data. Persistent duplication indicates an unstable link worth investigating.',
          }),
        );
      }

      // --- latency ---
      if (state.latencySamples.length >= 5) {
        const avg = state.latencySamples.reduce((a, b) => a + b, 0) / state.latencySamples.length;
        if (avg >= THRESHOLDS.network.latencyWarningMs) {
          const critical = avg >= THRESHOLDS.network.latencyCriticalMs;
          if (!this.onCooldown('COMM_HIGH_LATENCY', node.id, now)) {
            this.markFired('COMM_HIGH_LATENCY', node.id, now);
            alerts.push(
              commAlert(node.id, 'COMM_HIGH_LATENCY', 'High transport latency', critical ? 'WARNING' : 'INFO', now, {
                actualValue: Math.round(avg),
                expectedValue: THRESHOLDS.network.latencyWarningMs,
                unit: 'ms',
                message: `Average delivery latency from ${node.shortName} is ${Math.round(avg)} ms.`,
                likelyCause:
                  'COMMUNICATION degradation: congested link, weak signal forcing retransmissions, or an overloaded broker.',
                recommendedAction:
                  'Review link quality and broker load. Live values may lag reality by roughly this margin.',
              }),
            );
          }
        }
      }
    }

    return alerts;
  }
}

function commAlert(
  nodeId: string,
  ruleId: string,
  condition: string,
  severity: Severity,
  now: number,
  fields: {
    actualValue?: number;
    expectedValue?: number;
    unit?: string;
    message: string;
    likelyCause: string;
    recommendedAction: string;
  },
): PendingAlert {
  return {
    ruleId,
    nodeId,
    timestamp: new Date(now).toISOString(),
    severity,
    source: 'COMMUNICATION' as AlertSource,
    kind: 'DETECTED',
    condition,
    ...fields,
  };
}

/** Fresh communication state for a node. */
export function createCommState(nodeId: string): NodeCommunicationState {
  return {
    nodeId,
    lastSeen: null,
    lastSequence: 0,
    recentSequences: new Set(),
    framesReceived: 0,
    framesExpected: 0,
    duplicatesSeen: 0,
    latencySamples: [],
  };
}

/**
 * Fold one arriving frame into a node's communication state.
 *
 * Returns `true` when the frame is a DUPLICATE and should not be stored again.
 * Sequence gaps are counted as expected-but-missing frames, which is what makes
 * packet loss measurable rather than guessed.
 */
export function recordFrameArrival(
  state: NodeCommunicationState,
  sequenceNumber: number,
  receivedAt: number,
  producedAt: number,
): boolean {
  const isDuplicate = state.recentSequences.has(sequenceNumber);

  if (isDuplicate) {
    state.duplicatesSeen += 1;
    return true;
  }

  state.recentSequences.add(sequenceNumber);
  // Bound the set so it cannot grow without limit.
  if (state.recentSequences.size > 500) {
    const oldest = state.recentSequences.values().next().value;
    if (oldest !== undefined) state.recentSequences.delete(oldest);
  }

  if (state.lastSequence > 0 && sequenceNumber > state.lastSequence) {
    state.framesExpected += sequenceNumber - state.lastSequence;
  } else {
    state.framesExpected += 1;
  }

  state.framesReceived += 1;
  state.lastSequence = Math.max(state.lastSequence, sequenceNumber);
  state.lastSeen = receivedAt;

  const latency = receivedAt - producedAt;
  if (Number.isFinite(latency) && latency >= 0) {
    state.latencySamples.push(latency);
    if (state.latencySamples.length > 50) state.latencySamples.shift();
  }

  return false;
}

/** Derive a node's status purely from how recently it was heard from. */
export function deriveNodeStatus(lastSeen: number | null, now: number, frameValid = true): EnrichedFrame['status'] {
  if (lastSeen === null) return 'OFFLINE';
  const age = now - lastSeen;
  if (age > THRESHOLDS.network.offlineMs) return 'OFFLINE';
  if (age > THRESHOLDS.network.staleMs) return 'STALE';
  if (!frameValid) return 'FAULT';
  return 'ONLINE';
}
