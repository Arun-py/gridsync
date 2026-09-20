/**
 * BETA Battery Node.
 *
 * The key diagnostic shown here is terminal voltage against the open-circuit
 * voltage the state of charge implies. When those separate at low current, the
 * pack is misbehaving — that is the signal a plain voltage threshold misses.
 *
 * NOTE ON "BATTERY HEALTH" (spec §17): this page does NOT display a state-of-
 * health percentage. A credible SoH figure requires capacity testing over many
 * cycles against a known reference, which this system has not performed.
 * Showing an invented number would be exactly the fabricated claim the brief
 * forbids. What is shown instead are the measured quantities SoH would be
 * derived from, plus an explicit note about what is missing.
 */

import { useState } from 'react';
import { Battery, BatteryCharging, Info, TrendingDown } from 'lucide-react';

import type { TimeRange } from '@shared/types';
import { THRESHOLDS } from '@shared/constants';
import { socToOpenCircuitVoltage } from '@shared/physics';
import { CHART_COLORS, LevelMeter } from '../components/charts';
import { HistoryPanel, RangeSelector, useNodeHistory } from '../components/NodeHistory';
import { EmptyState, Metric, NodeStatusBadge, Panel, fmt, fmtAge } from '../components/ui';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

export default function BatteryNode() {
  const { frames, nodes } = useTelemetry();
  const [range, setRange] = useState<TimeRange>('6H');

  const batteryNodes = nodes.filter((n) => n.type === 'BATTERY');
  const [activeId, setActiveId] = useState<string | null>(null);
  const nodeId = activeId ?? batteryNodes[0]?.id ?? 'beta';

  const node = nodes.find((n) => n.id === nodeId);
  const frame = frames.find((f) => f.nodeId === nodeId);

  const { data, loading, error, reload } = useNodeHistory(nodeId, range);

  if (!node) {
    return (
      <Panel title="Battery">
        <EmptyState
          icon={<Battery className="h-6 w-6" />}
          title="No battery node configured"
          description="The node catalogue contains no BATTERY node."
        />
      </Panel>
    );
  }

  const soc = frame?.soc ?? null;
  const expectedOcv = soc !== null ? socToOpenCircuitVoltage(soc) : null;
  // Only meaningful near rest: under load, IR drop legitimately separates them.
  const atRest = frame ? Math.abs(frame.current) <= 3 : false;
  const deviation = frame && expectedOcv !== null ? frame.voltage - expectedOcv : null;
  const voltageAnomaly = atRest && deviation !== null && Math.abs(deviation) > 0.45;

  const charging = frame?.batteryState === 'CHARGING';
  const overTemp =
    frame?.temperature !== undefined && frame.temperature > THRESHOLDS.battery.temperatureWarning;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
            {charging ? (
              <BatteryCharging className="h-5 w-5" style={{ color: CHART_COLORS.battery }} strokeWidth={1.75} />
            ) : (
              <Battery className="h-5 w-5" style={{ color: CHART_COLORS.battery }} strokeWidth={1.75} />
            )}
            {node.shortName}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {node.description} · {node.capacityAh ?? '—'} Ah @ {node.nominalVoltage} V
          </p>
        </div>
        <div className="flex items-center gap-2">
          {batteryNodes.length > 1 && (
            <select
              className="select w-auto text-xs"
              value={nodeId}
              onChange={(e) => setActiveId(e.target.value)}
              aria-label="Select battery node"
            >
              {batteryNodes.map((n) => (
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
          <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
            <Panel title="State of charge">
              <LevelMeter
                value={soc}
                label="SOC"
                thresholds={{
                  critical: THRESHOLDS.battery.socCritical,
                  warning: THRESHOLDS.battery.socWarning,
                }}
                sublabel={
                  soc === null
                    ? undefined
                    : `Warning below ${THRESHOLDS.battery.socWarning}%, critical below ${THRESHOLDS.battery.socCritical}%`
                }
              />

              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-panel-800 pt-4">
                <Metric
                  label="State"
                  value={
                    <span
                      style={{
                        color:
                          frame.batteryState === 'CHARGING'
                            ? CHART_COLORS.battery
                            : frame.batteryState === 'DISCHARGING'
                              ? CHART_COLORS.warning
                              : undefined,
                      }}
                    >
                      {frame.batteryState ?? '—'}
                    </span>
                  }
                  size="sm"
                />
                <Metric
                  label="Power"
                  value={`${frame.power >= 0 ? '+' : ''}${fmt(frame.power, 1)}`}
                  unit="W"
                  size="sm"
                />
                <Metric label="Voltage" value={fmt(frame.voltage, 3)} unit="V" size="sm" />
                <Metric
                  label="Current"
                  value={`${frame.current >= 0 ? '+' : ''}${fmt(frame.current, 2)}`}
                  unit="A"
                  size="sm"
                />
                <Metric
                  label="Temperature"
                  value={fmt(frame.temperature, 1)}
                  unit="°C"
                  size="sm"
                  accent={overTemp ? CHART_COLORS.warning : undefined}
                />
                <Metric
                  label="Capacity"
                  value={node.capacityAh ?? '—'}
                  unit="Ah"
                  size="sm"
                />
              </div>

              <p className="mt-3 text-2xs text-slate-600">
                Positive current charges the bank. Updated {fmtAge(frame.ageMs)}.
              </p>
            </Panel>

            {/* ---- voltage vs SOC diagnostic ---- */}
            <Panel
              title="Terminal voltage against state of charge"
              subtitle="The primary battery-fault diagnostic"
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <Metric label="Measured" value={fmt(frame.voltage, 3)} unit="V" size="sm" />
                <Metric
                  label="Expected (OCV)"
                  value={expectedOcv === null ? '—' : fmt(expectedOcv, 3)}
                  unit="V"
                  size="sm"
                  hint={soc === null ? undefined : `at ${fmt(soc, 0)}% SOC`}
                />
                <Metric
                  label="Deviation"
                  value={
                    deviation === null ? '—' : `${deviation >= 0 ? '+' : ''}${fmt(deviation, 3)}`
                  }
                  unit="V"
                  size="sm"
                  accent={voltageAnomaly ? CHART_COLORS.critical : undefined}
                />
              </div>

              {!atRest && (
                <p className="mt-4 flex items-start gap-2 rounded border border-panel-700 bg-panel-850 p-3 text-2xs leading-relaxed text-slate-500">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Current is {fmt(Math.abs(frame.current), 1)} A. Under significant current, IR drop
                  legitimately separates terminal voltage from open-circuit voltage, so this
                  comparison is only diagnostic near rest (below 3 A).
                </p>
              )}

              {voltageAnomaly && (
                <div className="mt-4 rounded border border-red-500/30 bg-red-500/5 p-3">
                  <p className="text-xs font-medium text-red-200">
                    Terminal voltage has decoupled from state of charge
                  </p>
                  <p className="mt-1.5 text-2xs leading-relaxed text-red-200/70">
                    Reading {fmt(frame.voltage, 2)} V at {fmt(soc ?? 0, 0)}% SOC where roughly{' '}
                    {fmt(expectedOcv ?? 0, 2)} V is expected. Consistent with a failing cell,
                    sulfation, or elevated internal resistance.
                  </p>
                  <p className="mt-2 text-2xs leading-relaxed text-slate-400">
                    <span className="font-medium text-slate-300">Recommended action: </span>
                    Perform a rested open-circuit voltage measurement per block and a capacity
                    discharge test to identify a weak cell.
                  </p>
                </div>
              )}

              {/* Honest absence of a state-of-health number. */}
              <div className="mt-4 rounded border border-panel-700 bg-panel-850 p-3">
                <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                  <TrendingDown className="h-3 w-3" />
                  State of health
                </p>
                <p className="mt-1.5 text-2xs leading-relaxed text-slate-500">
                  Not reported. A credible state-of-health figure requires capacity testing across
                  many cycles against a known reference, which this system has not performed.
                  The measured quantities it would be derived from — SOC, terminal voltage,
                  temperature and charge/discharge behaviour — are shown above and charted below.
                </p>
              </div>
            </Panel>
          </div>

          {/* ---- charts ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <HistoryPanel
              title="State of charge"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="%"
              yDomain={[0, 100]}
              series={[{ key: 'soc', name: 'SOC', color: CHART_COLORS.battery, area: true }]}
              referenceLines={[
                { y: THRESHOLDS.battery.socWarning, label: 'warning' },
                {
                  y: THRESHOLDS.battery.socCritical,
                  label: 'critical',
                  color: CHART_COLORS.critical,
                },
              ]}
            />
            <HistoryPanel
              title="Terminal voltage"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="V"
              series={[{ key: 'voltage', name: 'Voltage', color: CHART_COLORS.primary }]}
              referenceLines={[
                { y: THRESHOLDS.battery.voltageMin, label: 'min' },
                { y: THRESHOLDS.battery.overchargeVoltage, label: 'overcharge', color: CHART_COLORS.critical },
              ]}
            />
            <HistoryPanel
              title="Charge / discharge current"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="A"
              series={[{ key: 'current', name: 'Current', color: '#34d399' }]}
              referenceLines={[{ y: 0, label: 'idle', color: '#475569' }]}
            />
            <HistoryPanel
              title="Pack temperature"
              data={data}
              loading={loading}
              error={error}
              onReload={reload}
              unit="°C"
              series={[{ key: 'temperature', name: 'Temperature', color: '#f97316', area: true }]}
              referenceLines={[
                { y: THRESHOLDS.battery.temperatureWarning, label: 'warning' },
                {
                  y: THRESHOLDS.battery.temperatureCritical,
                  label: 'critical',
                  color: CHART_COLORS.critical,
                },
              ]}
            />
          </div>

          <HistoryPanel
            title="Charge / discharge power"
            subtitle="Positive charges the bank, negative discharges it"
            data={data}
            loading={loading}
            error={error}
            onReload={reload}
            unit="W"
            height={180}
            series={[
              { key: 'power', name: 'Power', color: CHART_COLORS.battery, area: true },
            ]}
            referenceLines={[{ y: 0, label: 'idle', color: '#475569' }]}
          />
        </>
      )}
    </div>
  );
}
