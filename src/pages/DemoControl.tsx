/**
 * Demo Control.
 *
 * Drives the live simulator. Commands go to /api/simulation/control, which
 * writes them to MongoDB; the worker polls and applies them within ~2 s. The
 * UI states that latency honestly rather than pretending the change is instant.
 *
 * Changing a scenario has a REAL effect on telemetry: the physics modifiers
 * shift, the rule engine's cooldowns reset, and the dashboard reflects it on
 * the next tick (spec §32).
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Gauge,
  Play,
  RotateCcw,
  Server,
  Square,
  Timer,
} from 'lucide-react';

import type { ScenarioId } from '@shared/types';
import { SCENARIO_LIST } from '@shared/constants';
import {
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  fmt,
  fmtAge,
  fmtDateTime,
} from '../components/ui';
import { errorMessage, simulationApi, type SimulationStateResponse } from '../lib/api';
import { useTelemetry } from '../lib/telemetry/TelemetryContext';

export default function DemoControl() {
  const { refresh, snapshot } = useTelemetry();

  const [data, setData] = useState<SimulationStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Local draft values for the sliders, so dragging does not fire a request
  // per pixel.
  const [interval, setIntervalMs] = useState(1000);
  const [speed, setSpeed] = useState(60);
  const [nodeCount, setNodeCount] = useState(4);

  const load = () =>
    simulationApi
      .state()
      .then((res) => {
        setData(res);
        setIntervalMs(res.state.intervalMs);
        setSpeed(res.state.speed);
        setNodeCount(res.state.nodeCount);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async (
    payload: Parameters<typeof simulationApi.control>[0],
    label: string,
  ) => {
    setBusy(label);
    setNotice(null);
    try {
      const res = await simulationApi.control(payload);
      setNotice(res.note);
      // Nudge the telemetry provider so the effect appears quickly.
      window.setTimeout(refresh, 2200);
      window.setTimeout(() => void load(), 2400);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <LoadingState label="Reading simulator state" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return null;

  const { state, workerResponsive, lastFrameAgeMs, limits } = data;
  const activeScenario = SCENARIO_LIST.find((s) => s.id === state.scenario);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Demo Control</h1>
          <p className="mt-1 text-xs text-slate-500">
            Drive the simulation engine. Changes affect live telemetry, the rule engine and the
            model.
          </p>
        </div>
        <span className={`badge ${workerResponsive ? 'badge-ok' : 'badge-critical'}`}>
          <Server className="h-3 w-3" />
          {workerResponsive ? 'Worker responsive' : 'Worker not reporting'}
        </span>
      </div>

      {/* ---- worker warning ---- */}
      {!workerResponsive && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-200">
                The simulator worker is not reporting
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-200/70">
                {lastFrameAgeMs === null
                  ? 'No telemetry has ever been recorded.'
                  : `The last frame was ${Math.round(lastFrameAgeMs / 1000)} s ago.`}{' '}
                Commands issued here are queued and will be applied when the worker returns.
              </p>
              <p className="mt-2 text-2xs text-slate-500">
                Start it with: <code className="text-slate-400">npm run worker</code>
              </p>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded border border-primary-500/30 bg-primary-500/5 p-3 text-xs text-primary-200">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {notice}
        </div>
      )}

      {error && data && <ErrorState message={error} variant="warning" />}

      {/* ---- status ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Panel>
          <Metric
            label="Simulator"
            value={state.running ? 'Running' : 'Stopped'}
            size="sm"
            accent={state.running ? '#22c55e' : '#ef4444'}
          />
        </Panel>
        <Panel>
          <Metric label="Mode" value={state.mode} size="sm" />
        </Panel>
        <Panel>
          <Metric
            label="Scenario"
            value={state.scenario.replace(/_/g, ' ')}
            size="sm"
            accent={activeScenario?.severity === 'CRITICAL' ? '#ef4444' : undefined}
          />
        </Panel>
        <Panel>
          <Metric label="Nodes" value={state.nodeCount} size="sm" />
        </Panel>
        <Panel>
          <Metric
            label="Frames"
            value={state.framesGenerated.toLocaleString()}
            size="sm"
          />
        </Panel>
        <Panel>
          <Metric
            label="Last frame"
            value={lastFrameAgeMs === null ? '—' : fmtAge(lastFrameAgeMs)}
            size="sm"
          />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        {/* ---- scenarios ---- */}
        <Panel
          title="Scenario"
          subtitle="Each scenario modifies the physics coherently — values are never overridden directly"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {SCENARIO_LIST.map((scenario) => {
              const active = scenario.id === state.scenario;
              return (
                <button
                  key={scenario.id}
                  onClick={() =>
                    void send({ action: 'SET_SCENARIO', scenario: scenario.id as ScenarioId }, scenario.id)
                  }
                  disabled={busy !== null}
                  className={`rounded border p-3 text-left transition-colors disabled:opacity-50 ${
                    active
                      ? 'border-primary-500 bg-primary-600/10'
                      : 'border-panel-700 bg-panel-850 hover:border-panel-600'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={`text-xs font-semibold ${active ? 'text-primary-200' : 'text-slate-200'}`}
                    >
                      {scenario.name}
                    </p>
                    <span
                      className={`badge shrink-0 ${
                        scenario.severity === 'CRITICAL'
                          ? 'badge-critical'
                          : scenario.severity === 'WARNING'
                            ? 'badge-warning'
                            : 'badge-neutral'
                      }`}
                    >
                      {scenario.severity}
                    </span>
                  </div>
                  <p className="mt-1.5 text-2xs leading-relaxed text-slate-500">
                    {scenario.description}
                  </p>
                  {active && <p className="mt-2 text-2xs font-medium text-primary-400">Active</p>}
                </button>
              );
            })}
          </div>
        </Panel>

        <div className="space-y-4">
          {/* ---- lifecycle ---- */}
          <Panel title="Simulator control">
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => void send({ action: 'START' }, 'START')}
                disabled={busy !== null || state.running}
                className="btn btn-secondary"
              >
                <Play className="h-3.5 w-3.5" />
                Start
              </button>
              <button
                onClick={() => void send({ action: 'STOP' }, 'STOP')}
                disabled={busy !== null || !state.running}
                className="btn btn-secondary"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </button>
              <button
                onClick={() => void send({ action: 'RESTART' }, 'RESTART')}
                disabled={busy !== null}
                className="btn btn-secondary"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restart
              </button>
            </div>
          </Panel>

          {/* ---- tuning ---- */}
          <Panel title="Configuration">
            <div className="space-y-5">
              <SliderRow
                icon={Timer}
                label="Update interval"
                value={interval}
                display={`${interval} ms (${(1000 / interval).toFixed(1)} Hz)`}
                min={limits.minIntervalMs}
                max={5000}
                step={100}
                onChange={setIntervalMs}
                onCommit={() => void send({ action: 'SET_INTERVAL', intervalMs: interval }, 'INTERVAL')}
                disabled={busy !== null}
              />

              <SliderRow
                icon={Gauge}
                label="Simulation speed"
                value={speed}
                display={`${speed}× — one simulated hour per ${(3600 / speed).toFixed(0)} s`}
                min={limits.minSpeed}
                max={300}
                step={1}
                onChange={setSpeed}
                onCommit={() => void send({ action: 'SET_SPEED', speed }, 'SPEED')}
                disabled={busy !== null}
              />

              <SliderRow
                icon={Server}
                label="Number of nodes"
                value={nodeCount}
                display={`${nodeCount} nodes`}
                min={limits.minNodes}
                max={limits.maxNodes}
                step={1}
                onChange={setNodeCount}
                onCommit={() => void send({ action: 'SET_NODE_COUNT', nodeCount }, 'NODES')}
                disabled={busy !== null}
              />
            </div>

            <p className="mt-4 border-t border-panel-800 pt-3 text-2xs leading-relaxed text-slate-600">
              Node count is capped at {limits.maxNodes} by the catalogue in
              shared/nodes.config.ts. The frontend discovers whatever the API reports — no component
              is hardcoded to four nodes.
            </p>
          </Panel>
        </div>
      </div>

      {/* ---- expected effects ---- */}
      {activeScenario && (
        <Panel
          title={`Expected effects — ${activeScenario.name}`}
          subtitle="What you should observe while this scenario is active"
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {activeScenario.expectedEffects.map((effect) => (
              <li key={effect} className="flex items-start gap-2 text-xs text-slate-400">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" />
                {effect}
              </li>
            ))}
          </ul>

          {state.activeFaults.length > 0 && (
            <div className="mt-4 rounded border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-2xs font-semibold uppercase tracking-wider text-amber-400">
                Active faults
              </p>
              <p className="mt-1.5 text-xs text-amber-200/80">{state.activeFaults.join(', ')}</p>
            </div>
          )}
        </Panel>
      )}

      {/* ---- last packet ---- */}
      <Panel
        title="Last generated packet"
        subtitle="Raw telemetry frame, exactly as produced"
      >
        {state.lastFrame ? (
          <pre className="overflow-x-auto rounded border border-panel-700 bg-panel-950 p-3 font-mono text-2xs leading-relaxed text-slate-400">
            {JSON.stringify(state.lastFrame, null, 2)}
          </pre>
        ) : (
          <p className="py-6 text-center text-xs text-slate-600">No frame produced yet.</p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-panel-800 pt-3 sm:grid-cols-4">
          <Metric
            label="Simulated time"
            value={new Date(state.simulatedTime).toLocaleTimeString()}
            size="sm"
          />
          <Metric
            label="Started"
            value={state.startedAt ? fmtDateTime(state.startedAt) : '—'}
            size="sm"
          />
          <Metric
            label="Live generation"
            value={snapshot ? `${fmt(snapshot.generationW, 0)} W` : '—'}
            size="sm"
          />
          <Metric
            label="Live consumption"
            value={snapshot ? `${fmt(snapshot.consumptionW, 0)} W` : '—'}
            size="sm"
          />
        </div>
      </Panel>
    </div>
  );
}

function SliderRow({
  icon: Icon,
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  onCommit,
  disabled,
}: {
  icon: typeof Timer;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="tabular text-2xs text-slate-500">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        // Commit on release, not on every change event.
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={onCommit}
        className="mt-2 w-full accent-primary-500"
        aria-label={label}
      />
    </div>
  );
}
