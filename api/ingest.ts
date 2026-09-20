/**
 * POST /api/ingest — telemetry entry point for remote producers.
 *
 * THIS IS THE REST HALF OF THE HARDWARE PATH.
 *
 * A remote worker, a Raspberry Pi, or an ESP32 that can reach HTTPS but not the
 * MQTT broker can POST frames here and they enter the exact same pipeline as
 * simulated ones: validate -> de-duplicate -> store.
 *
 * AUTHENTICATION
 * A device cannot hold a user session, so this route uses a shared bearer token
 * (INGEST_TOKEN) compared in constant time. If INGEST_TOKEN is not configured
 * the route is DISABLED rather than left open — failing closed.
 */

import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { ApiError, handler } from './_lib/handler';
import { getNodeConfig } from '../shared/nodes.config';
import { normaliseFrame } from '../shared/validation';
import type { TelemetryFrame, TelemetrySource } from '../shared/types';
import { env } from '../server/env';
import { telemetryRepo } from '../server/repositories';
import { logger } from '../server/logger';

const log = logger('ingest');

const frameSchema = z.object({
  nodeId: z.string().min(1).max(64),
  nodeType: z.enum(['SOLAR', 'BATTERY', 'AC_LOAD', 'DC_LOAD']).optional(),
  timestamp: z.string().optional(),
  voltage: z.number(),
  current: z.number(),
  power: z.number().optional(),
  temperature: z.number().optional(),
  lux: z.number().optional(),
  soc: z.number().optional(),
  sequenceNumber: z.number().int().min(0).optional(),
  firmwareVersion: z.string().max(40).optional(),
  rssi: z.number().optional(),
  uptime: z.number().optional(),
  source: z.enum(['SIMULATION', 'ESP32', 'RASPBERRY_PI', 'MQTT', 'REST']).optional(),
});

const schema = z.object({
  // Batching matters: a Pi forwarding 4 nodes at 1 Hz should make one request
  // per second, not four.
  frames: z.array(frameSchema).min(1).max(500),
});

/** Constant-time comparison so token validation cannot be timed. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default handler({ methods: ['POST'], schema, rateLimit: 300 }, async ({ req, body }) => {
  const expected = env.ingestToken;
  if (!expected) {
    // Fail closed. An unauthenticated write endpoint would let anyone inject
    // telemetry and poison both the charts and the training data.
    throw new ApiError(
      503,
      'INGEST_DISABLED',
      'Telemetry ingest is disabled because INGEST_TOKEN is not configured.',
    );
  }

  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!provided || !tokenMatches(provided, expected)) {
    log.warn('Rejected ingest with bad token');
    throw new ApiError(401, 'BAD_INGEST_TOKEN', 'Invalid ingest token.');
  }

  const accepted: TelemetryFrame[] = [];
  const rejected: Array<{ nodeId: string; reason: string }> = [];

  for (const raw of body.frames) {
    const node = getNodeConfig(raw.nodeId);
    if (!node) {
      rejected.push({ nodeId: raw.nodeId, reason: 'Unknown node id' });
      continue;
    }

    // Normalise + validate. An invalid frame is STILL STORED, flagged invalid,
    // so a sensor fault is visible rather than silently dropped — but it is
    // excluded from analytics and ML downstream.
    const frame = normaliseFrame(
      { ...raw, source: (raw.source as TelemetrySource) ?? 'REST', mode: 'REALTIME' },
      node,
      'REST',
    );
    accepted.push(frame);
  }

  let inserted = 0;
  try {
    inserted = await telemetryRepo.insertMany(accepted);
  } catch (err) {
    log.error('Ingest persistence failed', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Could not store telemetry right now.');
  }

  const invalid = accepted.filter((f) => !f.valid);
  if (invalid.length > 0) {
    log.warn('Ingested frames failed validation', {
      count: invalid.length,
      nodes: [...new Set(invalid.map((f) => f.nodeId))],
    });
  }

  return {
    received: body.frames.length,
    // `inserted` can be lower than `accepted` when the unique index rejects a
    // duplicate — that is idempotency working, not an error.
    inserted,
    duplicates: accepted.length - inserted,
    invalid: invalid.length,
    rejected,
  };
});
