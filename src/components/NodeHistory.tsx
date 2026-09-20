/**
 * Historical chart block with a range selector.
 *
 * Shared by the solar, battery and load pages so range handling, loading,
 * errors and empty states behave identically everywhere.
 *
 * History comes from the DATABASE via the API — not from whatever the browser
 * happens to have accumulated since the tab opened (spec §35).
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import type { TimeRange } from '@shared/types';
import { TimeSeriesChart, type SeriesDef } from './charts';
import { ErrorState, LoadingState, Panel } from './ui';
import { errorMessage, telemetryApi } from '../lib/api';

const RANGES: TimeRange[] = ['1H', '6H', '24H', '7D', '30D'];

export interface HistorySeriesRow extends Record<string, unknown> {
  timestamp: string;
  voltage: number;
  current: number;
  power: number;
  temperature?: number;
  lux?: number;
  soc?: number;
  valid: boolean;
}

export function useNodeHistory(nodeId: string, range: TimeRange, maxPoints = 300) {
  const [data, setData] = useState<HistorySeriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    telemetryApi
      .history(nodeId, range, maxPoints)
      .then((res) => {
        if (!cancelled) setData(res.series as HistorySeriesRow[]);
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
  }, [nodeId, range, maxPoints]);

  useEffect(() => load(), [load]);

  return { data, loading, error, reload: load };
}

export function RangeSelector({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (r: TimeRange) => void;
}) {
  return (
    <div className="flex rounded border border-panel-600 p-0.5" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          className={`rounded px-2 py-1 text-2xs font-medium transition-colors ${
            value === r ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

export function HistoryPanel({
  title,
  subtitle,
  data,
  loading,
  error,
  onReload,
  series,
  unit,
  height = 200,
  referenceLines,
  yDomain,
}: {
  title: string;
  subtitle?: string;
  data: HistorySeriesRow[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  series: SeriesDef[];
  unit?: string;
  height?: number;
  referenceLines?: Array<{ y: number; label: string; color?: string }>;
  yDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
}) {
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      actions={
        <button onClick={onReload} className="btn btn-ghost p-1.5" aria-label={`Reload ${title}`}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      {loading && data.length === 0 ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={onReload} />
      ) : (
        <TimeSeriesChart
          data={data}
          series={series}
          unit={unit}
          height={height}
          referenceLines={referenceLines}
          yDomain={yDomain}
        />
      )}
    </Panel>
  );
}
