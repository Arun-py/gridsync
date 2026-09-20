/**
 * GET /api/alerts — the Alert Center feed.
 *
 * Supports filtering by status, severity, node, free-text search and date
 * range, all applied in MongoDB against the `alert_triage` index.
 */

import { handler, intParam } from '../_lib/handler';
import type { AlertStatus, Severity } from '../../shared/types';
import { alertRepo } from '../../server/repositories';

const STATUSES: Array<AlertStatus | 'all'> = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'all'];
const SEVERITIES: Severity[] = ['INFO', 'WARNING', 'CRITICAL'];

export default handler({ methods: ['GET'], auth: true }, async ({ query }) => {
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
