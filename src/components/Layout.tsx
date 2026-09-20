/**
 * Application shell.
 *
 * Carries three things that must be visible on EVERY page:
 *   1. the DEMO / SIMULATION mode indicator (spec §39 — never blur simulated
 *      and real telemetry)
 *   2. the live connection status, including which transport is in use and
 *      whether data has gone stale
 *   3. EDGE MODE ACTIVE, when local processing continues without the cloud
 */

import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CloudOff,
  LogOut,
  Menu,
  Radio,
  RefreshCw,
  ServerCrash,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';

import { useTelemetry } from '../lib/telemetry/TelemetryContext';
import { statusLabel } from '../lib/telemetry/provider';
import { useAppDispatch, useAppSelector } from '../store';
import { logout } from '../store/authSlice';
import Sidebar from './Sidebar';
import ToastHost from './ToastHost';

export default function Layout() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const { snapshot, status, statusDetail, transport, lastUpdateAgeMs, refresh, health } =
    useTelemetry();

  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer on Escape — expected behaviour for any overlay.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const mode = snapshot?.mode ?? 'SIMULATION';
  const isSimulation = mode === 'SIMULATION';
  // Data older than 15 s is not "live" any more, whatever the transport says.
  const stale = lastUpdateAgeMs > 15_000;
  const edgeMode = snapshot?.edgeMode || health?.edgeMode;

  const handleSignOut = () => {
    dispatch(logout());
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-panel-950">
      {/* ---- top bar ---- */}
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-panel-700 bg-panel-900 px-3 sm:px-4">
        <button
          className="btn btn-ghost -ml-1 p-2 lg:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <Link to="/app/overview" className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary-600">
            <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold leading-none tracking-tight text-slate-100">
              GridSync
            </p>
            <p className="mt-0.5 text-2xs leading-none text-slate-500">Microgrid Control</p>
          </div>
        </Link>

        {/* ---- MODE INDICATOR: always present, never ambiguous ---- */}
        <div className="ml-1 flex min-w-0 items-center gap-2">
          {isSimulation ? (
            <span className="sim-chip" title={t('mode.simulationNotice')}>
              <Radio className="h-3 w-3" />
              <span className="hidden sm:inline">{t('mode.simulation')}</span>
              <span className="sm:hidden">DEMO</span>
            </span>
          ) : (
            <span className="badge badge-ok">
              <Wifi className="h-3 w-3" />
              <span className="hidden sm:inline">{t('mode.realtime')}</span>
              <span className="sm:hidden">LIVE</span>
            </span>
          )}

          {edgeMode && (
            <span
              className="badge border-orange-500/40 bg-orange-500/10 text-orange-300"
              title={t('health.edgeModeExplain')}
            >
              <CloudOff className="h-3 w-3" />
              <span className="hidden md:inline">{t('health.edgeModeActive')}</span>
              <span className="md:hidden">EDGE</span>
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* ---- connection status ---- */}
        <ConnectionPill
          status={status}
          detail={statusDetail}
          transport={transport}
          stale={stale}
          ageMs={lastUpdateAgeMs}
        />

        <button
          onClick={refresh}
          className="btn btn-ghost p-2"
          aria-label="Refresh telemetry"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>

        {/* ---- user ---- */}
        <div className="flex items-center gap-2 border-l border-panel-700 pl-2 sm:pl-3">
          <div className="hidden text-right sm:block">
            <p className="max-w-[140px] truncate text-xs font-medium leading-none text-slate-200">
              {user?.name}
            </p>
            <p className="mt-1 text-2xs leading-none text-slate-500">{user?.role}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="btn btn-ghost p-2"
            aria-label={t('common.signOut')}
            title={t('common.signOut')}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---- desktop sidebar ---- */}
        <aside className="hidden w-60 shrink-0 border-r border-panel-700 bg-panel-900 lg:block">
          <Sidebar />
        </aside>

        {/* ---- mobile drawer ---- */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <aside className="fixed inset-y-0 left-0 z-50 w-64 animate-slide-in border-r border-panel-700 bg-panel-900 pt-14 lg:hidden">
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </aside>
          </>
        )}

        {/* ---- page ---- */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {stale && status !== 'offline' && (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
              {t('errors.staleData', { seconds: Math.round(lastUpdateAgeMs / 1000) })}
            </div>
          )}
          {status === 'offline' && (
            <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-200">
              <ServerCrash className="h-3.5 w-3.5 shrink-0" />
              {t('errors.apiUnavailable')} Showing the most recent data received.
            </div>
          )}
          <div className="p-3 sm:p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      <ToastHost />
    </div>
  );
}

function ConnectionPill({
  status,
  detail,
  transport,
  stale,
  ageMs,
}: {
  status: string;
  detail: string | null;
  transport: 'sse' | 'poll' | null;
  stale: boolean;
  ageMs: number;
}) {
  const offline = status === 'offline';
  const degraded = status === 'degraded' || stale;

  const Icon = offline ? WifiOff : degraded ? WifiOff : Wifi;
  const tone = offline
    ? 'border-red-500/40 bg-red-500/10 text-red-300'
    : degraded
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';

  // Be precise about what "live" means: SSE stream vs periodic polling.
  const label = statusLabel(status as never);
  const title = [
    label,
    transport === 'sse' ? 'Server-sent events' : transport === 'poll' ? 'HTTP polling' : null,
    detail,
    ageMs ? `Last update ${Math.round(ageMs / 1000)}s ago` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span className={`badge hidden ${tone} sm:inline-flex`} title={title}>
      <Icon className="h-3 w-3" />
      <span className="hidden md:inline">{label}</span>
    </span>
  );
}
