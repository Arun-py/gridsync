/**
 * Environment access — the ONLY place process.env is read.
 *
 * Secrets never appear in source. Every value here comes from `.env` locally or
 * from deployment secrets in production, and `.env.example` documents the
 * contract with placeholders only.
 *
 * Required values are validated once at startup so a misconfiguration fails
 * immediately and loudly, rather than surfacing as a confusing runtime error
 * three layers deep.
 */

import { config as loadDotenv } from 'dotenv';

// In serverless the platform injects env vars directly; locally we read .env.
// `override: false` means real environment variables always win.
if (!process.env.VERCEL) {
  loadDotenv({ override: false });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example for the contract.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(name: string): string[] {
  return optional(name)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const env = {
  get mongoUri(): string {
    return required('MONGODB_URI');
  },
  get dbName(): string {
    return optional('MONGODB_DB_NAME', 'gridsync');
  },
  get authSecret(): string {
    const secret = required('AUTH_SECRET');
    if (secret.length < 32) {
      throw new Error('AUTH_SECRET must be at least 32 characters. Generate a new one.');
    }
    return secret;
  },
  get tokenTtl(): string {
    return optional('AUTH_TOKEN_TTL', '12h');
  },

  // --- Google OAuth (optional) ---
  get googleClientId(): string {
    return optional('GOOGLE_CLIENT_ID');
  },
  get googleClientSecret(): string {
    return optional('GOOGLE_CLIENT_SECRET');
  },
  get googleRedirectUri(): string {
    return optional('GOOGLE_REDIRECT_URI', 'http://localhost:3000/auth/google/callback');
  },
  get googleEnabled(): boolean {
    return Boolean(optional('GOOGLE_CLIENT_ID') && optional('GOOGLE_CLIENT_SECRET'));
  },

  // --- Role allowlists ---
  get adminEmails(): string[] {
    return list('ADMIN_EMAILS');
  },
  get operatorEmails(): string[] {
    return list('OPERATOR_EMAILS');
  },
  get technicianEmails(): string[] {
    return list('TECHNICIAN_EMAILS');
  },

  // --- Worker / simulation ---
  get source(): string {
    return optional('GRIDSYNC_SOURCE', 'simulation');
  },
  get simulationIntervalMs(): number {
    return num('SIMULATION_INTERVAL_MS', 1000);
  },
  get simulationSpeed(): number {
    return num('SIMULATION_SPEED', 60);
  },
  get simulationScenario(): string {
    return optional('SIMULATION_SCENARIO', 'NORMAL');
  },
  get simulationNodeCount(): number {
    return num('SIMULATION_NODE_COUNT', 4);
  },
  get ingestToken(): string {
    return optional('INGEST_TOKEN');
  },
  get workerPort(): number {
    return num('WORKER_PORT', 5000);
  },

  // --- MQTT (future hardware path) ---
  get mqttUrl(): string {
    return optional('MQTT_URL', 'mqtt://localhost:1883');
  },
  get mqttUsername(): string {
    return optional('MQTT_USERNAME');
  },
  get mqttPassword(): string {
    return optional('MQTT_PASSWORD');
  },
  get mqttTopicPrefix(): string {
    return optional('MQTT_TOPIC_PREFIX', 'gridsync');
  },

  // --- Retention ---
  get telemetryRetentionDays(): number {
    return num('TELEMETRY_RETENTION_DAYS', 14);
  },

  // --- Seed users ---
  seedUser(role: 'ADMIN' | 'OPERATOR' | 'TECHNICIAN' | 'VIEWER'): { email: string; password: string } | null {
    const email = optional(`SEED_${role}_EMAIL`);
    const password = optional(`SEED_${role}_PASSWORD`);
    if (!email || !password) return null;
    return { email, password };
  },

  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  },
};

/**
 * Validate everything the process cannot run without.
 * Called at worker startup; API routes fail per-request instead so one bad
 * variable does not take down unrelated endpoints.
 */
export function assertRequiredEnv(): void {
  void env.mongoUri;
  void env.authSecret;
}
