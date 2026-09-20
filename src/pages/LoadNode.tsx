/**
 * AC and DC load branches.
 *
 * One component serves both, parameterised by node type — the pages differ in
 * nominal voltage and accent colour, not in behaviour.
 *
 * RELAY HONESTY (spec §18): GridSync has no physical relay control. Load-
 * shedding suggestions are therefore labelled "Recommended / Simulated Action"
 * and the interface never claims a relay operated.
 */

import { useState } from 'react';
import { AlertTriangle, Plug, ShieldAlert, Zap } from 'lucide-react';

import type { NodeConfig, NodeType, TimeRange } from '@shared/types';
import { THRESHOLDS } from '@shared/constants';
import { CHART_COLORS } from '../components/charts';
import { HistoryPanel, RangeSelector, useNodeHistory } from '../components/NodeHistory';
import {
  EmptyState,
  Metric,
  NodeStatusBadge,
  Panel,
  fmt,
  fmtAge,
  fmtPercent,
} from '../components/ui';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

export default function LoadNode({ kind }: { kind: Extract<NodeType, 'AC_LOAD' | 'DC_LOAD'> }) {
  const { frames, nodes } = useTelemetry();
  const [range, setRange] = useState<TimeRange>('6H');

  const loadNodes = nodes.filter((n) => n.type === kind);
  const [activeId, setActiveId] = useState<string | null>(null);
  const nodeId = activeId ?? loadNodes[0]?.id ?? (kind === 'AC_LOAD' ? 'ac_load' : 'dc_load');

  const node = nodes.find((n) => n.id === nodeId);
  const frame = frames.find((f) => f.nodeId === nodeId);

  const { data, loading, error, reload } = useNodeHistory(nodeId, range);

  const isAc = kind === 'AC_LOAD';
  const accent = isAc ? CHART_COLORS.ac : CHART_COLORS.dc;
  const Icon = isAc ? Zap : Plug;
  const title = isAc ? 'AC Load' : 'DC Load';

  if (!node) {
    return (
      <Panel title={title}>
        <EmptyState
          icon={<Icon className="h-6 w-6" />}
          title={`No ${title.toLowerCase()} node configured`}
          description={`The node catalogue contains no ${kind} node.`}
        />
      </Panel>
    );
  }

  const loadRatio = frame ? frame.power / node.ratedPower : 0;
  const overload = loadRatio > THRESHOLDS.load.overloadRatio;
  const severeOverload = loadRatio > THRESHOLDS.load.criticalOverloadRatio;
  const brownout = frame
    ? frame.voltage < node.nominalVoltage * THRESHOLDS.load.brownoutRatio
    : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
            <Icon className="h-5 w-5" style={{ color: accent }} strokeWidth={1.75} />
            {node.shortName}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {node.description} · {node.ratedPower} W rated · {node.nominalVoltage} V nominal
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`badge ${node.criticality === 'CRITICAL' ? 'badge-warning' : 'badge-neutral'}`}
            title={
              node.criticality === 'CRITICAL'
                ? 'Critical branch — do not shed without confirming dependent loads'
                : 'Non-critical branch — eligible for load shifting'
            }
          >
            {node.criticality === 'CRITICAL' ? 'Critical' : 'Non-critical'}
          </span>
          {loadNodes.length > 1 && (
            <select
              className="select w-auto text-xs"
              value={nodeId}
              onChange={(e) => setActiveId(e.target.value)}
              aria-label={`Select ${title} node`}
            >
              {loadNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.shortName}
                </option>
              ))}
            </select>
          )}
          {frame && <NodeStatusBadge status={frame.status} />}
          <RangeSelector value={range} onChange={setRange} />
        </div>
      </div>

      {!frame ? (
        <Panel>
          <EmptyState
            title="Node not reporting"
            description="No live telemetry. Start the simulator with: npm run worker"
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Panel>
              <Metric
                label="Power"
                value={fmt(frame.power, 1)}
                unit="W"
                accent={overload ? CHART_COLORS.critical : accent}
              />
            </Panel>
            <Panel>
              <Metric
                label="Voltage"
                value={fmt(frame.voltage, 2)}
                unit="V"
                accent={brownout ? CHART_COLORS.warning : undefined}
              />
            </Panel>
            <Panel>
              <Metric label="Current" value={fmt(frame.current, 2)} unit="A" />
            </Panel>
            <Panel>
              <Metric
                label="Utilisation"
                value={fmtPercent(loadRatio, 0)}
                accent={overload ? CHART_COLORS.critical : undefined}
                hint={`of ${node.ratedPower} W`}
              />
            </Panel>
            <Panel>
              <Metric
                label="Classification"
                value={node.criticality === 'CRITICAL' ? 'Critical' : 'Non-critical'}
                size="sm"
              />
            </Panel>
          </div>

          {/* ---- utilisation bar ---- */}
          <Panel title="Branch utilisation" subtitle="Demand against nameplate rating">
            <UtilisationBar
              value={frame.power}
              rated={node.ratedPower}
              overloadRatio={THRESHOLDS.load.overloadRatio}
              criticalRatio={THRESHOLDS.load.criticalOverloadRatio}
              color={accent}
            />
          </Panel>

          {/* ---- overload ---- */}
          {overload && (
            <div
              className={`rounded-md border p-4 ${
                severeOverload
                  ? 'border-red-500/30 bg-red-500/5'
                  : 'border-amber-500/30 bg-amber-500/5'
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${severeOverload ? 'text-red-400' : 'text-amber-400'}`}
                />
                <div>
                  <p
                    className={`text-sm font-medium ${severeOverload ? 'text-red-200' : 'text-amber-200'}`}
                  >
                    {severeOverload ? 'Severe overload' : 'Branch load above rating'}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    Drawing {fmt(frame.power, 0)} W against a {node.ratedPower} W rating (
                    {fmtPercent(loadRatio, 0)}).
                  </p>

                  {/* Explicitly labelled: no relay exists. */}
                  <div className="mt-3 rounded border border-panel-700 bg-panel-950/50 p-3">
                    <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-400">
                      <ShieldAlert className="h-3 w-3" />
                      Recommended / Simulated Action
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                      {node.criticality === 'CRITICAL'
                        ? 'Investigate the appliances connected to this critical branch. Do not shed it without confirming the dependent loads.'
                        : 'Reduce non-critical load on this branch to bring current within rating.'}
                    </p>
                    <p className="mt-2 text-2xs leading-relaxed text-slate-600">
                      GridSync has no physical relay control in this release. This is a
                      recommendation for an operator to carry out — no switching has occurred.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---- brownout ---- */}
          {brownout && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-amber-200">Bus voltage below threshold</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {fmt(frame.voltage, 1)} V against a {node.nominalVoltage} V nominal (brownout
                    threshold {fmt(node.nominalVoltage * THRESHOLDS.load.brownoutRatio, 1)} V).
                    Consistent with an undersized conductor, a depleted battery, or inverter current
                    limiting.
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    <span className="font-medium text-slate-300">Recommended action: </span>
                    Reduce branch demand and check conductor sizing and termination resistance
                    between the source and this branch.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ---- charts ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <HistoryPanel
              title="Demand"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="W"
              series={[{ key: 'power', name: 'Power', color: accent, area: true }]}
              referenceLines={[
                { y: node.ratedPower, label: 'rating', color: '#64748b' },
                {
                  y: node.ratedPower * THRESHOLDS.load.overloadRatio,
                  label: 'overload',
                  color: CHART_COLORS.critical,
                },
              ]}
            />
            <HistoryPanel
              title="Bus voltage"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="V"
              series={[{ key: 'voltage', name: 'Voltage', color: CHART_COLORS.primary }]}
              referenceLines={[
                { y: node.nominalVoltage, label: 'nominal', color: '#64748b' },
                {
                  y: node.nominalVoltage * THRESHOLDS.load.brownoutRatio,
                  label: 'brownout',
                  color: CHART_COLORS.warning,
                },
              ]}
            />
            <HistoryPanel
              title="Current"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="A"
              series={[{ key: 'current', name: 'Current', color: '#34d399', area: true }]}
              referenceLines={[
                { y: node.currentRange[1], label: 'max', color: CHART_COLORS.critical },
              ]}
            />
            <EnergyPanel node={node} data={data} range={range} />
          </div>

          <p className="text-2xs text-slate-600">
            Last frame {fmtAge(frame.ageMs)} · sequence {frame.sequenceNumber} · source {frame.source}
          </p>
        </>
      )}
    </div>
  );
}

function UtilisationBar({
  value,
  rated,
  overloadRatio,
  criticalRatio,
  color,
}: {
  value: number;
  rated: number;
  overloadRatio: number;
  criticalRatio: number;
  color: string;
}) {
  // Scale the track to the critical ratio so an overload has somewhere to go.
  const max = rated * criticalRatio * 1.1;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const ratio = value / rated;

  const barColor =
    ratio > criticalRatio ? CHART_COLORS.critical : ratio > overloadRatio ? CHART_COLORS.warning : color;

  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-panel-800">
        <div
          className="h-full rounded-full transition-[width,background-color] duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
        {/* threshold ticks */}
        <span
          className="absolute top-0 h-full w-px bg-slate-500"
          style={{ left: `${(rated / max) * 100}%` }}
          title="Rated"
        />
        <span
          className="absolute top-0 h-full w-px bg-amber-500"
          style={{ left: `${((rated * overloadRatio) / max) * 100}%` }}
          title="Overload"
        />
        <span
          className="absolute top-0 h-full w-px bg-red-500"
          style={{ left: `${((rated * criticalRatio) / max) * 100}%` }}
          title="Severe overload"
        />
      </div>
      <div className="mt-2 flex justify-between text-2xs text-slate-600">
        <span>0 W</span>
        <span className="text-slate-400">
          {fmt(value, 0)} W · {fmtPercent(ratio, 0)}
        </span>
        <span>{fmt(max, 0)} W</span>
      </div>
    </div>
  );
}

/** Energy consumed over the window, integrated from the sampled power series. */
function EnergyPanel({
  node,
  data,
  range,
}: {
  node: NodeConfig;
  data: Array<{ timestamp: string; power: number; valid: boolean }>;
  range: TimeRange;
}) {
  const valid = data.filter((d) => d.valid);

  // Trapezoidal integration over the actual sample timestamps. Using the mean
  // power times the window length would be wrong when samples are unevenly
  // spaced, which they are after server-side down-sampling.
  let wattSeconds = 0;
  for (let i = 1; i < valid.length; i++) {
    const dt = (new Date(valid[i].timestamp).getTime() - new Date(valid[i - 1].timestamp).getTime()) / 1000;
    if (dt > 0 && dt < 86_400) {
      wattSeconds += ((valid[i].power + valid[i - 1].power) / 2) * dt;
    }
  }
  const kwh = wattSeconds / 3_600_000;
  const peak = valid.reduce((m, d) => Math.max(m, d.power), 0);
  const avg = valid.length ? valid.reduce((s, d) => s + d.power, 0) / valid.length : 0;

  return (
    <Panel title="Energy consumption" subtitle={`Over the selected ${range} window`}>
      <div className="grid grid-cols-3 gap-4">
        <Metric label="Energy" value={fmt(kwh, 3)} unit="kWh" size="sm" />
        <Metric label="Peak" value={fmt(peak, 0)} unit="W" size="sm" />
        <Metric label="Average" value={fmt(avg, 0)} unit="W" size="sm" />
      </div>
      <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
        Energy is integrated from {valid.length} down-sampled readings using the trapezoidal rule.
        It is an estimate at the resolution of the returned series, not a meter reading.
        {data.length !== valid.length &&
          ` ${data.length - valid.length} invalid reading(s) were excluded.`}
      </p>
      <p className="mt-2 text-2xs text-slate-600">
        Rated {node.ratedPower} W · {node.criticality === 'CRITICAL' ? 'critical' : 'non-critical'}{' '}
        branch
      </p>
    </Panel>
  );
}
