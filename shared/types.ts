/**
 * GridSync — shared domain contracts.
 *
 * These types are the single source of truth for the simulator, the worker,
 * the API and the web app. A telemetry frame produced by the simulator and a
 * frame produced by a real ESP32 node are the SAME shape — that is what makes
 * the hardware swap a source-adapter change rather than a redesign.
 */

// ---------------------------------------------------------------------------
// Modes and provenance
// ---------------------------------------------------------------------------

/** How the platform is currently being fed. Surfaced in the UI at all times. */
export type AppMode = 'SIMULATION' | 'REALTIME';

/** Where an individual telemetry frame physically came from. Never inferred. */
export type TelemetrySource = 'SIMULATION' | 'ESP32' | 'RASPBERRY_PI' | 'MQTT' | 'REST';

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export type NodeType = 'SOLAR' | 'BATTERY' | 'AC_LOAD' | 'DC_LOAD';

export type NodeCriticality = 'CRITICAL' | 'NON_CRITICAL';

export type SensorKind = 'voltage' | 'current' | 'power' | 'temperature' | 'lux' | 'soc';

/**
 * Data-driven node definition. The frontend discovers nodes from the API and
 * renders whatever it is given — nothing is hardcoded to four nodes.
 */
export interface NodeConfig {
  id: string;
  name: string;
  /** Display label, e.g. "SIGMA". */
  shortName: string;
  type: NodeType;
  category: string;
  description: string;
  sensors: SensorKind[];
  /** Nameplate rating in watts. */
  ratedPower: number;
  voltageRange: [number, number];
  currentRange: [number, number];
  criticality: NodeCriticality;
  /** Nominal bus voltage this node sits on. */
  nominalVoltage: number;
  /** Battery-only: usable capacity in amp-hours. */
  capacityAh?: number;
}

export type NodeStatus = 'ONLINE' | 'DEGRADED' | 'STALE' | 'OFFLINE' | 'FAULT';

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * One telemetry frame from one node.
 *
 * Optional fields are genuinely optional: a load node has no `lux`, an AC node
 * has no `soc`. Consumers must not assume presence — check `NodeConfig.sensors`.
 */
export interface TelemetryFrame {
  nodeId: string;
  nodeType: NodeType;
  /** ISO-8601 UTC. Normalised on ingest. */
  timestamp: string;

  voltage: number;
  current: number;
  /** Always V x I, computed at the source. Stored so queries need no $expr. */
  power: number;

  temperature?: number;
  lux?: number;
  /** Battery state of charge, 0-100. */
  soc?: number;

  status: NodeStatus;
  mode: AppMode;
  source: TelemetrySource;

  /** Monotonic per node. Gaps reveal packet loss; repeats reveal duplicates. */
  sequenceNumber: number;

  // --- Device health (populated by real hardware; simulated plausibly) ---
  firmwareVersion?: string;
  /** Wi-Fi signal strength in dBm. */
  rssi?: number;
  /** Node uptime in seconds. */
  uptime?: number;

  // --- Validation outcome, attached on ingest ---
  valid: boolean;
  validationErrors?: string[];
}

/** A frame plus the derived quantities the UI needs but must not recompute ad hoc. */
export interface EnrichedFrame extends TelemetryFrame {
  /** Solar only: measured power / irradiance-expected power, 0-1. */
  efficiency?: number;
  /** Battery only. */
  batteryState?: 'CHARGING' | 'DISCHARGING' | 'IDLE';
  /** Milliseconds since this frame was produced. */
  ageMs: number;
}

// ---------------------------------------------------------------------------
// System snapshot — what the dashboard renders
// ---------------------------------------------------------------------------

export interface SystemSnapshot {
  timestamp: string;
  mode: AppMode;
  scenario: ScenarioId;

  /** Total instantaneous solar generation, W. */
  generationW: number;
  /** Total instantaneous load, W (AC + DC). */
  consumptionW: number;
  /** generation - consumption. Positive = surplus. */
  netPowerW: number;

  batterySoc: number | null;
  batteryPowerW: number | null;
  batteryState: 'CHARGING' | 'DISCHARGING' | 'IDLE' | null;

  acLoadW: number;
  dcLoadW: number;

  /** Delivered load / available generation over the recent window, 0-1. */
  systemEfficiency: number | null;

  nodesOnline: number;
  nodesTotal: number;

  activeAlerts: { info: number; warning: number; critical: number };

  /** True when the platform is running on local/edge processing only. */
  edgeMode: boolean;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type ScenarioId =
  | 'NORMAL'
  | 'SOLAR_FAULT'
  | 'BATTERY_FAULT'
  | 'OVERLOAD'
  | 'NETWORK_FAILURE'
  | 'BROWNOUT'
  | 'SENSOR_FAILURE'
  | 'PANEL_SOILING'
  | 'BATTERY_OVERHEATING'
  | 'HIGH_DEMAND'
  | 'NIGHT_MODE';

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  description: string;
  /** What an operator should expect to observe. Shown on the Demo Control page. */
  expectedEffects: string[];
  severity: 'NORMAL' | 'WARNING' | 'CRITICAL';
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertSource = 'RULE' | 'ML' | 'SYSTEM' | 'COMMUNICATION';
export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';

/**
 * Distinguishes a measured threshold breach from a model's opinion.
 * The UI wording keys off this and must never blur the two.
 */
export type AlertKind = 'DETECTED' | 'PREDICTED';

export interface Alert {
  id: string;
  ruleId?: string;
  nodeId: string | null;
  timestamp: string;
  severity: Severity;
  source: AlertSource;
  kind: AlertKind;

  /** Short machine-ish label, e.g. "Battery temperature above limit". */
  condition: string;
  /** The reading that triggered it. */
  actualValue?: number;
  /** The threshold or model-expected value it was compared against. */
  expectedValue?: number;
  unit?: string;

  message: string;
  /** Hypothesis, not a confirmed physical finding. Worded accordingly. */
  likelyCause: string;
  recommendedAction: string;

  status: AlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;

  /** Set when source === 'ML'. */
  modelVersion?: string;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface RuleContext {
  frame: EnrichedFrame;
  node: NodeConfig;
  /** Recent frames for this node, newest last. Enables trend rules. */
  history: EnrichedFrame[];
  snapshot: SystemSnapshot;
  /** Simulated solar elevation 0-1; 0 at night. Lets rules know if daylight is expected. */
  solarElevation: number;
}

export interface RuleDefinition {
  id: string;
  name: string;
  appliesTo: NodeType[] | 'ALL';
  severity: Severity;
  source: AlertSource;
  condition: string;
  evaluate(ctx: RuleContext): RuleHit | null;
}

export interface RuleHit {
  actualValue?: number;
  expectedValue?: number;
  unit?: string;
  message: string;
  likelyCause: string;
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// ML
// ---------------------------------------------------------------------------

export type FaultClass =
  | 'NORMAL'
  | 'SOLAR_SHADING'
  | 'SOLAR_SOILING'
  | 'BATTERY_FAULT'
  | 'BATTERY_OVERHEAT'
  | 'LOW_SOC'
  | 'OVERLOAD'
  | 'BROWNOUT'
  | 'COMMUNICATION_FAULT'
  | 'SENSOR_FAULT'
  | 'ABNORMAL_CONSUMPTION';

/** Ordered feature vector. Order MUST match ml/features/feature_engineering.py. */
export interface FeatureVector {
  voltage: number;
  current: number;
  power: number;
  temperature: number;
  lux: number;
  soc: number;
  generationW: number;
  loadW: number;
  energyImbalanceW: number;
  voltageTrend: number;
  currentTrend: number;
  temperatureTrend: number;
  socTrend: number;
  powerRollingMean: number;
  powerRateOfChange: number;
  solarElevation: number;
  /** Measured power / irradiance-expected power. 0 for non-solar nodes. */
  efficiencyRatio: number;
}

export interface Prediction {
  id: string;
  nodeId: string;
  timestamp: string;
  predictedClass: FaultClass;
  confidence: number;
  /** Full probability distribution across classes. */
  classProbabilities: Partial<Record<FaultClass, number>>;
  /** Feature contributions, most influential first. Model signals, not proof. */
  contributingFeatures: Array<{ feature: string; value: number; importance: number }>;
  explanation: string;
  recommendedAction: string;
  modelVersion: string;
  /** True when the model was trained on synthetic data. Always surfaced. */
  trainedOnSyntheticData: boolean;
}

/** Written by ml/evaluation/evaluate.py. Only real computed numbers land here. */
export interface ModelMetrics {
  modelVersion: string;
  trainedAt: string;
  algorithm: string;
  trainedOnSyntheticData: boolean;
  datasetSize: number;
  trainSize: number;
  validationSize: number;
  testSize: number;
  /** null when the evaluation pipeline has not been run. */
  accuracy: number | null;
  macroPrecision: number | null;
  macroRecall: number | null;
  macroF1: number | null;
  perClass: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  confusionMatrix: number[][];
  labels: string[];
  featureImportances: Array<{ feature: string; importance: number }>;
  /** Set when data was insufficient; UI shows this verbatim instead of metrics. */
  insufficientDataNote?: string;
}

// ---------------------------------------------------------------------------
// System health / edge
// ---------------------------------------------------------------------------

export type ComponentStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'SIMULATED' | 'UNKNOWN';

export type HealthComponentId =
  | 'raspberry_pi'
  | 'mqtt'
  | 'api'
  | 'mongodb'
  | 'simulator'
  | 'ml_engine'
  | 'realtime';

export interface HealthComponent {
  id: HealthComponentId;
  name: string;
  status: ComponentStatus;
  detail: string;
  latencyMs?: number;
  lastCheck: string;
}

export interface SystemHealth {
  timestamp: string;
  components: HealthComponent[];
  /** Edge processing is alive but the cloud link is not. */
  edgeMode: boolean;
  /** Distinguishes an internet outage from an edge-system failure. */
  internetReachable: boolean;
  edgeOperational: boolean;
  network: {
    packetLossPercent: number;
    averageLatencyMs: number;
    duplicatePackets: number;
    staleNodes: string[];
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type Role = 'ADMIN' | 'OPERATOR' | 'TECHNICIAN' | 'VIEWER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** 'password' | 'google' */
  provider: 'password' | 'google';
  avatarUrl?: string;
  createdAt: string;
  mustChangePassword?: boolean;
}

export interface AuthSession {
  token: string;
  user: User;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Simulation control
// ---------------------------------------------------------------------------

export interface SimulationState {
  running: boolean;
  scenario: ScenarioId;
  mode: AppMode;
  intervalMs: number;
  /** Wall-clock acceleration of the simulated day. */
  speed: number;
  nodeCount: number;
  startedAt: string | null;
  framesGenerated: number;
  lastFrameAt: string | null;
  /** Echo of the most recent packet, for the Demo Control page. */
  lastFrame: TelemetryFrame | null;
  activeFaults: string[];
  /** Simulated clock, which may run ahead of wall clock when speed > 1. */
  simulatedTime: string;
}

// ---------------------------------------------------------------------------
// Usage / billing
// ---------------------------------------------------------------------------

export interface BillingAssumptions {
  /** Grid tariff, currency per kWh. */
  tariffPerKwh: number;
  fixedCharge: number;
  /** Additional levies as a fraction, e.g. 0.05 = 5%. */
  additionalChargeRate: number;
  dieselPricePerLitre: number;
  /** kWh produced per litre of diesel. */
  generatorKwhPerLitre: number;
  /** kg CO2 per kWh of displaced grid energy. */
  gridEmissionFactor: number;
  currency: string;
}

export interface UsageRecord {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  energyGeneratedKwh: number;
  energyConsumedKwh: number;
  gridImportKwh: number;
  peakDemandW: number;
  averageDailyKwh: number;
  estimatedCost: number;
  estimatedSavings: number;
  estimatedCo2AvoidedKg: number;
  assumptions: BillingAssumptions;
  /** Always recorded so a report can never be mistaken for measured data. */
  dataSource: AppMode;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type TimeRange = '1H' | '6H' | '24H' | '7D' | '30D';

export interface AnalyticsBucket {
  timestamp: string;
  generationW: number;
  consumptionW: number;
  acLoadW: number;
  dcLoadW: number;
  batterySoc: number | null;
  netPowerW: number;
  efficiency: number | null;
}

export interface AnalyticsResponse {
  range: TimeRange;
  bucketMs: number;
  buckets: AnalyticsBucket[];
  totals: {
    generatedKwh: number;
    consumedKwh: number;
    lossesKwh: number;
    peakDemandW: number;
    averageEfficiency: number | null;
  };
  alertFrequency: Array<{ timestamp: string; info: number; warning: number; critical: number }>;
  anomalyFrequency: Array<{ timestamp: string; count: number }>;
  nodePerformance: Array<{ nodeId: string; name: string; energyKwh: number; availability: number }>;
  dataSource: AppMode;
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
