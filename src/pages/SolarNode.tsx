/**
 * SIGMA Solar Node.
 *
 * The central idea: measured power is continuously compared against a MODELLED
 * expectation derived from irradiance and cell temperature. That ratio is what
 * distinguishes "it is cloudy" from "the panel is dirty" — a fixed power
 * threshold cannot tell those apart.
 *
 * Maintenance guidance is phrased as a hypothesis to investigate, never as a
 * confirmed physical finding (spec §16).
 */

import { useState } from 'react';
import { AlertTriangle, Sun } from 'lucide-react';

import type { TimeRange } from '@shared/types';
import { THRESHOLDS } from '@shared/constants';
import { expectedSolarPower } from '@shared/physics';
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

export default function SolarNode() {
  const { frames, nodes } = useTelemetry();
  const [range, setRange] = useState<TimeRange>('6H');

  const solarNodes = nodes.filter((n) => n.type === 'SOLAR');
  const [activeId, setActiveId] = useState<string | null>(null);
  const nodeId = activeId ?? solarNodes[0]?.id ?? 'sigma';

  const node = nodes.find((n) => n.id === nodeId);
  const frame = frames.find((f) => f.nodeId === nodeId);

  const { data, loading, error, reload } = useNodeHistory(nodeId, range);

  if (!node) {
    return (
      <Panel title="Solar">
        <EmptyState
          icon={<Sun className="h-6 w-6" />}
          title="No solar node configured"
          description="The node catalogue contains no SOLAR node."
        />
      </Panel>
    );
  }

  // The modelled expectation, recomputed here from the same shared physics the
  // backend uses — so the page cannot disagree with the rule engine.
  const expected =
    frame && frame.lux !== undefined
      ? expectedSolarPower(node, frame.lux, frame.temperature ?? 25)
      : null;

  const efficiency = frame?.efficiency ?? (expected && expected > 1 && frame ? frame.power / expected : null);
  const daylight = (frame?.lux ?? 0) >= THRESHOLDS.solar.daylightLuxThreshold;

  const underperforming =
    daylight && efficiency !== null && efficiency < THRESHOLDS.solar.efficiencyWarning;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
            <Sun className="h-5 w-5" style={{ color: CHART_COLORS.solar }} strokeWidth={1.75} />
            {node.shortName}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {node.description} · {node.ratedPower} W rated
          </p>
        </div>
        <div className="flex items-center gap-2">
          {solarNodes.length > 1 && (
            <select
              className="select w-auto text-xs"
              value={nodeId}
              onChange={(e) => setActiveId(e.target.value)}
              aria-label="Select solar node"
            >
              {solarNodes.map((n) => (
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
          {/* ---- live readings ---- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Panel>
              <Metric label="Power" value={fmt(frame.power, 1)} unit="W" accent={CHART_COLORS.solar} />
            </Panel>
            <Panel>
              <Metric label="Voltage" value={fmt(frame.voltage, 2)} unit="V" />
            </Panel>
            <Panel>
              <Metric label="Current" value={fmt(frame.current, 2)} unit="A" />
            </Panel>
            <Panel>
              <Metric label="Temperature" value={fmt(frame.temperature, 1)} unit="°C" />
            </Panel>
            <Panel>
              <Metric label="Irradiance" value={fmt(frame.lux, 0)} unit="lx" />
            </Panel>
            <Panel>
              <Metric
                label="Efficiency"
                value={fmtPercent(efficiency, 0)}
                accent={underperforming ? CHART_COLORS.warning : undefined}
                hint={expected !== null ? `vs ${fmt(expected, 1)} W expected` : 'Night'}
              />
            </Panel>
          </div>

          {/* ---- yield vs expectation ---- */}
          <Panel
            title="Yield against model"
            subtitle="P = V × I, compared with the irradiance and temperature model"
          >
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                <YieldBar
                  label="Measured"
                  value={frame.power}
                  max={Math.max(node.ratedPower, expected ?? 0, frame.power)}
                  color={CHART_COLORS.solar}
                />
                <YieldBar
                  label="Model expectation"
                  value={expected ?? 0}
                  max={Math.max(node.ratedPower, expected ?? 0, frame.power)}
                  color="#475569"
                />
                <YieldBar
                  label="Nameplate rating"
                  value={node.ratedPower}
                  max={Math.max(node.ratedPower, expected ?? 0, frame.power)}
                  color="#334155"
                />
              </div>

              <div className="border-panel-800 md:border-l md:pl-4">
                <p className="metric-label">Model</p>
                <p className="mt-2 font-mono text-2xs leading-relaxed text-slate-500">
                  P = P<sub>rated</sub> × (G / G<sub>ref</sub>) × (1 − β(T<sub>cell</sub> − 25))
                </p>
                <dl className="mt-3 space-y-1.5 text-2xs">
                  <Row k="P_rated" v={`${node.ratedPower} W`} />
                  <Row k="G_ref" v={`${THRESHOLDS.solar.referenceLux.toLocaleString()} lx`} />
                  <Row k="β" v={`${THRESHOLDS.solar.temperatureCoefficient * 100}% / °C`} />
                </dl>
                <p className="mt-3 max-w-[15rem] text-2xs leading-relaxed text-slate-600">
                  A simplified engineering model, not a validated PV characterisation. See
                  shared/physics.ts.
                </p>
              </div>
            </div>
          </Panel>

          {/* ---- maintenance guidance ---- */}
          {underperforming && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-amber-200">
                    Generation is lower than expected for the current irradiance
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-amber-200/70">
                    Measured {fmt(frame.power, 1)} W against a modelled {fmt(expected ?? 0, 1)} W at{' '}
                    {fmt(frame.lux, 0)} lx ({fmtPercent(efficiency, 0)} of expectation).
                  </p>
                  <p className="mt-2.5 text-xs leading-relaxed text-slate-400">
                    <span className="font-medium text-slate-300">Recommended action: </span>
                    Inspect the panel surface for dust or soiling, check for new shading
                    obstructions at the current sun angle, and verify string wiring and connector
                    integrity.
                  </p>
                  <p className="mt-2 text-2xs text-slate-600">
                    This is an inference from the power/irradiance relationship, not a confirmed
                    physical fault. Confirm by inspection before acting.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ---- charts ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <HistoryPanel
              title="Power"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="W"
              series={[{ key: 'power', name: 'Power', color: CHART_COLORS.solar, area: true }]}
            />
            <HistoryPanel
              title="Irradiance"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="lx"
              series={[{ key: 'lux', name: 'Illuminance', color: '#fbbf24', area: true }]}
              referenceLines={[
                {
                  y: THRESHOLDS.solar.daylightLuxThreshold,
                  label: 'daylight threshold',
                },
              ]}
            />
            <HistoryPanel
              title="Voltage and current"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              series={[
                { key: 'voltage', name: 'Voltage (V)', color: CHART_COLORS.primary },
                { key: 'current', name: 'Current (A)', color: '#34d399' },
              ]}
            />
            <HistoryPanel
              title="Cell temperature"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="°C"
              series={[{ key: 'temperature', name: 'Temperature', color: '#f97316', area: true }]}
              referenceLines={[
                { y: THRESHOLDS.solar.temperatureWarning, label: 'warning' },
                {
                  y: THRESHOLDS.solar.temperatureCritical,
                  label: 'critical',
                  color: CHART_COLORS.critical,
                },
              ]}
            />
          </div>

          <p className="text-2xs text-slate-600">
            Last frame {fmtAge(frame.ageMs)} · sequence {frame.sequenceNumber} · source{' '}
            {frame.source}
            {frame.firmwareVersion && ` · firmware ${frame.firmwareVersion}`}
          </p>
        </>
      )}
    </div>
  );
}

function YieldBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-2xs text-slate-500">{label}</span>
        <span className="tabular text-xs font-medium text-slate-200">{fmt(value, 1)} W</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-panel-800">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="font-mono text-slate-600">{k}</dt>
      <dd className="tabular text-slate-400">{v}</dd>
    </div>
  );
}
