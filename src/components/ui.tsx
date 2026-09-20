/**
 * Shared UI primitives.
 *
 * Small, composable, and consistent — so pages describe *what* they show rather
 * than re-implementing panels, badges and empty states each time.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Database, Loader2, WifiOff } from 'lucide-react';

import type { ComponentStatus, NodeStatus, Severity } from '@shared/types';

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = 'panel-body',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="min-w-0">
            {title && <h2 className="panel-title truncate">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Metric
// ---------------------------------------------------------------------------

export function Metric({
  label,
  value,
  unit,
  hint,
  accent,
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  accent?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl',
  };
  return (
    <div className="min-w-0">
      <p className="metric-label">{label}</p>
      <p
        className={`metric-value mt-1.5 ${sizes[size]} truncate`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </p>
      {hint && <p className="mt-1 truncate text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const SEVERITY_CLASS: Record<Severity, string> = {
  INFO: 'badge-info',
  WARNING: 'badge-warning',
  CRITICAL: 'badge-critical',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${SEVERITY_CLASS[severity]}`}>{severity}</span>;
}

const NODE_STATUS_STYLE: Record<NodeStatus, { dot: string; badge: string; label: string }> = {
  ONLINE: { dot: 'bg-emerald-400', badge: 'badge-ok', label: 'Online' },
  DEGRADED: { dot: 'bg-amber-400', badge: 'badge-warning', label: 'Degraded' },
  STALE: { dot: 'bg-amber-400', badge: 'badge-warning', label: 'Stale' },
  OFFLINE: { dot: 'bg-red-400', badge: 'badge-critical', label: 'Offline' },
  FAULT: { dot: 'bg-red-400', badge: 'badge-critical', label: 'Sensor fault' },
};

export function NodeStatusBadge({ status }: { status: NodeStatus }) {
  const s = NODE_STATUS_STYLE[status];
  return (
    <span className={`badge ${s.badge}`}>
      <span className={`status-dot ${s.dot}`} />
      {s.label}
    </span>
  );
}

const COMPONENT_STATUS_STYLE: Record<ComponentStatus, { badge: string; dot: string }> = {
  ONLINE: { badge: 'badge-ok', dot: 'bg-emerald-400' },
  DEGRADED: { badge: 'badge-warning', dot: 'bg-amber-400' },
  OFFLINE: { badge: 'badge-critical', dot: 'bg-red-400' },
  SIMULATED: { badge: 'badge-info', dot: 'bg-sky-400' },
  UNKNOWN: { badge: 'badge-neutral', dot: 'bg-slate-500' },
};

export function ComponentStatusBadge({ status }: { status: ComponentStatus }) {
  const s = COMPONENT_STATUS_STYLE[status];
  return (
    <span className={`badge ${s.badge}`}>
      <span className={`status-dot ${s.dot}`} />
      {status}
    </span>
  );
}

/**
 * DETECTED vs PREDICTED.
 *
 * Rendered differently on purpose: a measured threshold breach and a model's
 * opinion must never look alike (spec §24).
 */
export function KindBadge({ kind }: { kind: 'DETECTED' | 'PREDICTED' }) {
  return kind === 'DETECTED' ? (
    <span className="badge border-slate-600 bg-slate-700/40 text-slate-300">Detected</span>
  ) : (
    <span className="badge border-violet-500/40 bg-violet-500/10 text-violet-300">Predicted</span>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}…
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-slate-600">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-slate-300">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * Error state.
 *
 * Errors are SHOWN, never hidden (spec §44). The message explains what failed
 * and, where possible, what the user can do about it.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  variant = 'error',
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  variant?: 'error' | 'warning' | 'offline';
}) {
  const Icon = variant === 'offline' ? WifiOff : variant === 'warning' ? AlertTriangle : Database;
  const tone =
    variant === 'warning'
      ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
      : 'border-red-500/30 bg-red-500/5 text-red-200';

  return (
    <div className={`flex items-start gap-3 rounded-md border p-4 ${tone}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs opacity-80">{message}</p>
        {onRetry && (
          <button onClick={onRetry} className="btn btn-secondary btn-sm mt-3">
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format a number for display, returning an em dash for absent values. */
export function fmt(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Watts, promoted to kW above 1000 so a dashboard never shows "12450 W". */
export function fmtPower(watts: number | null | undefined): { value: string; unit: string } {
  if (watts === null || watts === undefined || !Number.isFinite(watts)) {
    return { value: '—', unit: 'W' };
  }
  if (Math.abs(watts) >= 1000) return { value: fmt(watts / 1000, 2), unit: 'kW' };
  return { value: fmt(watts, 1), unit: 'W' };
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Compact relative age, e.g. "4s ago". */
export function fmtAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 1) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtPercent(fraction: number | null | undefined, decimals = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function fmtCurrency(amount: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : '';
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
