/**
 * Microgrid Digital Twin.
 *
 * The power-flow diagram plus a detail drawer. Clicking a node opens its
 * current values, status, recent alerts, historical chart and any model
 * recommendation — all fetched live (spec §15).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, X } from 'lucide-react';

import type { Alert, Prediction, TimeRange } from '@shared/types';
import { CHART_COLORS, TimeSeriesChart } from '../components/charts';
import PowerFlowDiagram from '../components/PowerFlowDiagram';
import {
  EmptyState,
  ErrorState,
  KindBadge,
  LoadingState,
  Metric,
  NodeStatusBadge,
  Panel,
  SeverityBadge,
  fmt,
  fmtAge,
  fmtPercent,
  fmtTime,
} from '../components/ui';
import { alertsApi, errorMessage, intelligenceApi, telemetryApi } from '../lib/api';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

export default function Microgrid() {
  const { snapshot, frames, nodes, ready } = useTelemetry();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  if (!ready) return <LoadingState label="Connecting to telemetry" />;

  if (!snapshot) {
    return (
      <ErrorState
        variant="offline"
        title="No telemetry available"
        message="Start the simulator with: npm run worker"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Microgrid Digital Twin</h1>
        <p className="mt-1 text-xs text-slate-500">
          Live power flow. Line weight and animation speed follow actual power; the storage link
          reverses with charge direction.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.75fr_1fr]">
        <Panel
          title="Power flow"
          subtitle="Click a node for details"
          actions={
            <span className="badge badge-neutral">
              {snapshot.nodesOnline}/{snapshot.nodesTotal} online
            </span>
          }
        >
          <PowerFlowDiagram
            snapshot={snapshot}
            frames={frames}
            nodes={nodes}
            onSelectNode={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
          />

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-panel-800 pt-4">
            <LegendItem color={CHART_COLORS.solar} label="Generation" />
            <LegendItem color={CHART_COLORS.battery} label="Storage" />
            <LegendItem color={CHART_COLORS.ac} label="AC load" />
            <LegendItem color={CHART_COLORS.dc} label="DC load" />
            <span className="ml-auto flex items-center gap-1.5 text-2xs text-slate-600">
              <Info className="h-3 w-3" />
              Dashed = no flow
            </span>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="System state">
            <div className="grid grid-cols-2 gap-4">
              <Metric
                label="Generation"
                value={fmt(snapshot.generationW, 0)}
                unit="W"
                size="sm"
                accent={CHART_COLORS.solar}
              />
              <Metric
                label="Consumption"
                value={fmt(snapshot.consumptionW, 0)}
                unit="W"
                size="sm"
                accent={CHART_COLORS.ac}
              />
              <Metric
                label="Balance"
                value={`${snapshot.netPowerW >= 0 ? '+' : ''}${fmt(snapshot.netPowerW, 0)}`}
                unit="W"
                size="sm"
                accent={snapshot.netPowerW >= 0 ? CHART_COLORS.battery : CHART_COLORS.warning}
              />
              <Metric
                label="Efficiency"
                value={fmtPercent(snapshot.systemEfficiency, 0)}
                size="sm"
              />
            </div>
            <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
              Balance is generation minus delivered load. A deficit is supplied by storage; a
              surplus charges it.
            </p>
          </Panel>

          {selectedNodeId ? (
            <NodeDetail nodeId={selectedNodeId} onClose={() => setSelectedNodeId(null)} />
          ) : (
            <Panel title="Node detail">
              <EmptyState
                title="No node selected"
                description="Select a node in the diagram to see its readings, alerts and history."
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-2xs text-slate-500">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function NodeDetail({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const { frameFor, nodeFor } = useTelemetry();
  const frame = frameFor(nodeId);
  const node = nodeFor(nodeId);

  const [range] = useState<TimeRange>('1H');
  const [series, setSeries] = useState<Array<Record<string, unknown>>>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      telemetryApi.history(nodeId, range, 120),
      alertsApi.list({ nodeId, pageSize: 5 }),
      intelligenceApi.predictions(50).catch(() => null),
    ])
      .then(([hist, alertData, predData]) => {
        if (cancelled) return;
        setSeries(hist.series as unknown as Array<Record<string, unknown>>);
        setAlerts(alertData.items);
        setPrediction(predData?.latest.find((p) => p.nodeId === nodeId) ?? null);
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
  }, [nodeId, range]);

  if (!node || !frame) {
    return (
      <Panel title="Node detail">
        <EmptyState title="Node not reporting" description={`No live frame for ${nodeId}.`} />
      </Panel>
    );
  }

  const accent = {
    SOLAR: CHART_COLORS.solar,
    BATTERY: CHART_COLORS.battery,
    AC_LOAD: CHART_COLORS.ac,
    DC_LOAD: CHART_COLORS.dc,
  }[node.type];

  return (
    <Panel
      title={node.shortName}
      subtitle={node.name}
      actions={
        <div className="flex items-center gap-2">
          <NodeStatusBadge status={frame.status} />
          <button onClick={onClose} className="btn btn-ghost p-1" aria-label="Close node detail">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Power" value={fmt(frame.power, 1)} unit="W" size="sm" accent={accent} />
        <Metric label="Voltage" value={fmt(frame.voltage, 2)} unit="V" size="sm" />
        <Metric label="Current" value={fmt(frame.current, 2)} unit="A" size="sm" />
        {frame.temperature !== undefined && (
          <Metric label="Temperature" value={fmt(frame.temperature, 1)} unit="°C" size="sm" />
        )}
        {frame.lux !== undefined && (
          <Metric label="Irradiance" value={fmt(frame.lux, 0)} unit="lx" size="sm" />
        )}
        {frame.soc !== undefined && (
          <Metric label="State of charge" value={fmt(frame.soc, 1)} unit="%" size="sm" />
        )}
        {frame.efficiency !== undefined && (
          <Metric label="Efficiency" value={fmtPercent(frame.efficiency, 0)} size="sm" />
        )}
      </div>

      <p className="mt-3 text-2xs text-slate-600">
        Updated {fmtAge(frame.ageMs)} · seq {frame.sequenceNumber}
        {frame.rssi !== undefined && ` · RSSI ${frame.rssi} dBm`}
      </p>

      {!frame.valid && frame.validationErrors && (
        <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-amber-300">
            Sensor fault
          </p>
          <p className="mt-1 text-2xs leading-relaxed text-amber-200/80">
            {frame.validationErrors.join('; ')}
          </p>
        </div>
      )}

      {/* ---- history ---- */}
      <div className="mt-4 border-t border-panel-800 pt-4">
        <p className="metric-label mb-2">Last hour</p>
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : (
          <TimeSeriesChart
            data={series}
            height={150}
            unit="W"
            showLegend={false}
            series={[{ key: 'power', name: 'Power', color: accent, area: true }]}
          />
        )}
      </div>

      {/* ---- model opinion, clearly separated from measurements ---- */}
      {prediction && prediction.predictedClass !== 'NORMAL' && (
        <div className="mt-4 rounded border border-violet-500/30 bg-violet-500/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-violet-200">
              {prediction.predictedClass.replace(/_/g, ' ').toLowerCase()}
            </p>
            <KindBadge kind="PREDICTED" />
          </div>
          <p className="mt-1.5 text-2xs leading-relaxed text-slate-400">{prediction.explanation}</p>
          <p className="mt-2 text-2xs text-slate-500">
            <span className="text-slate-400">Recommended: </span>
            {prediction.recommendedAction}
          </p>
          <p className="mt-2 text-2xs text-slate-600">
            Model {prediction.modelVersion} · {(prediction.confidence * 100).toFixed(0)}% confidence
            {prediction.trainedOnSyntheticData && ' · trained on synthetic data'}
          </p>
        </div>
      )}

      {/* ---- alerts ---- */}
      <div className="mt-4 border-t border-panel-800 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="metric-label">Recent alerts</p>
          <Link to="/app/alerts" className="text-2xs text-primary-400 hover:text-primary-300">
            All →
          </Link>
        </div>
        {alerts.length === 0 ? (
          <p className="py-3 text-center text-2xs text-slate-600">No alerts for this node.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((alert) => (
              <li key={alert.id} className="rounded border border-panel-700 bg-panel-850 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-2xs font-medium text-slate-200">{alert.condition}</p>
                  <SeverityBadge severity={alert.severity} />
                </div>
                <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-slate-500">
                  {alert.message}
                </p>
                <p className="mt-1 text-2xs text-slate-600">{fmtTime(alert.timestamp)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
