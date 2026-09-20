/**
 * API client.
 *
 * One axios instance, one place that attaches the token, one place that handles
 * a 401. Components never call axios directly.
 */

import axios, { type AxiosError, type AxiosInstance } from 'axios';

import type {
  Alert,
  AnalyticsResponse,
  BillingAssumptions,
  EnrichedFrame,
  ModelMetrics,
  NodeConfig,
  Prediction,
  ScenarioDefinition,
  ScenarioId,
  SimulationState,
  SystemHealth,
  SystemSnapshot,
  TimeRange,
  UsageRecord,
  User,
} from '@shared/types';
import type { BillResult } from '@shared/billing';

const TOKEN_KEY = 'gridsync.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing — the session simply will not persist across reloads */
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Notified on 401 so the app can route to the login page exactly once. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string; code?: string; details?: unknown }>) => {
    if (error.response?.status === 401) {
      setToken(null);
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** Turn an axios failure into a message safe and useful to show a user. */
export function errorMessage(err: unknown): string {
  const e = err as AxiosError<{ error?: string; code?: string }>;
  if (e?.response?.data?.error) return e.response.data.error;
  if (e?.code === 'ECONNABORTED') return 'The request timed out. The server may be busy.';
  if (e?.message === 'Network Error') {
    return 'Cannot reach the GridSync API. Check that the server is running.';
  }
  return e?.message || 'Something went wrong.';
}

export function errorCode(err: unknown): string | null {
  const e = err as AxiosError<{ code?: string }>;
  return e?.response?.data?.code ?? null;
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: User;
  permissions: string[];
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data),

  signup: (name: string, email: string, password: string) =>
    api.post<AuthResponse>('/auth/signup', { name, email, password }).then((r) => r.data),

  google: (payload: { credential?: string; code?: string }) =>
    api.post<AuthResponse>('/auth/google', payload).then((r) => r.data),

  me: () =>
    api
      .get<{ user: User; permissions: string[]; googleEnabled: boolean }>('/auth/me')
      .then((r) => r.data),
};

export interface LatestResponse {
  snapshot: SystemSnapshot;
  frames: EnrichedFrame[];
  mode: 'SIMULATION' | 'REALTIME';
  scenario: ScenarioId;
  serverTime: string;
}

export const telemetryApi = {
  nodes: () => api.get<{ nodes: NodeConfig[]; total: number }>('/nodes').then((r) => r.data),

  latest: () => api.get<LatestResponse>('/telemetry/latest').then((r) => r.data),

  history: (nodeId: string, range: TimeRange, maxPoints = 300) =>
    api
      .get<{
        nodeId: string;
        node: NodeConfig;
        range: TimeRange;
        from: string;
        to: string;
        points: number;
        series: Array<{
          timestamp: string;
          voltage: number;
          current: number;
          power: number;
          temperature?: number;
          lux?: number;
          soc?: number;
          valid: boolean;
        }>;
      }>('/telemetry/history', { params: { nodeId, range, maxPoints } })
      .then((r) => r.data),
};

export interface AlertsResponse {
  items: Alert[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: { info: number; warning: number; critical: number; total: number };
}

export const alertsApi = {
  list: (params: Record<string, string | number | undefined>) =>
    api.get<AlertsResponse>('/alerts', { params }).then((r) => r.data),

  acknowledge: (id: string) =>
    api.post<{ alert: Alert }>(`/alerts/${encodeURIComponent(id)}/acknowledge`).then((r) => r.data),

  resolve: (id: string) =>
    api.post<{ alert: Alert }>(`/alerts/${encodeURIComponent(id)}/resolve`).then((r) => r.data),
};

export interface PredictionsResponse {
  latest: Prediction[];
  recent: Prediction[];
  model: {
    available: boolean;
    version: string | null;
    algorithm: string;
    trainedOnSyntheticData: boolean | null;
    error: string | null;
    classes: string[];
    featureImportances: Array<{ feature: string; importance: number }>;
  };
  metrics:
    | { available: false; note: string }
    | (Partial<ModelMetrics> & {
        available: true;
        insufficientDataNote: string | null;
        notes: string[];
        splitStrategy: string | null;
      });
}

export const intelligenceApi = {
  predictions: (limit = 50) =>
    api.get<PredictionsResponse>('/predictions', { params: { limit } }).then((r) => r.data),

  analytics: (range: TimeRange) =>
    api.get<AnalyticsResponse>('/analytics', { params: { range } }).then((r) => r.data),

  systemHealth: () =>
    api
      .get<SystemHealth & { mode: string; scenario: string; nodesConfigured: number; nodesReporting: number }>(
        '/system-health',
      )
      .then((r) => r.data),
};

export interface SimulationStateResponse {
  state: SimulationState;
  workerResponsive: boolean;
  lastFrameAgeMs: number | null;
  controlPlaneAvailable: boolean;
  scenarios: ScenarioDefinition[];
  limits: {
    minNodes: number;
    maxNodes: number;
    minIntervalMs: number;
    maxIntervalMs: number;
    minSpeed: number;
    maxSpeed: number;
  };
}

export const simulationApi = {
  state: () => api.get<SimulationStateResponse>('/simulation/state').then((r) => r.data),

  control: (payload: {
    action: 'START' | 'STOP' | 'RESTART' | 'SET_SCENARIO' | 'SET_INTERVAL' | 'SET_SPEED' | 'SET_NODE_COUNT';
    scenario?: ScenarioId;
    intervalMs?: number;
    speed?: number;
    nodeCount?: number;
  }) => api.post<{ queued: boolean; note: string }>('/simulation/control', payload).then((r) => r.data),
};

export const usageApi = {
  list: () => api.get<{ items: UsageRecord[]; total: number }>('/usage').then((r) => r.data),

  generate: (payload: {
    periodStart: string;
    periodEnd: string;
    gridImportKwh?: number;
    assumptions?: Partial<BillingAssumptions>;
    save?: boolean;
  }) =>
    api
      .post<{ record: UsageRecord; bill: BillResult; dataPoints: number; dataSource: string }>(
        '/usage',
        payload,
      )
      .then((r) => r.data),
};

export const usersApi = {
  list: () => api.get<{ users: User[]; total: number }>('/users').then((r) => r.data),

  setRole: (userId: string, role: User['role']) =>
    api.patch<{ userId: string; role: string }>('/users', { userId, role }).then((r) => r.data),
};
