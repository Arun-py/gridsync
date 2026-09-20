/**
 * Alert Center.
 *
 * Every alert carries its id, node, timestamp, severity, actual vs expected
 * value, detected condition, likely cause, recommended action and source
 * (RULE / ML / SYSTEM / COMMUNICATION) — spec §19.
 *
 * Acknowledge and resolve buttons render only for roles that hold the
 * permission, and the server independently rejects the call from any role that
 * does not. Hiding the button is convenience; the 403 is the control.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BrainCircuit,
  Check,
  CircleSlash,
  Filter,
  RadioTower,
  Search,
  Settings2,
  X,
} from 'lucide-react';

import type { Alert, AlertSource, AlertStatus, Severity } from '@shared/types';
import {
  EmptyState,
  ErrorState,
  KindBadge,
  LoadingState,
  Panel,
  SeverityBadge,
  fmt,
  fmtDateTime,
} from '../components/ui';
import { alertsApi, errorCode, errorMessage } from '../lib/api';
import { useAppSelector, usePermission } from '../store';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

const SOURCE_ICON: Record<AlertSource, typeof Bell> = {
  RULE: Settings2,
  ML: BrainCircuit,
  SYSTEM: CircleSlash,
  COMMUNICATION: RadioTower,
};

export default function Alerts() {
  const { nodes } = useTelemetry();
  const canAcknowledge = usePermission('alerts:acknowledge');
  const canResolve = usePermission('alerts:resolve');
  const role = useAppSelector((s) => s.auth.user?.role);

  const [items, setItems] = useState<Alert[]>([]);
  const [counts, setCounts] = useState({ info: 0, warning: 0, critical: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // --- filters ---
  const [status, setStatus] = useState<AlertStatus | 'all'>('ACTIVE');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [nodeId, setNodeId] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [since, setSince] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const pageSize = 25;

  // Debounce so typing does not fire a request per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);

    alertsApi
      .list({
        status,
        severity: severity || undefined,
        nodeId: nodeId || undefined,
        search: debouncedSearch || undefined,
        since: since ? new Date(since).toISOString() : undefined,
        page,
        pageSize,
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setCounts(data.counts);
        setTotal(data.total);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status, severity, nodeId, debouncedSearch, since, page]);

  useEffect(() => load(), [load]);

  // Refresh periodically so new alerts appear without a manual reload.
  useEffect(() => {
    const id = window.setInterval(() => load(), 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  const act = async (alert: Alert, action: 'acknowledge' | 'resolve') => {
    setBusyId(alert.id);
    setActionError(null);
    try {
      const result =
        action === 'acknowledge'
          ? await alertsApi.acknowledge(alert.id)
          : await alertsApi.resolve(alert.id);
      setItems((prev) => prev.map((a) => (a.id === alert.id ? result.alert : a)));
    } catch (err) {
      // A 403 here is the server enforcing the permission — surface it plainly.
      setActionError(
        errorCode(err) === 'FORBIDDEN'
          ? `Your role (${role}) is not permitted to ${action} alerts.`
          : errorMessage(err),
      );
    } finally {
      setBusyId(null);
    }
  };

  const clearFilters = () => {
    setStatus('ACTIVE');
    setSeverity('');
    setNodeId('');
    setSearch('');
    setSince('');
    setPage(1);
  };

  const filtersActive = severity || nodeId || search || since || status !== 'ACTIVE';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Alert Center</h1>
          <p className="mt-1 text-xs text-slate-500">
            {counts.total} active · {counts.critical} critical, {counts.warning} warning,{' '}
            {counts.info} info
          </p>
        </div>
      </div>

      {/* ---- filters ---- */}
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="f-status" className="label">Status</label>
            <select
              id="f-status"
              className="select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as AlertStatus | 'all');
                setPage(1);
              }}
            >
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>

          <div>
            <label htmlFor="f-sev" className="label">Severity</label>
            <select
              id="f-sev"
              className="select"
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value as Severity | '');
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </div>

          <div>
            <label htmlFor="f-node" className="label">Node</label>
            <select
              id="f-node"
              className="select"
              value={nodeId}
              onChange={(e) => {
                setNodeId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All nodes</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.shortName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="f-since" className="label">Since</label>
            <input
              id="f-since"
              type="date"
              className="input"
              value={since}
              onChange={(e) => {
                setSince(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div>
            <label htmlFor="f-search" className="label">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" />
              <input
                id="f-search"
                className="input pl-8"
                placeholder="Message or cause"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {filtersActive && (
          <button onClick={clearFilters} className="btn btn-ghost btn-sm mt-3">
            <Filter className="h-3 w-3" />
            Clear filters
          </button>
        )}
      </Panel>

      {actionError && (
        <ErrorState title="Action failed" message={actionError} variant="warning" />
      )}

      {/* ---- list ---- */}
      {loading && items.length === 0 ? (
        <Panel><LoadingState /></Panel>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Bell className="h-6 w-6" />}
            title="No alerts"
            description="No alerts match the current filters."
          />
        </Panel>
      ) : (
        <div className="space-y-2">
          {items.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              busy={busyId === alert.id}
              canAcknowledge={canAcknowledge}
              canResolve={canResolve}
              onAct={act}
            />
          ))}
        </div>
      )}

      {/* ---- pagination ---- */}
      {total > pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Page {page} of {Math.ceil(total / pageSize)} · {total} alerts
          </p>
          <div className="flex gap-2">
            <button
              className="btn btn-secondary btn-sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page >= Math.ceil(total / pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {!canAcknowledge && (
        <p className="rounded border border-panel-700 bg-panel-850 p-3 text-2xs leading-relaxed text-slate-500">
          Your role ({role}) provides read-only access to alerts. Acknowledging and resolving
          require the Operator, Technician or Administrator role.
        </p>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  busy,
  canAcknowledge,
  canResolve,
  onAct,
}: {
  alert: Alert;
  busy: boolean;
  canAcknowledge: boolean;
  canResolve: boolean;
  onAct: (alert: Alert, action: 'acknowledge' | 'resolve') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const SourceIcon = SOURCE_ICON[alert.source];

  const border =
    alert.severity === 'CRITICAL'
      ? 'border-l-red-500'
      : alert.severity === 'WARNING'
        ? 'border-l-amber-500'
        : 'border-l-sky-500';

  const dimmed = alert.status === 'RESOLVED';

  return (
    <article
      className={`panel border-l-2 ${border} ${dimmed ? 'opacity-60' : ''}`}
    >
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={alert.severity} />
              <KindBadge kind={alert.kind} />
              <span className="badge badge-neutral">
                <SourceIcon className="h-3 w-3" />
                {alert.source}
              </span>
              {alert.status !== 'ACTIVE' && (
                <span className="badge badge-ok">{alert.status}</span>
              )}
            </div>

            <h3 className="mt-2.5 text-sm font-semibold text-slate-100">{alert.condition}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{alert.message}</p>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-slate-600">
              <span className="font-mono">{alert.id}</span>
              <span>·</span>
              <span>{alert.nodeId ?? 'system'}</span>
              <span>·</span>
              <span>{fmtDateTime(alert.timestamp)}</span>
              {alert.ruleId && (
                <>
                  <span>·</span>
                  <span className="font-mono">{alert.ruleId}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Actual vs expected, when the rule provided both. */}
            {alert.actualValue !== undefined && (
              <div className="rounded border border-panel-700 bg-panel-850 px-2.5 py-1.5 text-right">
                <p className="tabular text-sm font-semibold text-slate-100">
                  {fmt(alert.actualValue, 1)}
                  {alert.unit ? ` ${alert.unit}` : ''}
                </p>
                {alert.expectedValue !== undefined && (
                  <p className="tabular text-2xs text-slate-500">
                    expected {fmt(alert.expectedValue, 1)}
                    {alert.unit ? ` ${alert.unit}` : ''}
                  </p>
                )}
              </div>
            )}

            {alert.status === 'ACTIVE' && canAcknowledge && (
              <button
                onClick={() => onAct(alert, 'acknowledge')}
                disabled={busy}
                className="btn btn-secondary btn-sm"
              >
                <Check className="h-3 w-3" />
                Acknowledge
              </button>
            )}
            {alert.status !== 'RESOLVED' && canResolve && (
              <button
                onClick={() => onAct(alert, 'resolve')}
                disabled={busy}
                className="btn btn-secondary btn-sm"
              >
                <X className="h-3 w-3" />
                Resolve
              </button>
            )}
          </div>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-2xs font-medium text-primary-400 hover:text-primary-300"
          aria-expanded={expanded}
        >
          {expanded ? 'Hide details' : 'Show cause and recommended action'}
        </button>

        {expanded && (
          <div className="mt-3 grid gap-3 border-t border-panel-800 pt-3 sm:grid-cols-2">
            <div>
              <p className="metric-label">Likely cause</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{alert.likelyCause}</p>
            </div>
            <div>
              <p className="metric-label">Recommended action</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                {alert.recommendedAction}
              </p>
            </div>

            {alert.source === 'ML' && (
              <div className="sm:col-span-2 rounded border border-violet-500/30 bg-violet-500/5 p-2.5">
                <p className="text-2xs leading-relaxed text-violet-200/80">
                  This is a model PREDICTION, not a measured detection. Model{' '}
                  {alert.modelVersion ?? 'unknown'} at{' '}
                  {alert.confidence ? `${(alert.confidence * 100).toFixed(0)}%` : 'unknown'}{' '}
                  confidence. Confirm by inspection before acting.
                </p>
              </div>
            )}

            {(alert.acknowledgedBy || alert.resolvedBy) && (
              <div className="sm:col-span-2 text-2xs text-slate-600">
                {alert.acknowledgedBy && (
                  <span>
                    Acknowledged by {alert.acknowledgedBy} at {fmtDateTime(alert.acknowledgedAt)}.{' '}
                  </span>
                )}
                {alert.resolvedBy && (
                  <span>
                    Resolved by {alert.resolvedBy} at {fmtDateTime(alert.resolvedAt)}.
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
