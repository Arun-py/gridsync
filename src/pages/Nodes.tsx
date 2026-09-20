/**
 * Node Monitoring — every configured node at a glance.
 *
 * Nodes are DISCOVERED from the API. Nothing here is hardcoded to four nodes;
 * raising the simulator's node count to eight simply renders eight cards.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Battery, LayoutGrid, List, Plug, Sun, Zap } from 'lucide-react';

import type { EnrichedFrame, NodeConfig, NodeType } from '@shared/types';
import { CHART_COLORS } from '../components/charts';
import {
  EmptyState,
  LoadingState,
  NodeStatusBadge,
  Panel,
  fmt,
  fmtAge,
  fmtPercent,
} from '../components/ui';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

const TYPE_META: Record<NodeType, { icon: typeof Sun; color: string; route: string }> = {
  SOLAR: { icon: Sun, color: CHART_COLORS.solar, route: '/app/solar' },
  BATTERY: { icon: Battery, color: CHART_COLORS.battery, route: '/app/battery' },
  AC_LOAD: { icon: Zap, color: CHART_COLORS.ac, route: '/app/ac-load' },
  DC_LOAD: { icon: Plug, color: CHART_COLORS.dc, route: '/app/dc-load' },
};

export default function Nodes() {
  const { frames, nodes, ready } = useTelemetry();
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [typeFilter, setTypeFilter] = useState<NodeType | 'ALL'>('ALL');

  const rows = useMemo(
    () =>
      nodes
        .filter((n) => typeFilter === 'ALL' || n.type === typeFilter)
        .map((node) => ({ node, frame: frames.find((f) => f.nodeId === node.id) })),
    [nodes, frames, typeFilter],
  );

  if (!ready) return <LoadingState label="Discovering nodes" />;

  if (nodes.length === 0) {
    return (
      <Panel title="Nodes">
        <EmptyState
          title="No nodes configured"
          description="The API returned an empty node catalogue."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Node Monitoring</h1>
          <p className="mt-1 text-xs text-slate-500">
            {nodes.length} node(s) discovered from the API ·{' '}
            {frames.filter((f) => f.status === 'ONLINE').length} reporting
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="select w-auto text-xs"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as NodeType | 'ALL')}
            aria-label="Filter by node type"
          >
            <option value="ALL">All types</option>
            <option value="SOLAR">Solar</option>
            <option value="BATTERY">Battery</option>
            <option value="AC_LOAD">AC load</option>
            <option value="DC_LOAD">DC load</option>
          </select>

          <div className="flex rounded border border-panel-600 p-0.5" role="group" aria-label="View">
            <button
              onClick={() => setView('grid')}
              aria-pressed={view === 'grid'}
              className={`rounded p-1.5 ${view === 'grid' ? 'bg-primary-600 text-white' : 'text-slate-400'}`}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              className={`rounded p-1.5 ${view === 'table' ? 'bg-primary-600 text-white' : 'text-slate-400'}`}
              aria-label="Table view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map(({ node, frame }) => (
            <NodeCard key={node.id} node={node} frame={frame} />
          ))}
        </div>
      ) : (
        <Panel bodyClassName="">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="text-right">Power</th>
                  <th className="text-right">Voltage</th>
                  <th className="text-right">Current</th>
                  <th className="text-right">Temp</th>
                  <th className="text-right">SOC</th>
                  <th className="text-right">Seq</th>
                  <th className="text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ node, frame }) => (
                  <tr key={node.id}>
                    <td>
                      <Link
                        to={TYPE_META[node.type].route}
                        className="font-medium text-slate-200 hover:text-primary-300"
                      >
                        {node.shortName}
                      </Link>
                    </td>
                    <td className="text-xs text-slate-500">{node.type.replace('_', ' ')}</td>
                    <td>{frame ? <NodeStatusBadge status={frame.status} /> : <span className="badge badge-neutral">No data</span>}</td>
                    <td className="tabular text-right">{frame ? `${fmt(frame.power, 1)} W` : '—'}</td>
                    <td className="tabular text-right">{frame ? `${fmt(frame.voltage, 2)} V` : '—'}</td>
                    <td className="tabular text-right">{frame ? `${fmt(frame.current, 2)} A` : '—'}</td>
                    <td className="tabular text-right">
                      {frame?.temperature !== undefined ? `${fmt(frame.temperature, 1)} °C` : '—'}
                    </td>
                    <td className="tabular text-right">
                      {frame?.soc !== undefined ? `${fmt(frame.soc, 1)}%` : '—'}
                    </td>
                    <td className="tabular text-right text-xs text-slate-500">
                      {frame?.sequenceNumber ?? '—'}
                    </td>
                    <td className="text-right text-xs text-slate-500">
                      {frame ? fmtAge(frame.ageMs) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function NodeCard({ node, frame }: { node: NodeConfig; frame?: EnrichedFrame }) {
  const meta = TYPE_META[node.type];
  const Icon = meta.icon;

  const utilisation =
    frame && (node.type === 'AC_LOAD' || node.type === 'DC_LOAD')
      ? frame.power / node.ratedPower
      : null;

  return (
    <Link to={meta.route} className="panel block p-4 transition-colors hover:border-panel-600">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} style={{ color: meta.color }} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">{node.shortName}</p>
            <p className="truncate text-2xs text-slate-500">{node.category}</p>
          </div>
        </div>
        {frame ? (
          <NodeStatusBadge status={frame.status} />
        ) : (
          <span className="badge badge-neutral">No data</span>
        )}
      </div>

      {frame ? (
        <>
          <p className="metric-value mt-4 text-2xl" style={{ color: meta.color }}>
            {fmt(frame.power, 1)}
            <span className="metric-unit">W</span>
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-panel-800 pt-3 text-2xs">
            <Cell k="Voltage" v={`${fmt(frame.voltage, 2)} V`} />
            <Cell k="Current" v={`${fmt(frame.current, 2)} A`} />
            {frame.temperature !== undefined && (
              <Cell k="Temp" v={`${fmt(frame.temperature, 1)} °C`} />
            )}
            {frame.lux !== undefined && <Cell k="Light" v={`${fmt(frame.lux, 0)} lx`} />}
            {frame.soc !== undefined && <Cell k="SOC" v={`${fmt(frame.soc, 1)}%`} />}
            {frame.efficiency !== undefined && (
              <Cell k="Efficiency" v={fmtPercent(frame.efficiency, 0)} />
            )}
            {utilisation !== null && <Cell k="Load" v={fmtPercent(utilisation, 0)} />}
          </dl>

          {!frame.valid && (
            <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-2xs text-amber-300">
              Sensor fault — reading excluded from analytics
            </p>
          )}

          <p className="mt-2.5 text-2xs text-slate-600">{fmtAge(frame.ageMs)}</p>
        </>
      ) : (
        <p className="mt-6 text-center text-2xs text-slate-600">No telemetry received</p>
      )}
    </Link>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-600">{k}</dt>
      <dd className="tabular text-slate-300">{v}</dd>
    </div>
  );
}
