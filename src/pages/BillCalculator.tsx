/**
 * Bill Calculator.
 *
 * Energy figures come from real aggregated telemetry for the chosen period;
 * the tariff and impact factors are user-editable ASSUMPTIONS. The page shows
 * the formulas so every number can be checked by hand (spec §27, §28).
 */

import { useEffect, useState } from 'react';
import { Calculator, Download, Info, Loader2 } from 'lucide-react';

import type { Alert, BillingAssumptions, UsageRecord } from '@shared/types';
import type { BillResult } from '@shared/billing';
import { DEFAULT_BILLING } from '@shared/constants';
import { ESTIMATE_DISCLAIMER } from '@shared/billing';
import { CHART_COLORS } from '../components/charts';
import { ErrorState, Metric, Panel, fmt, fmtCurrency, fmtPercent } from '../components/ui';
import { alertsApi, errorMessage, usageApi } from '../lib/api';
import { downloadUsageReport } from '../lib/pdfReport';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';
import { useAppSelector } from '../store';

export default function BillCalculator() {
  const { nodes, snapshot } = useTelemetry();
  const user = useAppSelector((s) => s.auth.user);

  // Default to the last 30 days.
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 86_400_000);

  const [periodStart, setPeriodStart] = useState(monthAgo.toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(today.toISOString().slice(0, 10));
  const [gridImport, setGridImport] = useState<string>('');
  const [assumptions, setAssumptions] = useState<BillingAssumptions>(DEFAULT_BILLING);

  const [result, setResult] = useState<{ record: UsageRecord; bill: BillResult; dataPoints: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Load stored assumptions once, so Settings and this page agree.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('gridsync.assumptions');
      if (raw) setAssumptions({ ...DEFAULT_BILLING, ...JSON.parse(raw) });
    } catch {
      /* fall back to defaults */
    }
  }, []);

  const calculate = async (save = true) => {
    setLoading(true);
    setError(null);
    try {
      const res = await usageApi.generate({
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(`${periodEnd}T23:59:59`).toISOString(),
        gridImportKwh: gridImport === '' ? undefined : Number(gridImport),
        assumptions,
        save,
      });
      setResult({ record: res.record, bill: res.bill, dataPoints: res.dataPoints });
    } catch (err) {
      setError(errorMessage(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const exportPdf = async () => {
    if (!result) return;
    setExporting(true);
    try {
      let alerts: Alert[] = [];
      try {
        const data = await alertsApi.list({
          since: result.record.periodStart,
          until: result.record.periodEnd,
          pageSize: 20,
        });
        alerts = data.items;
      } catch {
        // A report without the alert appendix is still a valid report.
      }

      downloadUsageReport({
        record: result.record,
        bill: result.bill,
        assumptions,
        dataSource: result.record.dataSource,
        nodes: nodes.map((n) => ({ shortName: n.shortName, type: n.type, ratedPower: n.ratedPower })),
        alerts,
        recommendations: buildRecommendations(result),
        generatedBy: user?.email,
      });
    } finally {
      setExporting(false);
    }
  };

  const update = (patch: Partial<BillingAssumptions>) =>
    setAssumptions((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
          <Calculator className="h-5 w-5 text-primary-400" strokeWidth={1.75} />
          Bill Calculator
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Energy figures come from recorded telemetry; costs are estimates from the assumptions you
          set below.
        </p>
      </div>

      {/* ---- estimate disclaimer, stated up front ---- */}
      <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3.5">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-200/80">{ESTIMATE_DISCLAIMER}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        {/* ---- inputs ---- */}
        <div className="space-y-4">
          <Panel title="Billing period">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ps" className="label">From</label>
                <input
                  id="ps"
                  type="date"
                  className="input"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="pe" className="label">To</label>
                <input
                  id="pe"
                  type="date"
                  className="input"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="gi" className="label">
                Grid import (kWh) — optional
              </label>
              <input
                id="gi"
                type="number"
                min={0}
                step="0.01"
                className="input"
                placeholder="Leave blank to estimate from the shortfall"
                value={gridImport}
                onChange={(e) => setGridImport(e.target.value)}
              />
              <p className="mt-1.5 text-2xs leading-relaxed text-slate-600">
                The microgrid does not meter grid import. Enter your meter reading for an accurate
                bill, or leave blank and it will be estimated as consumption minus generation.
              </p>
            </div>

            <button
              onClick={() => void calculate()}
              disabled={loading}
              className="btn btn-primary mt-4 w-full"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Calculate
            </button>
          </Panel>

          <Panel title="Assumptions" subtitle="All user-editable">
            <div className="space-y-3">
              <NumberField
                label={`Tariff (${assumptions.currency}/kWh)`}
                value={assumptions.tariffPerKwh}
                step={0.1}
                onChange={(v) => update({ tariffPerKwh: v })}
              />
              <NumberField
                label={`Fixed charge (${assumptions.currency})`}
                value={assumptions.fixedCharge}
                step={10}
                onChange={(v) => update({ fixedCharge: v })}
              />
              <NumberField
                label="Additional charge rate (fraction)"
                value={assumptions.additionalChargeRate}
                step={0.01}
                onChange={(v) => update({ additionalChargeRate: v })}
                hint="0.05 = 5% levy on energy + fixed"
              />
              <NumberField
                label={`Diesel price (${assumptions.currency}/L)`}
                value={assumptions.dieselPricePerLitre}
                step={1}
                onChange={(v) => update({ dieselPricePerLitre: v })}
              />
              <NumberField
                label="Generator yield (kWh/L)"
                value={assumptions.generatorKwhPerLitre}
                step={0.1}
                onChange={(v) => update({ generatorKwhPerLitre: v })}
                hint="Typical small diesel genset: 3 to 4 kWh per litre"
              />
              <NumberField
                label="Grid emission factor (kg CO₂/kWh)"
                value={assumptions.gridEmissionFactor}
                step={0.01}
                onChange={(v) => update({ gridEmissionFactor: v })}
                hint="Indicative Indian grid average"
              />
            </div>

            <button
              onClick={() => {
                try {
                  localStorage.setItem('gridsync.assumptions', JSON.stringify(assumptions));
                } catch {
                  /* non-fatal */
                }
              }}
              className="btn btn-secondary btn-sm mt-4 w-full"
            >
              Save assumptions
            </button>
          </Panel>
        </div>

        {/* ---- results ---- */}
        <div className="space-y-4">
          {error && <ErrorState message={error} onRetry={() => void calculate()} />}

          {!result && !error && (
            <Panel>
              <div className="py-12 text-center">
                <Calculator className="mx-auto h-7 w-7 text-slate-700" />
                <p className="mt-3 text-sm text-slate-400">No calculation yet</p>
                <p className="mt-1 text-xs text-slate-600">
                  Choose a period and select Calculate.
                </p>
              </div>
            </Panel>
          )}

          {result && (
            <>
              <Panel
                title="Estimated bill"
                subtitle={`${result.dataPoints} data points · ${result.record.dataSource}`}
                actions={
                  <button
                    onClick={() => void exportPdf()}
                    disabled={exporting}
                    className="btn btn-secondary btn-sm"
                  >
                    {exporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Export PDF
                  </button>
                }
              >
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Metric
                    label="Estimated bill"
                    value={fmtCurrency(result.bill.estimatedBill, assumptions.currency)}
                    size="sm"
                  />
                  <Metric
                    label="Estimated saving"
                    value={fmtCurrency(result.bill.estimatedSavings, assumptions.currency)}
                    size="sm"
                    accent={CHART_COLORS.battery}
                  />
                  <Metric
                    label="CO₂ avoided"
                    value={fmt(result.bill.estimatedCo2AvoidedKg, 1)}
                    unit="kg"
                    size="sm"
                  />
                  <Metric
                    label="Self-sufficiency"
                    value={fmtPercent(result.bill.selfSufficiency, 1)}
                    size="sm"
                  />
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-panel-800 pt-4 sm:grid-cols-4">
                  <Metric
                    label="Generated"
                    value={fmt(result.record.energyGeneratedKwh, 2)}
                    unit="kWh"
                    size="sm"
                    accent={CHART_COLORS.solar}
                  />
                  <Metric
                    label="Consumed"
                    value={fmt(result.record.energyConsumedKwh, 2)}
                    unit="kWh"
                    size="sm"
                    accent={CHART_COLORS.ac}
                  />
                  <Metric
                    label="Grid import"
                    value={fmt(result.record.gridImportKwh, 2)}
                    unit="kWh"
                    size="sm"
                  />
                  <Metric
                    label="Daily average"
                    value={fmt(result.record.averageDailyKwh, 2)}
                    unit="kWh"
                    size="sm"
                  />
                </div>
              </Panel>

              {/* ---- comparison ---- */}
              <Panel title="Comparison" subtitle="Estimated cost under each supply option">
                <div className="space-y-3">
                  <CompareBar
                    label="With microgrid (estimated)"
                    value={result.bill.estimatedBill}
                    max={Math.max(result.bill.billWithoutMicrogrid, result.bill.estimatedBill, 1)}
                    currency={assumptions.currency}
                    color={CHART_COLORS.battery}
                  />
                  <CompareBar
                    label="Fully grid-supplied (estimated)"
                    value={result.bill.billWithoutMicrogrid}
                    max={Math.max(result.bill.billWithoutMicrogrid, result.bill.estimatedBill, 1)}
                    currency={assumptions.currency}
                    color={CHART_COLORS.ac}
                  />
                  <CompareBar
                    label="Diesel-equivalent for the renewable share"
                    value={result.bill.dieselEquivalentCost}
                    max={Math.max(
                      result.bill.billWithoutMicrogrid,
                      result.bill.dieselEquivalentCost,
                      1,
                    )}
                    currency={assumptions.currency}
                    color={CHART_COLORS.warning}
                  />
                </div>
                <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
                  The diesel comparison prices the renewable energy actually consumed at the cost of
                  generating it with a genset at the assumed yield. It is a hypothetical, not an
                  avoided expenditure that was measured.
                </p>
              </Panel>

              {/* ---- formulas ---- */}
              <Panel title="Calculation" subtitle="Every figure, shown as arithmetic">
                <dl className="space-y-3">
                  {result.bill.formulas.map((f) => (
                    <div key={f.label} className="border-l-2 border-panel-700 pl-3">
                      <dt className="text-xs font-medium text-slate-300">{f.label}</dt>
                      <dd className="mt-0.5 font-mono text-2xs text-slate-600">{f.expression}</dd>
                      <dd className="mt-1 font-mono text-2xs text-slate-400">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            </>
          )}

          {snapshot?.mode === 'SIMULATION' && (
            <p className="rounded border border-panel-700 bg-panel-850 p-3 text-2xs leading-relaxed text-slate-500">
              The telemetry behind these figures was produced by the GridSync simulator. Any report
              exported from this page is watermarked DEMO / SIMULATION.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        min={0}
        className="input"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
      />
      {hint && <p className="mt-1 text-2xs text-slate-600">{hint}</p>}
    </div>
  );
}

function CompareBar({
  label,
  value,
  max,
  currency,
  color,
}: {
  label: string;
  value: number;
  max: number;
  currency: string;
  color: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="tabular text-xs font-medium text-slate-100">
          {fmtCurrency(value, currency)}
        </span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-panel-800">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/** Recommendations embedded in the exported PDF, derived from the result. */
function buildRecommendations(result: { record: UsageRecord; bill: BillResult }): string[] {
  const out: string[] = [];

  if (result.bill.selfSufficiency < 0.5) {
    out.push(
      `Self-sufficiency was ${(result.bill.selfSufficiency * 100).toFixed(1)}%. Shifting deferrable load into the generation window would reduce grid import.`,
    );
  }
  if (result.record.peakDemandW > result.record.averageDailyKwh * 1000) {
    out.push(
      `Peak demand reached ${result.record.peakDemandW.toFixed(0)} W. Staggering high-power appliances would reduce peak stress on the inverter and storage.`,
    );
  }
  if (result.record.energyGeneratedKwh < result.record.energyConsumedKwh * 0.5) {
    out.push(
      'Generation met less than half of consumption over this period. Verify array performance and consider whether additional capacity is warranted.',
    );
  }
  if (out.length === 0) {
    out.push('No specific optimization opportunities were identified from this period.');
  }

  out.push(
    'All cost and emissions figures in this report are estimates derived from the stated assumptions and are not measured results.',
  );
  return out;
}
