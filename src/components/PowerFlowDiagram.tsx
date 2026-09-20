/**
 * Microgrid digital twin — animated power-flow diagram.
 *
 * Reads the LIVE snapshot: flow direction, line weight and animation speed are
 * all derived from actual power values, not decoration. In particular the
 * battery link REVERSES when the bank switches between charging and
 * discharging, which is the whole point of showing bidirectional storage.
 *
 * Accessibility: direction is conveyed by an arrowhead and a text label as well
 * as by motion, and the animation is disabled under prefers-reduced-motion.
 */

import type { EnrichedFrame, NodeConfig, SystemSnapshot } from '@shared/types';
import { CHART_COLORS } from './charts';
import { fmt } from './ui';

interface Props {
  snapshot: SystemSnapshot;
  frames: EnrichedFrame[];
  nodes: NodeConfig[];
  onSelectNode?: (nodeId: string) => void;
  selectedNodeId?: string | null;
}

/** Stroke width scaled by power, so a heavy flow reads as heavy. */
function flowWidth(watts: number): number {
  const w = Math.abs(watts);
  if (w < 1) return 1;
  return Math.min(6, 1.5 + Math.log10(w + 1) * 1.5);
}

/** Faster dashes for more power. Clamped so it never becomes a strobe. */
function flowDuration(watts: number): string {
  const w = Math.abs(watts);
  if (w < 1) return '0s';
  const seconds = Math.max(0.35, Math.min(3, 60 / (w + 12)));
  return `${seconds.toFixed(2)}s`;
}

export default function PowerFlowDiagram({
  snapshot,
  frames,
  nodes,
  onSelectNode,
  selectedNodeId,
}: Props) {
  const ofType = (type: NodeConfig['type']) =>
    frames.filter((f) => (nodes.find((n) => n.id === f.nodeId)?.type ?? f.nodeType) === type);

  const solar = ofType('SOLAR');
  const battery = ofType('BATTERY');
  const acLoad = ofType('AC_LOAD');
  const dcLoad = ofType('DC_LOAD');

  const batteryPower = snapshot.batteryPowerW ?? 0;
  const charging = snapshot.batteryState === 'CHARGING';
  const discharging = snapshot.batteryState === 'DISCHARGING';

  const worstStatus = (list: EnrichedFrame[]): EnrichedFrame['status'] => {
    if (list.length === 0) return 'OFFLINE';
    if (list.some((f) => f.status === 'FAULT')) return 'FAULT';
    if (list.some((f) => f.status === 'OFFLINE')) return 'OFFLINE';
    if (list.some((f) => f.status === 'STALE')) return 'STALE';
    return 'ONLINE';
  };

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox="0 0 720 420"
        className="w-full min-w-[560px]"
        role="img"
        aria-label={`Power flow: generation ${fmt(snapshot.generationW, 0)} watts, consumption ${fmt(snapshot.consumptionW, 0)} watts, battery ${snapshot.batteryState ?? 'unknown'}`}
      >
        <defs>
          <marker id="pf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
          <filter id="pf-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ================= connections ================= */}

        {/* Solar bus -> junction */}
        <FlowPath
          d="M 196 92 L 330 92 L 330 176"
          watts={snapshot.generationW}
          color={CHART_COLORS.solar}
          label={`${fmt(snapshot.generationW, 0)} W`}
          labelX={340}
          labelY={130}
        />

        {/* Junction -> battery (charging) OR battery -> junction (discharging) */}
        <FlowPath
          d={charging ? 'M 330 176 L 330 214 L 236 214' : 'M 236 214 L 330 214 L 330 176'}
          watts={batteryPower}
          color={CHART_COLORS.battery}
          label={
            snapshot.batteryState === 'IDLE' || batteryPower === 0
              ? 'idle'
              : `${fmt(Math.abs(batteryPower), 0)} W ${charging ? 'in' : 'out'}`
          }
          labelX={252}
          labelY={202}
          inactive={!charging && !discharging}
        />

        {/* Junction -> AC load */}
        <FlowPath
          d="M 330 176 L 330 300 L 214 300 L 214 330"
          watts={snapshot.acLoadW}
          color={CHART_COLORS.ac}
          label={`${fmt(snapshot.acLoadW, 0)} W`}
          labelX={224}
          labelY={292}
        />

        {/* Junction -> DC load */}
        <FlowPath
          d="M 330 176 L 330 300 L 506 300 L 506 330"
          watts={snapshot.dcLoadW}
          color={CHART_COLORS.dc}
          label={`${fmt(snapshot.dcLoadW, 0)} W`}
          labelX={430}
          labelY={292}
        />

        {/* ================= junction ================= */}
        <g>
          <circle cx="330" cy="176" r="7" fill="#11161f" stroke="#475569" strokeWidth="1.5" />
          <circle cx="330" cy="176" r="2.5" fill="#94a3b8" />
          <text x="346" y="172" fill="#64748b" fontSize="10" fontWeight="500">
            DC bus
          </text>
          <text x="346" y="185" fill={snapshot.netPowerW >= 0 ? '#22c55e' : '#f59e0b'} fontSize="10">
            {snapshot.netPowerW >= 0 ? '+' : ''}
            {fmt(snapshot.netPowerW, 0)} W
          </text>
        </g>

        {/* ================= nodes ================= */}
        <NodeBox
          x={40}
          y={54}
          label="SIGMA"
          sublabel="Solar array"
          value={`${fmt(snapshot.generationW, 0)} W`}
          detail={solar[0]?.lux !== undefined ? `${fmt(solar[0].lux, 0)} lx` : undefined}
          color={CHART_COLORS.solar}
          status={worstStatus(solar)}
          onClick={solar[0] ? () => onSelectNode?.(solar[0].nodeId) : undefined}
          selected={selectedNodeId === solar[0]?.nodeId}
          count={solar.length}
        />

        <NodeBox
          x={40}
          y={186}
          label="BETA"
          sublabel="Storage"
          value={snapshot.batterySoc === null ? '—' : `${fmt(snapshot.batterySoc, 0)}%`}
          detail={snapshot.batteryState ?? undefined}
          color={CHART_COLORS.battery}
          status={worstStatus(battery)}
          onClick={battery[0] ? () => onSelectNode?.(battery[0].nodeId) : undefined}
          selected={selectedNodeId === battery[0]?.nodeId}
          count={battery.length}
        />

        <NodeBox
          x={124}
          y={330}
          label="AC LOAD"
          sublabel="Inverter branch"
          value={`${fmt(snapshot.acLoadW, 0)} W`}
          color={CHART_COLORS.ac}
          status={worstStatus(acLoad)}
          onClick={acLoad[0] ? () => onSelectNode?.(acLoad[0].nodeId) : undefined}
          selected={selectedNodeId === acLoad[0]?.nodeId}
          count={acLoad.length}
        />

        <NodeBox
          x={416}
          y={330}
          label="DC LOAD"
          sublabel="Direct branch"
          value={`${fmt(snapshot.dcLoadW, 0)} W`}
          color={CHART_COLORS.dc}
          status={worstStatus(dcLoad)}
          onClick={dcLoad[0] ? () => onSelectNode?.(dcLoad[0].nodeId) : undefined}
          selected={selectedNodeId === dcLoad[0]?.nodeId}
          count={dcLoad.length}
        />
      </svg>
    </div>
  );
}

function FlowPath({
  d,
  watts,
  color,
  label,
  labelX,
  labelY,
  inactive = false,
}: {
  d: string;
  watts: number;
  color: string;
  label: string;
  labelX: number;
  labelY: number;
  inactive?: boolean;
}) {
  const active = !inactive && Math.abs(watts) > 0.5;

  return (
    <g>
      {/* static rail, always visible so topology reads even at zero flow */}
      <path d={d} stroke="#1e2531" strokeWidth={flowWidth(watts) + 2} fill="none" strokeLinecap="round" />
      {/* animated flow, only when power is actually moving */}
      {active && (
        <path
          d={d}
          stroke={color}
          strokeWidth={flowWidth(watts)}
          fill="none"
          strokeLinecap="round"
          markerEnd="url(#pf-arrow)"
          className="flow-line"
          style={{ animationDuration: flowDuration(watts) }}
          opacity={0.9}
        />
      )}
      {!active && (
        <path d={d} stroke="#334155" strokeWidth={1.25} fill="none" strokeDasharray="3 5" />
      )}
      <text x={labelX} y={labelY} fill={active ? color : '#475569'} fontSize="10" fontWeight="500">
        {label}
      </text>
    </g>
  );
}

const STATUS_STROKE: Record<EnrichedFrame['status'], string> = {
  ONLINE: '#334155',
  DEGRADED: '#f59e0b',
  STALE: '#f59e0b',
  OFFLINE: '#ef4444',
  FAULT: '#ef4444',
};

function NodeBox({
  x,
  y,
  label,
  sublabel,
  value,
  detail,
  color,
  status,
  onClick,
  selected,
  count,
}: {
  x: number;
  y: number;
  label: string;
  sublabel: string;
  value: string;
  detail?: string;
  color: string;
  status: EnrichedFrame['status'];
  onClick?: () => void;
  selected?: boolean;
  count: number;
}) {
  const w = 156;
  const h = 76;
  const faulted = status === 'OFFLINE' || status === 'FAULT';

  return (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`${label}: ${value}, ${status}`}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="5"
        fill="#11161f"
        stroke={selected ? color : STATUS_STROKE[status]}
        strokeWidth={selected ? 2 : 1.25}
        filter={faulted ? 'url(#pf-glow)' : undefined}
        opacity={faulted ? 0.95 : 1}
      />
      {/* accent rail identifies the subsystem at a glance */}
      <rect x={x} y={y} width="3" height={h} rx="1.5" fill={color} opacity={faulted ? 0.5 : 1} />

      <text x={x + 14} y={y + 21} fill="#e2e8f0" fontSize="12" fontWeight="600" letterSpacing="0.03em">
        {label}
      </text>
      <text x={x + 14} y={y + 35} fill="#64748b" fontSize="9">
        {sublabel}
        {count > 1 ? ` · ${count} nodes` : ''}
      </text>
      <text x={x + 14} y={y + 58} fill={faulted ? '#ef4444' : color} fontSize="17" fontWeight="600">
        {value}
      </text>
      {detail && (
        <text x={x + 14} y={y + 70} fill="#475569" fontSize="9">
          {detail}
        </text>
      )}

      {/* status dot */}
      <circle
        cx={x + w - 13}
        cy={y + 15}
        r="3.5"
        fill={
          status === 'ONLINE'
            ? '#22c55e'
            : status === 'STALE' || status === 'DEGRADED'
              ? '#f59e0b'
              : '#ef4444'
        }
      >
        {faulted && (
          <animate attributeName="opacity" values="1;0.25;1" dur="1.2s" repeatCount="indefinite" />
        )}
      </circle>
    </g>
  );
}
