/**
 * The GridSync processing pipeline.
 *
 *   telemetry in
 *        -> validate            (sensor faults caught here)
 *        -> de-duplicate        (repeated sequence numbers dropped)
 *        -> persist             (MongoDB, best-effort)
 *        -> enrich              (efficiency, battery state, age)
 *        -> snapshot            (system-wide totals)
 *        -> RULE ENGINE         (deterministic; always runs)
 *        -> ML INFERENCE        (advisory; may be absent)
 *        -> alerts + predictions
 *        -> subscribers         (SSE stream to the browser)
 *
 * This is the single code path. The worker drives it with simulated frames
 * today and with MQTT frames from real hardware tomorrow — the pipeline cannot
 * tell the difference, which is precisely the point.
 *
 * DEGRADATION POLICY
 * A database outage must not stop monitoring. If Mongo is unavailable the
 * pipeline keeps evaluating rules and streaming to connected clients from the
 * in-memory window, and reports the degraded state honestly rather than
 * pretending everything is fine.
 */

import { SIMULATION_DEFAULTS, THRESHOLDS } from '../shared/constants';
import { expectedSolarPower } from '../shared/physics';
import {
  createCommState,
  deriveNodeStatus,
  recordFrameArrival,
  RuleEngine,
  type NodeCommunicationState,
  type PendingAlert,
} from '../shared/rules/engine';
import { extractFeatures } from '../shared/ml/features';
import { validateFrame } from '../shared/validation';
import type {
  Alert,
  AppMode,
  EnrichedFrame,
  NodeConfig,
  Prediction,
  ScenarioId,
  SystemHealth,
  SystemSnapshot,
  TelemetryFrame,
} from '../shared/types';
import { predict } from './ml';
import { errorFields, logger } from './logger';

const log = logger('pipeline');

export interface PipelineOptions {
  nodes: NodeConfig[];
  mode: AppMode;
  /** Persist frames, alerts and predictions. Disabled when Mongo is down. */
  persist?: PipelinePersistence;
  /** Run ML inference at most this often per node (ms). Inference is not free. */
  inferenceIntervalMs?: number;
}

/** Storage side-effects, injected so the pipeline stays testable without a DB. */
export interface PipelinePersistence {
  saveFrames(frames: TelemetryFrame[]): Promise<void>;
  saveAlerts(alerts: Alert[]): Promise<void>;
  savePredictions(predictions: Prediction[]): Promise<void>;
}

export interface PipelineResult {
  frames: EnrichedFrame[];
  snapshot: SystemSnapshot;
  newAlerts: Alert[];
  predictions: Prediction[];
  health: SystemHealth;
}

export class Pipeline {
  private nodes: NodeConfig[];
  private mode: AppMode;
  private persist?: PipelinePersistence;
  private ruleEngine = new RuleEngine();

  /** Rolling per-node window backing trends, features and the degraded path. */
  private history = new Map<string, EnrichedFrame[]>();
  private commState = new Map<string, NodeCommunicationState>();
  private latest = new Map<string, EnrichedFrame>();

  private lastInferenceAt = new Map<string, number>();
  private inferenceIntervalMs: number;

  private scenario: ScenarioId = 'NORMAL';
  private solarElevation = 0;

  /** Set when persistence fails, so the UI can show a truthful degraded state. */
  private dbHealthy = true;
  private dbError: string | null = null;

  constructor(options: PipelineOptions) {
    this.nodes = options.nodes;
    this.mode = options.mode;
    this.persist = options.persist;
    // Default 5 s: fast enough to feel live, slow enough not to burn CPU
    // running a 80-tree forest 4x per second.
    this.inferenceIntervalMs = options.inferenceIntervalMs ?? 5000;
    this.resetNodes(options.nodes);
  }

  resetNodes(nodes: NodeConfig[]): void {
    this.nodes = nodes;
    for (const node of nodes) {
      if (!this.history.has(node.id)) this.history.set(node.id, []);
      if (!this.commState.has(node.id)) this.commState.set(node.id, createCommState(node.id));
    }
  }

  setScenario(scenario: ScenarioId): void {
    this.scenario = scenario;
    // Clear rule cooldowns so a scenario switch shows up in the UI immediately
    // instead of waiting out a two-minute suppression window.
    this.ruleEngine.reset();
  }

  setSolarElevation(elevation: number): void {
    this.solarElevation = elevation;
  }

  getLatestFrames(): EnrichedFrame[] {
    return [...this.latest.values()];
  }

  getHistory(nodeId: string): EnrichedFrame[] {
    return this.history.get(nodeId) ?? [];
  }

  getNodes(): NodeConfig[] {
    return this.nodes;
  }

  markDbHealth(healthy: boolean, error: string | null = null): void {
    this.dbHealthy = healthy;
    this.dbError = error;
  }

  // -------------------------------------------------------------------------
  // The main entry point
  // -------------------------------------------------------------------------

  async process(rawFrames: TelemetryFrame[]): Promise<PipelineResult> {
    const now = Date.now();

    // --- 1. validate + de-duplicate ---------------------------------------
    const accepted: EnrichedFrame[] = [];

    for (const raw of rawFrames) {
      const node = this.nodes.find((n) => n.id === raw.nodeId);
      if (!node) {
        log.warn('Frame for unknown node discarded', { nodeId: raw.nodeId });
        continue;
      }

      const state = this.commState.get(node.id) ?? createCommState(node.id);
      this.commState.set(node.id, state);

      const producedAt = new Date(raw.timestamp).getTime();
      const isDuplicate = recordFrameArrival(state, raw.sequenceNumber, now, producedAt);
      if (isDuplicate) {
        // Counted for the communication rules, but NOT stored or re-processed:
        // the same measurement twice would distort every average downstream.
        continue;
      }

      const validation = validateFrame(raw, node);
      const frame: TelemetryFrame = {
        ...raw,
        valid: validation.valid,
        validationErrors: validation.valid ? undefined : validation.errors,
        status: deriveNodeStatus(state.lastSeen, now, validation.valid),
      };

      accepted.push(this.enrich(frame, node, now));
    }

    // --- 2. update rolling state ------------------------------------------
    for (const frame of accepted) {
      this.latest.set(frame.nodeId, frame);
      const window = this.history.get(frame.nodeId) ?? [];
      window.push(frame);
      if (window.length > SIMULATION_DEFAULTS.historyWindow) window.shift();
      this.history.set(frame.nodeId, window);
    }

    // Nodes that did not report this cycle still need their status ageing, or
    // a disconnected node would sit at ONLINE forever showing stale values.
    for (const node of this.nodes) {
      const last = this.latest.get(node.id);
      if (!last) continue;
      const state = this.commState.get(node.id);
      const status = deriveNodeStatus(state?.lastSeen ?? null, now, last.valid);
      if (status !== last.status) {
        this.latest.set(node.id, { ...last, status, ageMs: now - new Date(last.timestamp).getTime() });
      }
    }

    // --- 3. snapshot -------------------------------------------------------
    const snapshot = this.buildSnapshot(now);

    // --- 4. persist (best effort) -----------------------------------------
    if (this.persist && accepted.length > 0) {
      try {
        await this.persist.saveFrames(accepted);
        if (!this.dbHealthy) {
          log.info('Database recovered');
          this.markDbHealth(true);
        }
      } catch (err) {
        // Do not throw: monitoring continues from memory.
        if (this.dbHealthy) {
          log.error('Telemetry persistence failed — continuing in degraded mode', errorFields(err));
        }
        this.markDbHealth(false, err instanceof Error ? err.name : 'PersistenceError');
      }
    }

    // --- 5. rule engine (always runs) -------------------------------------
    const pending = this.ruleEngine.evaluate({
      frames: accepted,
      nodes: this.nodes,
      history: this.history,
      snapshot,
      solarElevation: this.solarElevation,
      commState: this.commState,
    });

    const newAlerts: Alert[] = pending.map((p) => this.toAlert(p));

    // --- 6. ML inference (advisory, rate-limited) -------------------------
    const predictions = this.runInference(accepted, snapshot, now);

    // Surface a model prediction as an alert ONLY when it is confident and not
    // NORMAL. It is marked kind: 'PREDICTED' and source: 'ML' so the UI can
    // never present it as a measured detection.
    for (const p of predictions) {
      if (p.predictedClass === 'NORMAL') continue;
      if (p.confidence < 0.7) continue;
      newAlerts.push(this.predictionToAlert(p));
    }

    // --- 7. persist derived records ---------------------------------------
    if (this.persist) {
      if (newAlerts.length > 0) {
        this.persist.saveAlerts(newAlerts).catch((err) => {
          log.error('Alert persistence failed', errorFields(err));
          this.markDbHealth(false, 'PersistenceError');
        });
      }
      if (predictions.length > 0) {
        this.persist.savePredictions(predictions).catch((err) => {
          log.error('Prediction persistence failed', errorFields(err));
        });
      }
    }

    if (newAlerts.length > 0) {
      log.info('Alerts raised', {
        count: newAlerts.length,
        rules: newAlerts.map((a) => a.ruleId ?? a.source),
      });
    }

    return {
      frames: this.getLatestFrames(),
      snapshot,
      newAlerts,
      predictions,
      health: this.buildHealth(now),
    };
  }

  // -------------------------------------------------------------------------
  // Enrichment
  // -------------------------------------------------------------------------

  private enrich(frame: TelemetryFrame, node: NodeConfig, now: number): EnrichedFrame {
    const ageMs = Math.max(0, now - new Date(frame.timestamp).getTime());
    const enriched: EnrichedFrame = { ...frame, ageMs };

    if (node.type === 'SOLAR' && typeof frame.lux === 'number' && frame.lux > 500) {
      const expected = expectedSolarPower(node, frame.lux, frame.temperature ?? 25);
      enriched.efficiency = expected > 1 ? Math.min(2, Math.max(0, frame.power / expected)) : undefined;
    }

    if (node.type === 'BATTERY') {
      // Sign convention: positive current charges the bank.
      enriched.batteryState = frame.current > 0.3 ? 'CHARGING' : frame.current < -0.3 ? 'DISCHARGING' : 'IDLE';
    }

    return enriched;
  }

  private buildSnapshot(now: number): SystemSnapshot {
    const frames = this.getLatestFrames();
    // Stale and invalid frames are excluded from live totals — showing a
    // dead node's last reading inside "current generation" would be a lie.
    const live = frames.filter((f) => f.valid && f.status !== 'OFFLINE' && f.status !== 'STALE');

    const ofType = (t: NodeConfig['type']) =>
      live.filter((f) => this.nodes.find((n) => n.id === f.nodeId)?.type === t);

    const generationW = round2(ofType('SOLAR').reduce((s, f) => s + f.power, 0));
    const acLoadW = round2(ofType('AC_LOAD').reduce((s, f) => s + f.power, 0));
    const dcLoadW = round2(ofType('DC_LOAD').reduce((s, f) => s + f.power, 0));
    const consumptionW = round2(acLoadW + dcLoadW);

    const batteries = ofType('BATTERY');
    const batteryPowerW = batteries.length ? round2(batteries.reduce((s, f) => s + f.power, 0)) : null;
    const batterySoc = batteries.length
      ? round2(batteries.reduce((s, f) => s + (f.soc ?? 0), 0) / batteries.length)
      : null;
    const batteryState = batteryPowerW === null
      ? null
      : batteryPowerW > 5
        ? 'CHARGING'
        : batteryPowerW < -5
          ? 'DISCHARGING'
          : 'IDLE';

    // Efficiency over the recent window, not the instant: an instantaneous
    // ratio swings wildly and means very little.
    const systemEfficiency = this.windowEfficiency();

    const onlineCount = frames.filter((f) => f.status === 'ONLINE').length;

    return {
      timestamp: new Date(now).toISOString(),
      mode: this.mode,
      scenario: this.scenario,
      generationW,
      consumptionW,
      netPowerW: round2(generationW - consumptionW),
      batterySoc,
      batteryPowerW,
      batteryState,
      acLoadW,
      dcLoadW,
      systemEfficiency,
      nodesOnline: onlineCount,
      nodesTotal: this.nodes.length,
      activeAlerts: { info: 0, warning: 0, critical: 0 },
      edgeMode: !this.dbHealthy,
    };
  }

  /** Delivered load / available generation over the rolling window. */
  private windowEfficiency(): number | null {
    let gen = 0;
    let load = 0;
    for (const node of this.nodes) {
      const window = this.history.get(node.id) ?? [];
      const valid = window.filter((f) => f.valid);
      if (valid.length === 0) continue;
      const total = valid.reduce((s, f) => s + f.power, 0);
      if (node.type === 'SOLAR') gen += total;
      else if (node.type === 'AC_LOAD' || node.type === 'DC_LOAD') load += total;
    }
    if (gen <= 0) return null;
    return Math.round(Math.min(1, load / gen) * 1000) / 1000;
  }

  // -------------------------------------------------------------------------
  // Inference
  // -------------------------------------------------------------------------

  private runInference(frames: EnrichedFrame[], snapshot: SystemSnapshot, now: number): Prediction[] {
    const out: Prediction[] = [];

    for (const frame of frames) {
      const node = this.nodes.find((n) => n.id === frame.nodeId);
      if (!node) continue;

      // An invalid frame must not be fed to the model: garbage in, confident
      // garbage out. The sensor-fault RULE already covers this case.
      if (!frame.valid) continue;

      const last = this.lastInferenceAt.get(node.id) ?? 0;
      if (now - last < this.inferenceIntervalMs) continue;
      this.lastInferenceAt.set(node.id, now);

      const features = extractFeatures(
        frame,
        node,
        this.history.get(node.id) ?? [],
        snapshot,
        this.solarElevation,
      );

      const { prediction, error } = predict(node.id, features);
      if (!prediction) {
        if (error) log.debug('Inference unavailable', { nodeId: node.id, error });
        continue;
      }

      out.push({ ...prediction, id: `pred_${node.id}_${now}` });
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // Alert construction
  // -------------------------------------------------------------------------

  private toAlert(p: PendingAlert): Alert {
    return {
      ...p,
      id: `alrt_${p.ruleId ?? 'sys'}_${p.nodeId ?? 'system'}_${Date.parse(p.timestamp)}`,
      status: 'ACTIVE',
    };
  }

  private predictionToAlert(p: Prediction): Alert {
    const severity =
      p.predictedClass === 'BATTERY_OVERHEAT' || p.predictedClass === 'OVERLOAD'
        ? 'CRITICAL'
        : 'WARNING';

    return {
      id: `alrt_ml_${p.nodeId}_${Date.parse(p.timestamp)}`,
      ruleId: `ML_${p.predictedClass}`,
      nodeId: p.nodeId,
      timestamp: p.timestamp,
      severity,
      source: 'ML',
      // PREDICTED, never DETECTED. The UI renders this differently.
      kind: 'PREDICTED',
      condition: `Model predicts ${p.predictedClass}`,
      status: 'ACTIVE',
      actualValue: Math.round(p.confidence * 100),
      unit: '% confidence',
      message: `Model predicts ${humanise(p.predictedClass)} for this node at ${(p.confidence * 100).toFixed(0)} % confidence.`,
      likelyCause: p.explanation,
      recommendedAction: p.recommendedAction,
      modelVersion: p.modelVersion,
      confidence: p.confidence,
    };
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  private buildHealth(now: number): SystemHealth {
    let totalExpected = 0;
    let totalReceived = 0;
    let duplicates = 0;
    const latencies: number[] = [];
    const staleNodes: string[] = [];

    for (const node of this.nodes) {
      const state = this.commState.get(node.id);
      if (!state) continue;
      totalExpected += state.framesExpected;
      totalReceived += state.framesReceived;
      duplicates += state.duplicatesSeen;
      latencies.push(...state.latencySamples);
      const status = deriveNodeStatus(state.lastSeen, now);
      if (status === 'STALE' || status === 'OFFLINE') staleNodes.push(node.id);
    }

    const packetLoss = totalExpected > 0
      ? Math.max(0, ((totalExpected - totalReceived) / totalExpected) * 100)
      : 0;
    const avgLatency = latencies.length
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    const commDegraded =
      packetLoss >= THRESHOLDS.network.packetLossWarningPercent || staleNodes.length > 0;

    // The edge keeps working when the cloud does not. That distinction is the
    // whole point of the architecture, so it is reported explicitly rather
    // than collapsed into one "system down" flag.
    const edgeOperational = true; // this process is running, by definition
    const internetReachable = this.dbHealthy;

    return {
      timestamp: new Date(now).toISOString(),
      components: [
        {
          id: 'simulator',
          name: 'Simulation Engine',
          status: this.mode === 'SIMULATION' ? 'SIMULATED' : 'OFFLINE',
          detail:
            this.mode === 'SIMULATION'
              ? `Generating telemetry for ${this.nodes.length} nodes (scenario ${this.scenario})`
              : 'Not in use — platform is in realtime mode',
          lastCheck: new Date(now).toISOString(),
        },
        {
          id: 'mongodb',
          name: 'MongoDB Atlas',
          status: this.dbHealthy ? 'ONLINE' : 'OFFLINE',
          detail: this.dbHealthy
            ? 'Telemetry is being persisted'
            : `Unreachable (${this.dbError ?? 'unknown'}) — running from local buffer`,
          lastCheck: new Date(now).toISOString(),
        },
        {
          id: 'ml_engine',
          name: 'ML Inference Engine',
          status: 'UNKNOWN', // replaced by the worker, which knows the model state
          detail: '',
          lastCheck: new Date(now).toISOString(),
        },
        {
          id: 'realtime',
          name: 'Realtime Stream',
          status: commDegraded ? 'DEGRADED' : 'ONLINE',
          detail: commDegraded
            ? `${staleNodes.length} node(s) not reporting, ${packetLoss.toFixed(1)} % frame loss`
            : 'All nodes reporting',
          latencyMs: Math.round(avgLatency),
          lastCheck: new Date(now).toISOString(),
        },
        {
          id: 'mqtt',
          name: 'MQTT Broker',
          status: this.mode === 'SIMULATION' ? 'SIMULATED' : 'UNKNOWN',
          detail:
            this.mode === 'SIMULATION'
              ? 'Bypassed in simulation mode — the adapter exists and is wired'
              : 'Awaiting hardware integration',
          lastCheck: new Date(now).toISOString(),
        },
        {
          id: 'raspberry_pi',
          name: 'Raspberry Pi Edge Node',
          status: 'SIMULATED',
          detail: 'Hardware integration under development — architecture in place',
          lastCheck: new Date(now).toISOString(),
        },
        {
          id: 'api',
          name: 'GridSync API',
          status: 'ONLINE',
          detail: 'Serving requests',
          lastCheck: new Date(now).toISOString(),
        },
      ],
      edgeMode: !this.dbHealthy,
      internetReachable,
      edgeOperational,
      network: {
        packetLossPercent: Math.round(packetLoss * 10) / 10,
        averageLatencyMs: Math.round(avgLatency),
        duplicatePackets: duplicates,
        staleNodes,
      },
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function humanise(cls: string): string {
  return cls.toLowerCase().replace(/_/g, ' ');
}
