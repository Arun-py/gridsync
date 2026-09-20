/**
 * Analytics and Optimization.
 *
 * All aggregation happens server-side (see api/analytics.ts). The browser
 * receives at most a few hundred buckets regardless of the range selected —
 * a 30-day window is ~2.6 M raw documents and must never reach the client.
 *
 * The optimization recommendations at the bottom are derived from the data
 * actually present in the window, and each one states WHY (spec §26).
 */

import { useEffect, useState } from 'react';
import { Lightbulb, RefreshCw, TrendingUp } from 'lucide-react';

import type { AnalyticsResponse, TimeRange } from '@shared/types';
import { THRESHOLDS } from '@shared/constants';
import { CHART_COLORS, StackedBarChart, TimeSeriesChart } from '../components/charts';
import { RangeSelector } from '../components/NodeHistory';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  fmt,
  fmtPercent,
} from '../components/ui';
import { errorMessage, intelligenceApi } from '../lib/api';

export default function Analytics() {
  const [range, setRange] = useState<TimeRange>('24H');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    intelligenceApi
      .analytics(range)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  if (loading && !data) return <LoadingState label="Aggregating telemetry" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const hasData = data.buckets.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">
            Analytics &amp; Optimization
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {data.buckets.length} buckets over {range} ·{' '}
            {Math.round(data.bucketMs / 60_000)} min resolution
            {data.dataSource === 'SIMULATION' && ' · simulated data'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelector value={range} onChange={setRange} />
          <button onClick={load} className="btn btn-secondary btn-sm">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {!hasData ? (
        <Panel>
          <EmptyState
            title="No data for this period"
            description="Nothing has been recorded in this window yet. Start the simulator with: npm run worker"
          />
        </Panel>
      ) : (
        <>
          {/* ---- totals ---- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Panel>
              <Metric
                label="Generated"
                value={fmt(data.totals.generatedKwh, 2)}
                unit="kWh"
                accent={CHART_COLORS.solar}
              />
            </Panel>
            <Panel>
              <Metric
                label="Consumed"
                value={fmt(data.totals.consumedKwh, 2)}
                unit="kWh"
                accent={CHART_COLORS.ac}
              />
            </Panel>
            <Panel>
              <Metric
                label="Losses"
                value={fmt(data.totals.lossesKwh, 2)}
                unit="kWh"
                hint="Generation − delivered load"
              />
            </Panel>
            <Panel>
              <Metric label="Peak demand" value={fmt(data.totals.peakDemandW, 0)} unit="W" />
            </Panel>
            <Panel>
              <Metric
                label="Avg efficiency"
                value={fmtPercent(data.totals.averageEfficiency, 1)}
              />
            </Panel>
          </div>

          {/* ---- generation vs consumption ---- */}
          <Panel
            title="Generation against consumption"
            subtitle="Bucket averages across the selected window"
          >
            <TimeSeriesChart
              data={data.buckets}
              height={280}
              unit="W"
              series={[
                { key: 'generationW', name: 'Generation', color: CHART_COLORS.solar, area: true },
                { key: 'consumptionW', name: 'Consumption', color: CHART_COLORS.ac, area: true },
              ]}
            />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Energy balance" subtitle="Positive = surplus available to store">
              <TimeSeriesChart
                data={data.buckets}
                height={200}
                unit="W"
                showLegend={false}
                series={[{ key: 'netPowerW', name: 'Net power', color: CHART_COLORS.primary, area: true }]}
                referenceLines={[{ y: 0, label: 'balanced', color: '#475569' }]}
              />
            </Panel>

            <Panel title="Battery state of charge">
              <TimeSeriesChart
                data={data.buckets}
                height={200}
                unit="%"
                showLegend={false}
                yDomain={[0, 100]}
                series={[{ key: 'batterySoc', name: 'SOC', color: CHART_COLORS.battery, area: true }]}
                referenceLines={[
                  { y: THRESHOLDS.battery.socWarning, label: 'warning' },
                  {
                    y: THRESHOLDS.battery.socCritical,
                    label: 'critical',
                    color: CHART_COLORS.critical,
                  },
                ]}
              />
            </Panel>

            <Panel title="Load split" subtitle="AC against DC branches">
              <TimeSeriesChart
                data={data.buckets}
                height={200}
                unit="W"
                series={[
                  { key: 'acLoadW', name: 'AC', color: CHART_COLORS.ac, area: true },
                  { key: 'dcLoadW', name: 'DC', color: CHART_COLORS.dc, area: true },
                ]}
              />
            </Panel>

            <Panel title="Efficiency trend" subtitle="Delivered load ÷ available generation">
              <TimeSeriesChart
                data={data.buckets.filter((b) => b.efficiency !== null)}
                height={200}
                showLegend={false}
                yDomain={[0, 1]}
                series={[{ key: 'efficiency', name: 'Efficiency', color: '#34d399', area: true }]}
                emptyMessage="No generation in this window, so efficiency is undefined."
              />
            </Panel>
          </div>

          {/* ---- alert + anomaly frequency ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Alert frequency" subtitle="Alerts raised per bucket">
              {data.alertFrequency.length === 0 ? (
                <EmptyState title="No alerts" description="Nothing was raised in this window." />
              ) : (
                <StackedBarChart
                  data={data.alertFrequency}
                  height={200}
                  series={[
                    { key: 'critical', name: 'Critical', color: CHART_COLORS.critical },
                    { key: 'warning', name: 'Warning', color: CHART_COLORS.warning },
                    { key: 'info', name: 'Info', color: CHART_COLORS.info },
                  ]}
                />
              )}
            </Panel>

            <Panel
              title="Anomaly frequency"
              subtitle="Non-normal model predictions per bucket"
            >
              {data.anomalyFrequency.length === 0 ? (
                <EmptyState
                  title="No anomalies"
                  description="The model predicted NORMAL throughout this window, or no model is loaded."
                />
              ) : (
                <StackedBarChart
                  data={data.anomalyFrequency}
                  height={200}
                  series={[{ key: 'count', name: 'Predicted anomalies', color: '#a78bfa' }]}
                />
              )}
            </Panel>
          </div>

          {/* ---- per-node ---- */}
          <Panel title="Node performance" bodyClassName="">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th className="text-right">Energy</th>
                    <th className="text-right">Data availability</th>
                    <th>Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {data.nodePerformance.map((n) => (
                    <tr key={n.nodeId}>
                      <td className="font-medium text-slate-200">{n.name}</td>
                      <td className="tabular text-right">{fmt(n.energyKwh, 3)} kWh</td>
                      <td className="tabular text-right">{fmtPercent(n.availability, 1)}</td>
                      <td>
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-panel-800">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${n.availability * 100}%`,
                              backgroundColor:
                                n.availability > 0.95
                                  ? CHART_COLORS.battery
                                  : n.availability > 0.8
                                    ? CHART_COLORS.warning
                                    : CHART_COLORS.critical,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 pb-4 pt-3 text-2xs leading-relaxed text-slate-600">
              Availability is the fraction of returned samples that passed validation. Energy is
              integrated from down-sampled readings and is an estimate, not a meter reading.
            </p>
          </Panel>

          {/* ---- optimization ---- */}
          <OptimizationPanel data={data} />
        </>
      )}
    </div>
  );
}

/**
 * Optimization engine.
 *
 * Recommendations are DERIVED from the window's actual data and each states its
 * reasoning. Nothing here claims to have changed the system — GridSync has no
 * control path in this release.
 */
function OptimizationPanel({ data }: { data: AnalyticsResponse }) {
  const recommendations: Array<{ title: string; why: string; action: string; severity: 'info' | 'warning' }> = [];

  const buckets = data.buckets;
  const withSoc = buckets.filter((b) => b.batterySoc !== null);

  // --- deep discharge risk ---
  const minSoc = withSoc.length ? Math.min(...withSoc.map((b) => b.batterySoc as number)) : null;
  if (minSoc !== null && minSoc < THRESHOLDS.battery.socWarning) {
    recommendations.push({
      title: 'Reduce battery deep-discharge risk',
      why: `State of charge reached ${fmt(minSoc, 1)}% during this window, below the ${THRESHOLDS.battery.socWarning}% warning threshold. Sustained operation in this region accelerates capacity loss in a lead-acid bank.`,
      action:
        'Shift deferrable load into the generation window, or reduce the non-critical branch during the evening peak.',
      severity: minSoc < THRESHOLDS.battery.socCritical ? 'warning' : 'info',
    });
  }

  // --- deficit fraction ---
  const deficitBuckets = buckets.filter((b) => b.netPowerW < 0).length;
  const deficitFraction = buckets.length ? deficitBuckets / buckets.length : 0;
  if (deficitFraction > 0.55) {
    recommendations.push({
      title: 'Demand exceeds generation for most of the period',
      why: `${(deficitFraction * 100).toFixed(0)}% of buckets showed consumption above generation. Storage is carrying the shortfall, which limits autonomy.`,
      action:
        'Compare the load schedule against the generation window, and consider additional generation capacity if the pattern persists across days.',
      severity: 'warning',
    });
  }

  // --- efficiency ---
  if (data.totals.averageEfficiency !== null && data.totals.averageEfficiency < 0.6) {
    recommendations.push({
      title: 'A large share of generation is not reaching load',
      why: `Average efficiency was ${fmtPercent(data.totals.averageEfficiency, 1)}, with ${fmt(data.totals.lossesKwh, 2)} kWh unaccounted between generation and delivered load. Some of this is normal storage round-trip and conversion loss.`,
      action:
        'Review inverter and charge-controller behaviour, and check whether generation is being curtailed when the battery is full.',
      severity: 'info',
    });
  }

  // --- peak demand ---
  const avgConsumption = buckets.length
    ? buckets.reduce((s, b) => s + b.consumptionW, 0) / buckets.length
    : 0;
  if (avgConsumption > 0 && data.totals.peakDemandW > avgConsumption * 2.2) {
    recommendations.push({
      title: 'Demand is strongly peaked',
      why: `Peak demand of ${fmt(data.totals.peakDemandW, 0)} W is ${(data.totals.peakDemandW / avgConsumption).toFixed(1)}× the average of ${fmt(avgConsumption, 0)} W. Peaks size the inverter and drive the deepest discharges.`,
      action:
        'Stagger high-power appliances so they do not coincide, and move flexible load away from the evening peak.',
      severity: 'info',
    });
  }

  // --- data quality ---
  const poorNodes = data.nodePerformance.filter((n) => n.availability < 0.9);
  if (poorNodes.length > 0) {
    recommendations.push({
      title: 'Investigate telemetry quality',
      why: `${poorNodes.map((n) => n.name).join(', ')} returned below 90% valid samples. Gaps and invalid readings reduce confidence in every figure derived from them.`,
      action:
        'Check link quality and sensor wiring for the affected nodes. Distinguish missing frames (communication) from implausible values (sensor).',
      severity: 'warning',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: 'No optimization opportunities identified',
      why: 'Energy balance, storage depth, efficiency and data quality were all within their normal ranges across this window.',
      action: 'Continue routine monitoring.',
      severity: 'info',
    });
  }

  return (
    <Panel
      title="Optimization recommendations"
      subtitle="Derived from the data in the selected window"
      actions={<TrendingUp className="h-4 w-4 text-slate-500" />}
    >
      <ul className="space-y-3">
        {recommendations.map((rec) => (
          <li
            key={rec.title}
            className={`rounded border p-3.5 ${
              rec.severity === 'warning'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-panel-700 bg-panel-850'
            }`}
          >
            <div className="flex items-start gap-3">
              <Lightbulb
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  rec.severity === 'warning' ? 'text-amber-400' : 'text-slate-500'
                }`}
              />
              <div>
                <p className="text-sm font-medium text-slate-200">{rec.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  <span className="text-slate-400">Why: </span>
                  {rec.why}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  <span className="font-medium text-slate-300">Recommended action: </span>
                  {rec.action}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
        These are recommendations for an operator to carry out. GridSync has no automated control
        path in this release and has not changed the system.
      </p>
    </Panel>
  );
}
