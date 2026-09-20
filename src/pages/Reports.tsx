/**
 * Usage Reports — previously generated reports, re-exportable as PDF.
 *
 * Every stored record keeps the assumptions it was computed with, so
 * re-exporting an old report reproduces the original figures rather than
 * silently recomputing them against today's tariff.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, Loader2, RefreshCw } from 'lucide-react';

import type { UsageRecord } from '@shared/types';
import { calculateBill } from '@shared/billing';
import { EmptyState, ErrorState, LoadingState, Panel, fmt, fmtCurrency, fmtDateTime } from '../components/ui';
import { alertsApi, errorMessage, usageApi } from '../lib/api';
import { downloadUsageReport } from '../lib/pdfReport';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';
import { useAppSelector } from '../store';

export default function Reports() {
  const { nodes } = useTelemetry();
  const user = useAppSelector((s) => s.auth.user);

  const [items, setItems] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    usageApi
      .list()
      .then((data) => {
        setItems(data.items);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const exportRecord = async (record: UsageRecord) => {
    setExportingId(record.id);
    try {
      // Recompute the bill from the record's OWN stored assumptions so the
      // exported PDF matches what was originally calculated.
      const bill = calculateBill({
        gridImportKwh: record.gridImportKwh,
        solarGeneratedKwh: record.energyGeneratedKwh,
        batteryDischargedKwh: 0,
        totalConsumedKwh: record.energyConsumedKwh,
        periodDays: Math.max(
          1,
          (new Date(record.periodEnd).getTime() - new Date(record.periodStart).getTime()) /
            86_400_000,
        ),
        assumptions: record.assumptions,
      });

      let alerts: Awaited<ReturnType<typeof alertsApi.list>>['items'] = [];
      try {
        const data = await alertsApi.list({
          since: record.periodStart,
          until: record.periodEnd,
          pageSize: 20,
        });
        alerts = data.items;
      } catch {
        /* the appendix is optional */
      }

      downloadUsageReport({
        record,
        bill,
        assumptions: record.assumptions,
        dataSource: record.dataSource,
        nodes: nodes.map((n) => ({
          shortName: n.shortName,
          type: n.type,
          ratedPower: n.ratedPower,
        })),
        alerts,
        generatedBy: user?.email,
      });
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-50">
            <FileText className="h-5 w-5 text-primary-400" strokeWidth={1.75} />
            Usage Reports
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Reports you have generated. Each keeps the assumptions it was calculated with.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn btn-secondary btn-sm">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link to="/app/bill" className="btn btn-primary btn-sm">
            New report
          </Link>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <Panel><LoadingState /></Panel>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="No reports yet"
            description="Generate one from the Bill Calculator."
            action={
              <Link to="/app/bill" className="btn btn-secondary btn-sm">
                Open Bill Calculator
              </Link>
            }
          />
        </Panel>
      ) : (
        <Panel bodyClassName="">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Source</th>
                  <th className="text-right">Generated</th>
                  <th className="text-right">Consumed</th>
                  <th className="text-right">Peak</th>
                  <th className="text-right">Est. cost</th>
                  <th className="text-right">Est. saving</th>
                  <th className="text-right">Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((record) => (
                  <tr key={record.id}>
                    <td className="whitespace-nowrap text-xs">
                      {new Date(record.periodStart).toLocaleDateString()} —{' '}
                      {new Date(record.periodEnd).toLocaleDateString()}
                    </td>
                    <td>
                      <span
                        className={`badge ${record.dataSource === 'SIMULATION' ? 'badge-warning' : 'badge-ok'}`}
                      >
                        {record.dataSource === 'SIMULATION' ? 'Demo' : 'Realtime'}
                      </span>
                    </td>
                    <td className="tabular text-right">{fmt(record.energyGeneratedKwh, 2)} kWh</td>
                    <td className="tabular text-right">{fmt(record.energyConsumedKwh, 2)} kWh</td>
                    <td className="tabular text-right">{fmt(record.peakDemandW, 0)} W</td>
                    <td className="tabular text-right">
                      {fmtCurrency(record.estimatedCost, record.assumptions.currency)}
                    </td>
                    <td className="tabular text-right text-emerald-400">
                      {fmtCurrency(record.estimatedSavings, record.assumptions.currency)}
                    </td>
                    <td className="whitespace-nowrap text-right text-xs text-slate-500">
                      {fmtDateTime(record.createdAt)}
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => void exportRecord(record)}
                        disabled={exportingId === record.id}
                        className="btn btn-ghost btn-sm"
                        aria-label="Export this report as PDF"
                      >
                        {exportingId === record.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="px-4 pb-4 pt-3 text-2xs leading-relaxed text-slate-600">
            Cost and saving figures are estimates derived from each report's stored assumptions.
            Reports marked Demo were produced from simulated telemetry and are watermarked
            accordingly when exported.
          </p>
        </Panel>
      )}
    </div>
  );
}
