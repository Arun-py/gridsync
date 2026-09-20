/**
 * Chart primitives.
 *
 * Wraps Recharts with the control-room palette so every chart in the product
 * looks like it belongs to the same instrument. Domain colours are fixed per
 * subsystem (solar amber, battery green, AC cyan, DC violet) and never reused
 * decoratively.
 */

import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useTheme } from '../store';
import { EmptyState } from './ui';

export const CHART_COLORS = {
  solar: '#f5a524',
  battery: '#22c55e',
  ac: '#38bdf8',
  dc: '#a78bfa',
  primary: '#0ea5e9',
  neutral: '#64748b',
  warning: '#f59e0b',
  critical: '#ef4444',
  info: '#38bdf8',
} as const;

/**
 * Neutral chart chrome (axes, gridlines, cursor) isn't Tailwind-class-driven —
 * Recharts takes raw colour strings as props — so it needs its own light/dark
 * pair, kept in step with the panel/slate CSS variable tokens in index.css.
 */
const CHART_NEUTRALS = {
  dark: { axis: '#334155', grid: '#1e2531', legend: '#94a3b8', cursor: '#334155', tooltipCursorFill: 'rgba(148,163,184,0.06)', refLabel: '#64748b' },
  light: { axis: '#64748b', grid: '#e2e8f0', legend: '#475569', cursor: '#94a3b8', tooltipCursorFill: 'rgba(100,116,139,0.08)', refLabel: '#64748b' },
} as const;

function useChartNeutrals() {
  const theme = useTheme();
  return CHART_NEUTRALS[theme];
}

/** Time formatter that adapts to the span being displayed. */
function timeTick(value: string, spanMs: number): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // Beyond a day, the clock time alone is ambiguous.
  if (spanMs > 36 * 3600_000) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;

  const when = typeof label === 'string' ? new Date(label) : null;
  const heading =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : String(label ?? '');

  return (
    <div className="rounded border border-panel-600 bg-panel-850 px-3 py-2 shadow-lg shadow-black/40">
      <p className="text-2xs text-slate-500">{heading}</p>
      <div className="mt-1.5 space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: entry.color }} />
            <span className="text-slate-400">{entry.name}</span>
            <span className="ml-auto tabular font-medium text-slate-100">
              {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
  /** Render as a filled area rather than a line. */
  area?: boolean;
  strokeDasharray?: string;
}

/**
 * A chart row.
 *
 * Deliberately `object` rather than `Record<string, unknown>`: a plain
 * interface such as `AnalyticsBucket` has no index signature and so does not
 * satisfy the Record form, which would force every caller to cast. Series are
 * addressed by `key` at runtime, and Recharts reads them dynamically anyway.
 */
export type ChartRow = object;

export function TimeSeriesChart({
  data,
  series,
  unit,
  height = 240,
  yDomain,
  referenceLines = [],
  showLegend = true,
  emptyMessage = 'No data for this period yet.',
}: {
  data: readonly ChartRow[];
  series: SeriesDef[];
  unit?: string;
  height?: number;
  yDomain?: [number | 'auto' | 'dataMin', number | 'auto' | 'dataMax'];
  referenceLines?: Array<{ y: number; label: string; color?: string }>;
  showLegend?: boolean;
  emptyMessage?: string;
}) {
  const neutrals = useChartNeutrals();
  const AXIS = { stroke: neutrals.axis, fontSize: 11, tickLine: false, axisLine: false } as const;

  if (!data || data.length === 0) {
    return <EmptyState title="No data" description={emptyMessage} />;
  }

  const rows = data as Array<Record<string, unknown>>;
  const first = rows[0]?.timestamp as string | undefined;
  const last = rows[rows.length - 1]?.timestamp as string | undefined;
  const spanMs =
    first && last ? new Date(last).getTime() - new Date(first).getTime() : 3600_000;

  const hasArea = series.some((s) => s.area);
  const Chart = hasArea ? AreaChart : LineChart;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <defs>
          {series
            .filter((s) => s.area)
            .map((s) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
        </defs>

        <CartesianGrid strokeDasharray="2 4" stroke={neutrals.grid} vertical={false} />
        <XAxis
          dataKey="timestamp"
          {...AXIS}
          tickFormatter={(v: string) => timeTick(v, spanMs)}
          minTickGap={44}
        />
        <YAxis {...AXIS} domain={yDomain ?? ['auto', 'auto']} width={52} />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: neutrals.cursor }} />
        {showLegend && series.length > 1 && (
          <Legend
            iconType="plainline"
            iconSize={14}
            wrapperStyle={{ fontSize: 11, paddingTop: 8, color: neutrals.legend }}
          />
        )}

        {referenceLines.map((ref) => (
          <ReferenceLine
            key={ref.label}
            y={ref.y}
            stroke={ref.color ?? CHART_COLORS.warning}
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{ value: ref.label, position: 'insideTopRight', fill: neutrals.refLabel, fontSize: 10 }}
          />
        ))}

        {series.map((s) =>
          s.area ? (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={1.75}
              fill={`url(#fill-${s.key})`}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ) : (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={1.75}
              strokeDasharray={s.strokeDasharray}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

export function StackedBarChart({
  data,
  series,
  unit,
  height = 220,
}: {
  data: readonly ChartRow[];
  series: SeriesDef[];
  unit?: string;
  height?: number;
}) {
  const neutrals = useChartNeutrals();
  const AXIS = { stroke: neutrals.axis, fontSize: 11, tickLine: false, axisLine: false } as const;

  if (!data || data.length === 0) {
    return <EmptyState title="No data" description="Nothing recorded for this period yet." />;
  }

  const rows = data as Array<Record<string, unknown>>;
  const first = rows[0]?.timestamp as string | undefined;
  const last = rows[rows.length - 1]?.timestamp as string | undefined;
  const spanMs = first && last ? new Date(last).getTime() - new Date(first).getTime() : 3600_000;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={neutrals.grid} vertical={false} />
        <XAxis
          dataKey="timestamp"
          {...AXIS}
          tickFormatter={(v: string) => timeTick(v, spanMs)}
          minTickGap={44}
        />
        <YAxis {...AXIS} width={44} allowDecimals={false} />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: neutrals.tooltipCursorFill }} />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} radius={[2, 2, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal meter for a bounded 0-100 quantity such as SOC. */
export function LevelMeter({
  value,
  label,
  sublabel,
  thresholds = { critical: 20, warning: 30 },
  color = CHART_COLORS.battery,
}: {
  value: number | null;
  label: string;
  sublabel?: ReactNode;
  thresholds?: { critical: number; warning: number };
  color?: string;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  // Colour reflects severity, not decoration.
  const barColor =
    value === null
      ? '#475569'
      : value <= thresholds.critical
        ? CHART_COLORS.critical
        : value <= thresholds.warning
          ? CHART_COLORS.warning
          : color;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="metric-label">{label}</span>
        <span className="tabular text-sm font-semibold text-slate-100">
          {value === null ? '—' : `${value.toFixed(1)}%`}
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-panel-800"
        role="meter"
        aria-valuenow={value ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      {sublabel && <p className="mt-1.5 text-2xs text-slate-500">{sublabel}</p>}
    </div>
  );
}
