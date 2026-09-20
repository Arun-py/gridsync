/**
 * API request plumbing.
 *
 * Every route is wrapped by `handler()`, which provides, in order:
 *   1. CORS + security headers
 *   2. method allowlisting
 *   3. rate limiting
 *   4. authentication (when required)
 *   5. authorisation (when a permission is required)
 *   6. body parsing + zod validation
 *   7. error containment
 *
 * ERROR DISCIPLINE
 * Clients receive a stable `code` and a safe message. Stack traces, driver
 * errors and connection strings are logged server-side and never returned —
 * the v1 Flask API returned `str(e)` to the client, which leaked internals.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ZodSchema } from 'zod';

import type { Role } from '../../shared/types';
import { can, verifyToken, type Permission, type TokenClaims } from '../../server/auth';
import { errorFields, logger } from '../../server/logger';

const log = logger('api');

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HandlerContext<TBody = unknown> {
  req: VercelRequest;
  res: VercelResponse;
  /** Present whenever `auth: true`. */
  user: TokenClaims | null;
  body: TBody;
  query: Record<string, string>;
}

export interface HandlerOptions<TBody> {
  methods: Method[];
  /** Require a valid token. */
  auth?: boolean;
  /** Require a permission. Implies `auth`. */
  permission?: Permission;
  /** Validate and coerce the request body. */
  schema?: ZodSchema<TBody>;
  /** Requests per minute per client. Defaults to 120. */
  rateLimit?: number;
}

/** Thrown by routes to produce a controlled error response. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * In-memory fixed-window limiter.
 *
 * HONEST LIMITATION: serverless instances do not share memory, so this limits
 * per warm instance rather than globally. It is real protection against a
 * single client hammering one instance (and against accidental render loops),
 * but it is not a substitute for a shared store. For strict global limits,
 * front this with Upstash Redis or Vercel's own rate limiting.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic cleanup so the map cannot grow without bound.
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

function clientKey(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : (forwarded ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  return `${ip}:${req.url?.split('?')[0] ?? ''}`;
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

export function handler<TBody = unknown>(
  options: HandlerOptions<TBody>,
  fn: (ctx: HandlerContext<TBody>) => Promise<unknown>,
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    // --- headers ---
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', [...options.methods, 'OPTIONS'].join(', '));

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    try {
      // --- method ---
      if (!options.methods.includes(req.method as Method)) {
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on this route.`);
      }

      // --- rate limit ---
      const limit = options.rateLimit ?? 120;
      const rl = rateLimit(clientKey(req), limit);
      if (!rl.ok) {
        res.setHeader('Retry-After', String(rl.retryAfter));
        throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.');
      }

      // --- auth ---
      let user: TokenClaims | null = null;
      const needsAuth = options.auth || options.permission;

      if (needsAuth) {
        const header = req.headers.authorization ?? '';
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        if (!token) {
          throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
        }
        user = await verifyToken(token);
        if (!user) {
          throw new ApiError(401, 'INVALID_TOKEN', 'Session expired or invalid. Please sign in again.');
        }

        // --- authorisation, enforced server-side ---
        if (options.permission && !can(user.role as Role, options.permission)) {
          log.warn('Authorisation denied', {
            role: user.role,
            permission: options.permission,
            path: req.url?.split('?')[0],
          });
          throw new ApiError(
            403,
            'FORBIDDEN',
            `Your role (${user.role}) is not permitted to perform this action.`,
          );
        }
      }

      // --- body ---
      let body = (req.body ?? {}) as TBody;
      if (options.schema) {
        const parsed = options.schema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new ApiError(400, 'VALIDATION_FAILED', 'Request body is invalid.', {
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          });
        }
        body = parsed.data;
      }

      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query ?? {})) {
        query[k] = Array.isArray(v) ? (v[0] ?? '') : String(v ?? '');
      }

      const result = await fn({ req, res, user, body, query });

      // A route may write the response itself (streams, redirects).
      if (!res.writableEnded) {
        res.status(200).json(result ?? { ok: true });
      }
    } catch (err) {
      handleError(req, res, err);
    }
  };
}

function handleError(req: VercelRequest, res: VercelResponse, err: unknown): void {
  const path = req.url?.split('?')[0] ?? '';

  if (err instanceof ApiError) {
    // Expected failures: log at info/warn, return the detail.
    if (err.status >= 500) log.error('Request failed', { path, code: err.code, ...errorFields(err) });
    else log.debug('Request rejected', { path, code: err.code, status: err.status });

    res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }

  // Unexpected: log fully, return nothing specific.
  log.error('Unhandled route error', { path, ...errorFields(err) });

  const message = isDbError(err)
    ? 'The database is currently unreachable. Live data may be unavailable.'
    : 'An unexpected error occurred.';
  const code = isDbError(err) ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR';

  res.status(isDbError(err) ? 503 : 500).json({ error: message, code });
}

function isDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name.startsWith('Mongo') ||
    err.message.includes('ECONNREFUSED') ||
    err.message.includes('ETIMEDOUT')
  );
}

/** Parse a bounded integer query parameter. */
export function intParam(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
