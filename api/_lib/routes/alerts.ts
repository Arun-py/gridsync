/**
 * Alert route implementations, dispatched by api/alerts/[...path].ts.
 *
 * Consolidated into one file (from three separate route files) to stay under
 * Vercel's per-deployment serverless function cap — see api/alerts/[...path].ts.
 */

import { ApiError, handler, intParam } from '../handler.js';
import type { AlertStatus, Severity } from '../../../shared/types.js';
import { alertRepo, eventRepo } from '../../../server/repositories.js';
import { logger } from '../../../server/logger.js';

// ---------------------------------------------------------------------------
// GET /api/alerts — the Alert Center feed.
//
// Supports filtering by status, severity, node, free-text search and date
// range, all applied in MongoDB against the `alert_triage` index.
// ---------------------------------------------------------------------------

const STATUSES: Array<AlertStatus | 'all'> = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'all'];
const SEVERITIES: Severity[] = ['INFO', 'WARNING', 'CRITICAL'];

export const listHandler = handler({ methods: ['GET'], auth: true }, async ({ query }) => {
  const status = STATUSES.includes(query.status as AlertStatus)
    ? (query.status as AlertStatus | 'all')
    : 'all';
  const severity = SEVERITIES.includes(query.severity as Severity)
    ? (query.severity as Severity)
    : undefined;

  const page = intParam(query.page, 1, 1, 1000);
  const pageSize = intParam(query.pageSize, 50, 1, 200);

  const since = query.since ? safeDate(query.since) : undefined;
  const until = query.until ? safeDate(query.until) : undefined;

  const { items, total } = await alertRepo.list({
    status,
    severity,
    nodeId: query.nodeId || undefined,
    search: query.search || undefined,
    since,
    until,
    page,
    pageSize,
  });

  const counts = await alertRepo.counts();

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    counts,
  };
});

function safeDate(value: string): Date | undefined {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ---------------------------------------------------------------------------
// POST /api/alerts/:id/acknowledge
//
// Requires the `alerts:acknowledge` permission. A VIEWER calling this directly
// — bypassing the UI, which hides the button — receives 403. Hiding a control
// is presentation; this is the actual control (spec §55).
// ---------------------------------------------------------------------------

const acknowledgeLog = logger('alerts:acknowledge');

export const acknowledgeHandler = handler(
  { methods: ['POST'], permission: 'alerts:acknowledge' },
  async ({ req, user }) => {
    const id = String(req.query.id ?? '').trim();
    if (!id) throw new ApiError(400, 'MISSING_ID', 'An alert id is required.');

    const alert = await alertRepo.setStatus(id, 'ACKNOWLEDGED', user!.email);
    if (!alert) throw new ApiError(404, 'ALERT_NOT_FOUND', 'No alert with that id.');

    await eventRepo.record('alert_acknowledged', `Alert ${id} acknowledged`, {
      alertId: id,
      userId: user!.sub,
      role: user!.role,
    });
    acknowledgeLog.info('Alert acknowledged', { alertId: id, userId: user!.sub });

    return { alert };
  },
);

// ---------------------------------------------------------------------------
// POST /api/alerts/:id/resolve
//
// Requires `alerts:resolve`. Note this is a NARROWER permission than
// acknowledge: a TECHNICIAN may acknowledge an alert they are investigating but
// only an OPERATOR or ADMIN may declare it resolved.
// ---------------------------------------------------------------------------

const resolveLog = logger('alerts:resolve');

export const resolveHandler = handler(
  { methods: ['POST'], permission: 'alerts:resolve' },
  async ({ req, user }) => {
    const id = String(req.query.id ?? '').trim();
    if (!id) throw new ApiError(400, 'MISSING_ID', 'An alert id is required.');

    const alert = await alertRepo.setStatus(id, 'RESOLVED', user!.email);
    if (!alert) throw new ApiError(404, 'ALERT_NOT_FOUND', 'No alert with that id.');

    await eventRepo.record('alert_resolved', `Alert ${id} resolved`, {
      alertId: id,
      userId: user!.sub,
      role: user!.role,
    });
    resolveLog.info('Alert resolved', { alertId: id, userId: user!.sub });

    return { alert };
  },
);
