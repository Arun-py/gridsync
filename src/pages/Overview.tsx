/**
 * Overview / Control Centre — the main dashboard.
 *
 * Every value here comes from the live telemetry context, which is fed by the
 * backend pipeline. Nothing on this page generates or interpolates a number
 * (spec §14: "Do not hardcode changing values into JSX").
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Battery,
  BatteryCharging,
  Bell,
  Gauge,
  Minus,
  Plug,
  Sun,
  Zap,
} from 'lucide-react';

import type { Alert, EnrichedFrame, NodeConfig } from '@shared/types';
import { CHART_COLORS, LevelMeter, TimeSeriesChart } from '../components/charts';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  NodeStatusBadge,
  Panel,
  SeverityBadge,
  fmt,
  fmtAge,
  fmtPercent,
  fmtPower,
  fmtTime,
} from '../components/ui';
import { alertsApi, errorMessage } from '../lib/api';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

/** Rolling in-memory window for the live strip chart. */
const LIVE_POINTS = 90;

/** Index signature so the row is accepted directly by the chart components. */
interface LivePoint extends Record<string, unknown> {
  timestamp: string;
  generation: number;
  consumption: number;
  net: number;
}

export default function Overview() {
  const { t } = useTranslation();
  const { snapshot, frames, nodes, ready, status, lastUpdateAgeMs } = useTelemetry();

  const [history, setHistory] = useState<LivePoint[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertError, setAlertError] = useState<string | null>(null);

  // Append each snapshot to a bounded rolling window. This is a VIEW of data
  // already received, not a second source of truth.
  useEffect(() => {
    if (!snapshot) return;
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last?.timestamp === snapshot.timestamp) return prev;
      const next = [
        ...prev,
        {
          timestamp: snapshot.timestamp,
          generation: snapshot.generationW,
          consumption: snapshot.consumptionW,
          net: snapshot.netPowerW,
        },
      ];
      return next.length > LIVE_POINTS ? next.slice(-LIVE_POINTS) : next;
    });
  }, [snapshot]);

  // Recent alerts, refreshed independently of the telemetry stream.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      alertsApi
        .list({ status: 'ACTIVE', pageSize: 6 })
        .then((data) => {
          if (!cancelled) {
            setAlerts(data.items);
            setAlertError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setAlertError(errorMessage(err));
        });

    void load();
    const id = window.setInterval(load, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const byType = useMemo(() => groupByType(frames, nodes), [frames, nodes]);

  if (!ready) return <LoadingState label="Connecting to telemetry" />;

  if (!snapshot) {
    return (
      <ErrorState
        variant="offline"
        title="No telemetry available"
        message={
          status === 'offline'
            ? 'Cannot reach the GridSync API. Check that the server is running.'
            : 'No telemetry has been received yet. Start the simulator with: npm run worker'
        }
      />
    );
  }

  const gen = fmtPower(snapshot.generationW);
  const con = fmtPower(snapshot.consumptionW);
  const net = fmtPower(Math.abs(snapshot.netPowerW));
  const surplus = snapshot.netPowerW >= 0;

  return (
    <div className="space-y-4">
      {/* ---- header ---- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Control Centre</h1>
          <p className="mt-1 text-xs text-slate-500">
            {snapshot.nodesOnline} of {snapshot.nodesTotal} nodes reporting · updated{' '}
            {fmtAge(lastUpdateAgeMs)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-neutral">Scenario: {snapshot.scenario.replace(/_/g, ' ')}</span>
        </div>
      </div>

      {/* ---- headline metrics ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel>
          <Metric
            label={t('metrics.generation')}
            value={gen.value}
            unit={gen.unit}
            accent={CHART_COLORS.solar}
            hint={`${byType.SOLAR.length} solar node(s)`}
          />
        </Panel>
        <Panel>
          <Metric
            label={t('metrics.consumption')}
            value={con.value}
            unit={con.unit}
            accent={CHART_COLORS.ac}
            hint={`AC ${fmt(snapshot.acLoadW, 0)} W · DC ${fmt(snapshot.dcLoadW, 0)} W`}
          />
        </Panel>
        <Panel>
          <Metric
            label={t('metrics.batterySoc')}
            value={snapshot.batterySoc === null ? '—' : fmt(snapshot.batterySoc, 1)}
            unit={snapshot.batterySoc === null ? undefined : '%'}
            accent={CHART_COLORS.battery}
            hint={
              snapshot.batteryState
                ? t(`metrics.${snapshot.batteryState.toLowerCase()}`)
                : 'No battery node'
            }
          />
        </Panel>
        <Panel>
          <Metric
            label={t('metrics.efficiency')}
            value={fmtPercent(snapshot.systemEfficiency, 1)}
            hint={
              snapshot.systemEfficiency === null
                ? 'No generation in window'
                : 'Delivered load ÷ generation'
            }
          />
        </Panel>
      </div>

      {/* ---- energy balance + subsystem cards ---- */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Energy balance"
          subtitle="Live generation against consumption"
          actions={
            <span
              className={`badge ${surplus ? 'badge-ok' : 'badge-warning'}`}
              title={
                surplus
                  ? 'Generation exceeds demand — surplus is charging storage'
                  : 'Demand exceeds generation — the shortfall is drawn from storage'
              }
            >
              {surplus ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {surplus ? t('metrics.surplus') : t('metrics.deficit')} {net.value} {net.unit}
            </span>
          }
        >
          <TimeSeriesChart
            data={history}
            height={260}
            unit="W"
            series={[
              { key: 'generation', name: 'Generation', color: CHART_COLORS.solar, area: true },
              { key: 'consumption', name: 'Consumption', color: CHART_COLORS.ac, area: true },
            ]}
            emptyMessage="Waiting for the first telemetry frames."
          />
        </Panel>

        <div className="space-y-4">
          <Panel title="Storage">
            <LevelMeter
              value={snapshot.batterySoc}
              label="State of charge"
              sublabel={
                snapshot.batteryPowerW === null
                  ? 'No battery node configured'
                  : `${snapshot.batteryState === 'CHARGING' ? 'Charging at' : snapshot.batteryState === 'DISCHARGING' ? 'Discharging at' : 'Idle —'} ${fmt(Math.abs(snapshot.batteryPowerW), 0)} W`
              }
            />
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-panel-800 pt-4">
              <Metric
                label="AC load"
                value={fmt(snapshot.acLoadW, 0)}
                unit="W"
                size="sm"
                accent={CHART_COLORS.ac}
              />
              <Metric
                label="DC load"
                value={fmt(snapshot.dcLoadW, 0)}
                unit="W"
                size="sm"
                accent={CHART_COLORS.dc}
              />
            </div>
          </Panel>

          <Panel
            title="Active alerts"
            actions={
              <Link to="/app/alerts" className="text-xs text-primary-400 hover:text-primary-300">
                View all →
              </Link>
            }
          >
            <div className="grid grid-cols-3 gap-2">
              <AlertCount
                label="Critical"
                count={snapshot.activeAlerts.critical}
                className="border-red-500/30 bg-red-500/5 text-red-300"
              />
              <AlertCount
                label="Warning"
                count={snapshot.activeAlerts.warning}
                className="border-amber-500/30 bg-amber-500/5 text-amber-300"
              />
              <AlertCount
                label="Info"
                count={snapshot.activeAlerts.info}
                className="border-sky-500/30 bg-sky-500/5 text-sky-300"
              />
            </div>
          </Panel>
        </div>
      </div>

      {/* ---- per-subsystem summary cards ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SubsystemCard
          title="Solar"
          icon={Sun}
          color={CHART_COLORS.solar}
          to="/app/solar"
          frames={byType.SOLAR}
          nodes={nodes}
        />
        <SubsystemCard
          title="Battery"
          icon={Battery}
          color={CHART_COLORS.battery}
          to="/app/battery"
          frames={byType.BATTERY}
          nodes={nodes}
        />
        <SubsystemCard
          title="AC Load"
          icon={Zap}
          color={CHART_COLORS.ac}
          to="/app/ac-load"
          frames={byType.AC_LOAD}
          nodes={nodes}
        />
        <SubsystemCard
          title="DC Load"
          icon={Plug}
          color={CHART_COLORS.dc}
          to="/app/dc-load"
          frames={byType.DC_LOAD}
          nodes={nodes}
        />
      </div>

      {/* ---- node table + recent anomalies ---- */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Node connectivity" bodyClassName="">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Status</th>
                  <th className="text-right">Power</th>
                  <th className="text-right">Voltage</th>
                  <th className="text-right">Current</th>
                  <th className="text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {frames.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-slate-500">
                      No nodes reporting.
                    </td>
                  </tr>
                )}
                {frames.map((frame) => {
                  const node = nodes.find((n) => n.id === frame.nodeId);
                  return (
                    <tr key={frame.nodeId}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-sm"
                            style={{ background: typeColor(frame.nodeType) }}
                          />
                          <span className="font-medium text-slate-200">
                            {node?.shortName ?? frame.nodeId}
                          </span>
                        </div>
                      </td>
                      <td>
                        <NodeStatusBadge status={frame.status} />
                      </td>
                      <td className="tabular text-right">{fmt(frame.power, 1)} W</td>
                      <td className="tabular text-right">{fmt(frame.voltage, 2)} V</td>
                      <td className="tabular text-right">{fmt(frame.current, 2)} A</td>
                      <td className="text-right text-xs text-slate-500">
                        {fmtAge(frame.ageMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Recent alerts" bodyClassName="">
          {alertError ? (
            <div className="p-4">
              <ErrorState message={alertError} />
            </div>
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={<Bell className="h-6 w-6" />}
              title="No active alerts"
              description="The rule engine has not flagged anything."
            />
          ) : (
            <ul className="divide-y divide-panel-800">
              {alerts.map((alert) => (
                <li key={alert.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-200">
                        {alert.condition}
                      </p>
                      <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-slate-500">
                        {alert.message}
                      </p>
                    </div>
                    <SeverityBadge severity={alert.severity} />
                  </div>
                  <p className="mt-1.5 text-2xs text-slate-600">
                    {alert.nodeId ?? 'system'} · {fmtTime(alert.timestamp)} · {alert.source}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function AlertCount({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  return (
    <div className={`rounded border px-3 py-2.5 ${className}`}>
      <p className="tabular text-xl font-semibold leading-none">{count}</p>
      <p className="mt-1.5 text-2xs uppercase tracking-wider opacity-70">{label}</p>
    </div>
  );
}

function SubsystemCard({
  title,
  icon: Icon,
  color,
  to,
  frames,
  nodes,
}: {
  title: string;
  icon: typeof Sun;
  color: string;
  to: string;
  frames: EnrichedFrame[];
  nodes: NodeConfig[];
}) {
  const totalPower = frames.reduce((s, f) => s + f.power, 0);
  const power = fmtPower(totalPower);
  const online = frames.filter((f) => f.status === 'ONLINE').length;
  const anyFault = frames.some((f) => f.status === 'FAULT' || f.status === 'OFFLINE');

  // Subsystem-specific secondary reading.
  const detail = (() => {
    if (frames.length === 0) return 'Not configured';
    const first = frames[0];
    if (first.nodeType === 'SOLAR') {
      const eff = frames.find((f) => f.efficiency !== undefined)?.efficiency;
      return eff === undefined
        ? `${fmt(first.lux ?? 0, 0)} lx`
        : `Efficiency ${fmtPercent(eff, 0)} · ${fmt(first.lux ?? 0, 0)} lx`;
    }
    if (first.nodeType === 'BATTERY') {
      const soc = frames.reduce((s, f) => s + (f.soc ?? 0), 0) / frames.length;
      return `SOC ${fmt(soc, 1)}% · ${first.batteryState ?? 'IDLE'}`;
    }
    const rated = frames.reduce(
      (s, f) => s + (nodes.find((n) => n.id === f.nodeId)?.ratedPower ?? 0),
      0,
    );
    return rated > 0 ? `${fmtPercent(totalPower / rated, 0)} of ${rated} W rating` : '—';
  })();

  const StateIcon =
    frames[0]?.batteryState === 'CHARGING'
      ? BatteryCharging
      : frames[0]?.batteryState === 'DISCHARGING'
        ? ArrowDownRight
        : Minus;

  return (
    <Link to={to} className="panel block p-4 transition-colors hover:border-panel-600">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" strokeWidth={1.75} style={{ color }} />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {title}
          </span>
        </div>
        {frames.length > 0 && (
          <span className={`badge ${anyFault ? 'badge-critical' : 'badge-ok'}`}>
            {online}/{frames.length}
          </span>
        )}
      </div>

      <p className="metric-value mt-3 text-2xl" style={{ color }}>
        {power.value}
        <span className="metric-unit">{power.unit}</span>
      </p>

      <p className="mt-1.5 flex items-center gap-1 truncate text-2xs text-slate-500">
        {frames[0]?.nodeType === 'BATTERY' && <StateIcon className="h-3 w-3 shrink-0" />}
        {detail}
      </p>
    </Link>
  );
}

function groupByType(frames: EnrichedFrame[], nodes: NodeConfig[]) {
  const out: Record<NodeConfig['type'], EnrichedFrame[]> = {
    SOLAR: [],
    BATTERY: [],
    AC_LOAD: [],
    DC_LOAD: [],
  };
  for (const frame of frames) {
    const type = nodes.find((n) => n.id === frame.nodeId)?.type ?? frame.nodeType;
    out[type]?.push(frame);
  }
  return out;
}

function typeColor(type: NodeConfig['type']): string {
  return {
    SOLAR: CHART_COLORS.solar,
    BATTERY: CHART_COLORS.battery,
    AC_LOAD: CHART_COLORS.ac,
    DC_LOAD: CHART_COLORS.dc,
  }[type];
}

export { Activity, Gauge };
