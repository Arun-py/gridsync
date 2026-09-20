/**
 * System Health / Network / Edge.
 *
 * THE CENTRAL DISTINCTION (spec §30, §62):
 *
 *   Internet connection failure   the cloud is unreachable, the edge is fine
 *   Edge system failure           collection itself has stopped
 *
 *   Sensor fault                  data ARRIVED but is physically impossible
 *   Communication fault           data did NOT arrive, is stale, or timed out
 *
 * These are presented as separate, explicitly-labelled states because they
 * demand completely different responses from an operator.
 */

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Cpu,
  Database,
  Radio,
  RefreshCw,
  Server,
  Wifi,
} from 'lucide-react';

import type { HealthComponentId, SystemHealth as SystemHealthType } from '@shared/types';
import { THRESHOLDS } from '@shared/constants';
import {
  ComponentStatusBadge,
  ErrorState,
  LoadingState,
  Metric,
  NodeStatusBadge,
  Panel,
  fmt,
  fmtAge,
  fmtDateTime,
} from '../components/ui';
import { errorMessage, intelligenceApi } from '../lib/api';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

const COMPONENT_ICON: Record<HealthComponentId, typeof Server> = {
  api: Server,
  mongodb: Database,
  simulator: Activity,
  ml_engine: Cpu,
  realtime: Wifi,
  mqtt: Radio,
  raspberry_pi: Cpu,
};

type HealthResponse = SystemHealthType & {
  mode: string;
  scenario: string;
  nodesConfigured: number;
  nodesReporting: number;
};

export default function SystemHealth() {
  const { frames, nodes, health: streamHealth, status: connStatus } = useTelemetry();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    intelligenceApi
      .systemHealth()
      .then((res) => {
        setData(res as HealthResponse);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = window.setInterval(load, 10_000);
    return () => window.clearInterval(id);
  }, []);

  if (loading && !data) return <LoadingState label="Checking system health" />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  // The worker's own network statistics are authoritative when the stream is
  // connected; the API's view is a fallback.
  const network = streamHealth?.network ?? data.network;

  const edgeMode = data.edgeMode || streamHealth?.edgeMode;
  const internetDown = !data.internetReachable;
  const edgeDown = !data.edgeOperational;

  // Sensor faults are visible in the live frames, not in the health payload.
  const sensorFaultNodes = frames.filter((f) => !f.valid);
  const staleNodeIds = network.staleNodes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">System Health</h1>
          <p className="mt-1 text-xs text-slate-500">
            {data.nodesReporting} of {data.nodesConfigured} nodes reporting · checked{' '}
            {fmtDateTime(data.timestamp)}
          </p>
        </div>
        <button onClick={load} className="btn btn-secondary btn-sm">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ================= failure-mode banner ================= */}
      {edgeDown ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div>
              <p className="text-sm font-semibold text-red-200">Edge system failure</p>
              <p className="mt-1.5 text-xs leading-relaxed text-red-200/70">
                No recent telemetry has been received from any node. Collection itself has stopped —
                this is <strong>not</strong> merely a connectivity problem. Displayed values are
                historical.
              </p>
              <p className="mt-2 text-2xs leading-relaxed text-slate-500">
                Check that the worker process is running: <code className="text-slate-400">npm run worker</code>
              </p>
            </div>
          </div>
        </div>
      ) : edgeMode || internetDown ? (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-4">
          <div className="flex items-start gap-3">
            <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
            <div>
              <p className="text-sm font-semibold text-orange-200">EDGE MODE ACTIVE</p>
              <p className="mt-1.5 text-xs leading-relaxed text-orange-200/70">
                Internet connection failure — the cloud database is unreachable. Local edge
                processing is still running: telemetry is being collected, validated and evaluated
                against the rule engine.
              </p>
              <p className="mt-2 text-2xs leading-relaxed text-slate-500">
                This is an internet failure, not an edge failure. Historical queries and persistence
                are unavailable until the link recovers.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-semibold text-emerald-200">All systems nominal</p>
              <p className="mt-1.5 text-xs leading-relaxed text-emerald-200/70">
                Edge collection is running and the cloud database is reachable.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ================= components ================= */}
      <Panel title="Components" subtitle="Measured where possible, declared where not">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.components.map((component) => {
            const Icon = COMPONENT_ICON[component.id] ?? Server;
            return (
              <div
                key={component.id}
                className="rounded border border-panel-700 bg-panel-850 p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={1.75} />
                    <p className="truncate text-xs font-semibold text-slate-200">
                      {component.name}
                    </p>
                  </div>
                  <ComponentStatusBadge status={component.status} />
                </div>
                <p className="mt-2 text-2xs leading-relaxed text-slate-500">{component.detail}</p>
                {component.latencyMs !== undefined && (
                  <p className="mt-1.5 tabular text-2xs text-slate-600">
                    {component.latencyMs} ms
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
          <span className="text-slate-500">SIMULATED</span> means the component is deliberately not
          present in this release — it is not a degraded state and not a claim that hardware is
          connected.
        </p>
      </Panel>

      {/* ================= network ================= */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Communication statistics">
          <div className="grid grid-cols-2 gap-4">
            <Metric
              label="Packet loss"
              value={fmt(network.packetLossPercent, 1)}
              unit="%"
              size="sm"
              accent={
                network.packetLossPercent >= THRESHOLDS.network.packetLossCriticalPercent
                  ? '#ef4444'
                  : network.packetLossPercent >= THRESHOLDS.network.packetLossWarningPercent
                    ? '#f59e0b'
                    : undefined
              }
            />
            <Metric
              label="Avg latency"
              value={fmt(network.averageLatencyMs, 0)}
              unit="ms"
              size="sm"
              accent={
                network.averageLatencyMs >= THRESHOLDS.network.latencyCriticalMs
                  ? '#ef4444'
                  : network.averageLatencyMs >= THRESHOLDS.network.latencyWarningMs
                    ? '#f59e0b'
                    : undefined
              }
            />
            <Metric
              label="Duplicate packets"
              value={network.duplicatePackets}
              size="sm"
              hint="De-duplicated on ingest"
            />
            <Metric label="Stale nodes" value={staleNodeIds.length} size="sm" />
          </div>

          <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
            Packet loss is measured from gaps in per-node sequence numbers, not estimated.
            Duplicates are detected by repeated sequence numbers and rejected by a unique index, so
            they cannot distort stored data.
          </p>
        </Panel>

        {/* ---- sensor vs communication fault ---- */}
        <Panel
          title="Fault classification"
          subtitle="Sensor faults and communication faults are different problems"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-panel-700 bg-panel-850 p-3">
              <p className="text-2xs font-semibold uppercase tracking-wider text-amber-400">
                Sensor fault
              </p>
              <p className="mt-1.5 text-2xs leading-relaxed text-slate-500">
                Data <strong className="text-slate-400">arrived</strong> but is physically
                implausible — for example a DS18B20 reporting −127 °C, its documented bus-read
                failure value.
              </p>
              <p className="mt-2 tabular text-lg font-semibold text-slate-100">
                {sensorFaultNodes.length}
              </p>
              {sensorFaultNodes.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {sensorFaultNodes.map((f) => (
                    <li key={f.nodeId} className="text-2xs">
                      <span className="text-slate-300">
                        {nodes.find((n) => n.id === f.nodeId)?.shortName ?? f.nodeId}
                      </span>
                      <span className="block text-slate-600">
                        {f.validationErrors?.[0] ?? 'failed validation'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded border border-panel-700 bg-panel-850 p-3">
              <p className="text-2xs font-semibold uppercase tracking-wider text-red-400">
                Communication fault
              </p>
              <p className="mt-1.5 text-2xs leading-relaxed text-slate-500">
                Data <strong className="text-slate-400">did not arrive</strong>, is stale, or timed
                out. The node hardware may be operating normally.
              </p>
              <p className="mt-2 tabular text-lg font-semibold text-slate-100">
                {staleNodeIds.length}
              </p>
              {staleNodeIds.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {staleNodeIds.map((id) => {
                    const frame = frames.find((f) => f.nodeId === id);
                    return (
                      <li key={id} className="text-2xs">
                        <span className="text-slate-300">
                          {nodes.find((n) => n.id === id)?.shortName ?? id}
                        </span>
                        <span className="block text-slate-600">
                          last seen {frame ? fmtAge(frame.ageMs) : 'never'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <p className="mt-3 text-2xs leading-relaxed text-slate-600">
            Thresholds: a node is STALE after {THRESHOLDS.network.staleMs / 1000} s without a frame
            and OFFLINE after {THRESHOLDS.network.offlineMs / 1000} s.
          </p>
        </Panel>
      </div>

      {/* ================= per-node link quality ================= */}
      <Panel title="Node link quality" bodyClassName="">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Status</th>
                <th className="text-right">Last frame</th>
                <th className="text-right">Sequence</th>
                <th className="text-right">RSSI</th>
                <th className="text-right">Uptime</th>
                <th>Validation</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const frame = frames.find((f) => f.nodeId === node.id);
                return (
                  <tr key={node.id}>
                    <td className="font-medium text-slate-200">{node.shortName}</td>
                    <td>
                      {frame ? (
                        <NodeStatusBadge status={frame.status} />
                      ) : (
                        <span className="badge badge-critical">No data</span>
                      )}
                    </td>
                    <td className="text-right text-xs text-slate-500">
                      {frame ? fmtAge(frame.ageMs) : '—'}
                    </td>
                    <td className="tabular text-right text-xs text-slate-500">
                      {frame?.sequenceNumber ?? '—'}
                    </td>
                    <td className="tabular text-right text-xs text-slate-500">
                      {frame?.rssi !== undefined ? `${frame.rssi} dBm` : '—'}
                    </td>
                    <td className="tabular text-right text-xs text-slate-500">
                      {frame?.uptime !== undefined ? `${Math.floor(frame.uptime / 60)} min` : '—'}
                    </td>
                    <td>
                      {!frame ? (
                        <span className="text-2xs text-slate-600">—</span>
                      ) : frame.valid ? (
                        <span className="text-2xs text-emerald-400">Valid</span>
                      ) : (
                        <span className="text-2xs text-amber-400">
                          {frame.validationErrors?.[0] ?? 'Invalid'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ================= edge architecture ================= */}
      <Panel title="Edge architecture" subtitle="Where each stage runs today">
        <div className="flex flex-wrap items-stretch gap-2">
          {[
            { label: 'ESP32 nodes', state: 'Planned', live: false },
            { label: 'MQTT broker', state: 'Adapter ready', live: false },
            { label: 'Raspberry Pi 5', state: 'Planned', live: false },
            { label: 'Worker process', state: 'Running', live: data.edgeOperational },
            { label: 'MongoDB Atlas', state: data.internetReachable ? 'Connected' : 'Unreachable', live: data.internetReachable },
            { label: 'Rules + ML', state: 'Running', live: true },
            { label: 'Dashboard', state: connStatus === 'live' ? 'Live stream' : 'Polling', live: true },
          ].map((stage) => (
            <div
              key={stage.label}
              className="min-w-[8.5rem] flex-1 rounded border border-panel-700 bg-panel-850 px-3 py-2.5"
            >
              <p className="text-2xs font-medium text-slate-300">{stage.label}</p>
              <p
                className={`mt-1 text-2xs ${stage.live ? 'text-emerald-400' : 'text-slate-600'}`}
              >
                {stage.state}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
          The hardware stages are declared as planned rather than shown as healthy. When real nodes
          are deployed, the worker switches source with{' '}
          <code className="text-slate-500">GRIDSYNC_SOURCE=mqtt</code> and nothing else in the
          platform changes.
        </p>
      </Panel>
    </div>
  );
}
