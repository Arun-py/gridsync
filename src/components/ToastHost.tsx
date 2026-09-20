/**
 * Critical-alert notifications.
 *
 * CRITICAL alerts produce an immediate on-screen notification wherever the user
 * is in the app (spec §19). Lower severities do not interrupt — they appear in
 * the Alert Center and in the header count.
 *
 * Each alert notifies at most once, tracked by alert id, so a persistent
 * condition does not re-pop every poll.
 */

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, X } from 'lucide-react';

import { alertsApi } from '../lib/api';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';
import { useAppDispatch, useAppSelector } from '../store';
import { dismissToast, pushToast } from '../store/uiSlice';
import { fmtTime } from './ui';

/** How often to check for new critical alerts. */
const POLL_MS = 5000;
/** Auto-dismiss after this long; the alert remains in the Alert Center. */
const AUTO_DISMISS_MS = 12_000;

export default function ToastHost() {
  const dispatch = useAppDispatch();
  const toasts = useAppSelector((s) => s.ui.toasts);
  const notified = useAppSelector((s) => s.ui.notifiedAlertIds);
  const { snapshot } = useTelemetry();

  // Keep the latest notified list in a ref so the polling effect does not need
  // it as a dependency (which would restart the interval on every new alert).
  const notifiedRef = useRef(notified);
  notifiedRef.current = notified;

  const criticalCount = snapshot?.activeAlerts.critical ?? 0;
  const criticalCountRef = useRef(criticalCount);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const data = await alertsApi.list({ status: 'ACTIVE', severity: 'CRITICAL', pageSize: 5 });
        if (cancelled) return;

        for (const alert of data.items) {
          if (notifiedRef.current.includes(alert.id)) continue;
          dispatch(
            pushToast({
              severity: 'CRITICAL',
              title: alert.condition,
              message: alert.message,
              alertId: alert.id,
            }),
          );
        }
      } catch {
        // Notifications are best-effort; a failure here must not disturb the page.
      }
    }

    void check();
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [dispatch]);

  // Re-check immediately when the live critical count jumps, so a scenario
  // switch surfaces its alert without waiting out the poll interval.
  useEffect(() => {
    if (criticalCount > criticalCountRef.current) {
      alertsApi
        .list({ status: 'ACTIVE', severity: 'CRITICAL', pageSize: 5 })
        .then((data) => {
          for (const alert of data.items) {
            if (notifiedRef.current.includes(alert.id)) continue;
            dispatch(
              pushToast({
                severity: 'CRITICAL',
                title: alert.condition,
                message: alert.message,
                alertId: alert.id,
              }),
            );
          }
        })
        .catch(() => {});
    }
    criticalCountRef.current = criticalCount;
  }, [criticalCount, dispatch]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      role="region"
      aria-label="Critical alert notifications"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dispatch(dismissToast(toast.id))} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: { id: string; title: string; message: string; createdAt: number; alertId?: string };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  return (
    <div
      className="pointer-events-auto animate-slide-in rounded-md border border-red-500/40 bg-panel-850 shadow-xl shadow-black/40"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3 p-3">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-semibold text-red-200">{toast.title}</p>
            <span className="shrink-0 text-2xs text-slate-500">
              {fmtTime(new Date(toast.createdAt).toISOString())}
            </span>
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-400">{toast.message}</p>
          <Link
            to="/app/alerts"
            onClick={onDismiss}
            className="mt-2 inline-block text-xs font-medium text-primary-400 hover:text-primary-300"
          >
            Open Alert Center →
          </Link>
        </div>
        <button
          onClick={onDismiss}
          className="btn btn-ghost -mr-1 -mt-1 p-1"
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
