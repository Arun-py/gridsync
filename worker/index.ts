/**
 * GridSync worker — the persistent process.
 *
 * WHY THIS IS NOT A VERCEL FUNCTION
 * A serverless function is invoked, runs, and is frozen. It cannot hold a 1 Hz
 * timer, cannot keep per-node rolling history between ticks, and cannot hold an
 * MQTT subscription open. The simulator therefore runs here — on Render, a VPS,
 * a Raspberry Pi, or a laptop during a demo — while Vercel serves the web app
 * and the read APIs. See docs/DEPLOYMENT.md.
 *
 * RESPONSIBILITIES
 *   - drive a TelemetrySource (simulation today, MQTT tomorrow)
 *   - run every frame through the shared pipeline
 *   - persist to MongoDB, tolerating outages
 *   - broadcast live frames to browsers over SSE
 *   - serve a small local API so `npm run dev` works with no other service
 *   - poll the database for control commands issued by the Demo Control page
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { SCENARIOS, SIMULATION_DEFAULTS } from '../shared/constants';
import { resolveNodes } from '../shared/nodes.config';
import type { ScenarioId, SimulationState, TelemetryFrame } from '../shared/types';
import { assertRequiredEnv, env } from '../server/env';
import { checkDbHealth } from '../server/db';
import { errorFields, logger } from '../server/logger';
import { loadModel } from '../server/ml';
import { Pipeline, type PipelinePersistence } from '../server/pipeline';
import { alertRepo, eventRepo, predictionRepo, simulationRepo, telemetryRepo } from '../server/repositories';
import { Broadcaster } from './broadcaster';
import { MqttSource } from './sources/mqtt';
import { SimulationSource } from './sources/simulation';
import type { TelemetrySource } from './sources/types';

const log = logger('worker');

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

assertRequiredEnv();

const useSimulation = env.source !== 'mqtt';

const source: TelemetrySource = useSimulation
  ? new SimulationSource({
      nodeCount: env.simulationNodeCount,
      scenario: env.simulationScenario as ScenarioId,
      intervalMs: env.simulationIntervalMs,
      speed: env.simulationSpeed,
    })
  : new MqttSource(env.simulationNodeCount);

const broadcaster = new Broadcaster();

/**
 * Persistence is injected rather than imported by the pipeline, so the pipeline
 * is testable without a database and so a Mongo outage is a contained failure.
 */
const persistence: PipelinePersistence = {
  async saveFrames(frames: TelemetryFrame[]) {
    await telemetryRepo.insertMany(frames);
  },
  async saveAlerts(alerts) {
    await alertRepo.insertMany(alerts);
  },
  async savePredictions(predictions) {
    await predictionRepo.insertMany(predictions);
  },
};

const pipeline = new Pipeline({
  nodes: source.getNodes(),
  mode: useSimulation ? 'SIMULATION' : 'REALTIME',
  persist: persistence,
});

pipeline.setScenario((env.simulationScenario as ScenarioId) ?? 'NORMAL');

/** Most recent pipeline output, served to clients that connect mid-stream. */
let lastPayload: {
  snapshot: unknown;
  frames: unknown;
  health: unknown;
  predictions: unknown;
} | null = null;

// ---------------------------------------------------------------------------
// The processing loop
// ---------------------------------------------------------------------------

source.onFrames((frames, meta) => {
  pipeline.setSolarElevation(meta.solarElevation);

  void pipeline
    .process(frames)
    .then((result) => {
      lastPayload = {
        snapshot: result.snapshot,
        frames: result.frames,
        health: result.health,
        predictions: result.predictions,
      };

      broadcaster.broadcast('telemetry', {
        snapshot: result.snapshot,
        frames: result.frames,
        health: result.health,
      });

      if (result.newAlerts.length > 0) {
        broadcaster.broadcast('alerts', result.newAlerts);
      }
      if (result.predictions.length > 0) {
        broadcaster.broadcast('predictions', result.predictions);
      }
    })
    .catch((err) => {
      // The loop must survive any single failure.
      log.error('Pipeline run failed', errorFields(err));
    });
});

// ---------------------------------------------------------------------------
// Control-command polling
// ---------------------------------------------------------------------------

/**
 * The API (on Vercel) and the worker (elsewhere) cannot call each other
 * directly, so MongoDB is the control plane: the Demo Control page writes a
 * command, the worker picks it up here. Polling at 2 s keeps a scenario switch
 * feeling immediate during a demo without hammering the cluster.
 */
async function pollCommands(): Promise<void> {
  try {
    const command = await simulationRepo.takeCommand();
    if (!command) return;

    log.info('Control command received', { type: command.type });
    const payload = (command.payload ?? {}) as Record<string, unknown>;

    switch (command.type) {
      case 'START':
        await source.start();
        break;
      case 'STOP':
        await source.stop();
        break;
      case 'RESTART':
        await source.stop();
        await source.start();
        break;
      case 'SET_SCENARIO': {
        const scenario = payload.scenario as ScenarioId;
        if (scenario && SCENARIOS[scenario]) {
          source.setScenario?.(scenario);
          pipeline.setScenario(scenario);
          await eventRepo.record('scenario_change', `Scenario changed to ${scenario}`, { scenario });
        }
        break;
      }
      case 'SET_INTERVAL':
        source.setIntervalMs?.(Number(payload.intervalMs));
        break;
      case 'SET_SPEED':
        source.setSpeed?.(Number(payload.speed));
        break;
      case 'SET_NODE_COUNT': {
        source.setNodeCount?.(Number(payload.nodeCount));
        pipeline.resetNodes(source.getNodes());
        break;
      }
      default:
        log.warn('Unknown control command ignored', { type: command.type });
    }

    await publishState();
  } catch (err) {
    // A database outage must not stop the simulator; commands simply do not
    // arrive until it recovers.
    log.debug('Command poll failed', errorFields(err));
  }
}

/** Mirror the worker's state into Mongo so the API can report it. */
async function publishState(): Promise<void> {
  const s = source.getState?.();
  const state: SimulationState = {
    running: source.isRunning(),
    scenario: s?.scenario ?? 'NORMAL',
    mode: useSimulation ? 'SIMULATION' : 'REALTIME',
    intervalMs: s?.intervalMs ?? SIMULATION_DEFAULTS.intervalMs,
    speed: s?.speed ?? SIMULATION_DEFAULTS.speed,
    nodeCount: s?.nodeCount ?? source.getNodes().length,
    startedAt: s?.startedAt ?? null,
    framesGenerated: s?.framesGenerated ?? 0,
    lastFrameAt: s?.lastFrameAt ?? null,
    lastFrame: s?.lastFrame ?? null,
    activeFaults: currentActiveFaults(s?.scenario ?? 'NORMAL'),
    simulatedTime: s?.simulatedTime ?? new Date().toISOString(),
  };

  try {
    await simulationRepo.set(state);
  } catch {
    /* degraded; the local /api/simulation/state endpoint still serves it */
  }
}

function currentActiveFaults(scenario: ScenarioId): string[] {
  const def = SCENARIOS[scenario];
  return def && def.severity !== 'NORMAL' ? [def.name] : [];
}

// ---------------------------------------------------------------------------
// Embedded HTTP server (local development + the SSE stream)
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Reject oversized bodies rather than buffering them.
    if (size > 64 * 1024) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    return res.end();
  }

  // --- SSE stream ---
  if (path === '/api/stream' || path === '/stream') {
    const id = broadcaster.add(res);
    // Send the current state immediately so a page load is never blank while
    // it waits for the next tick.
    if (lastPayload) {
      res.write(`event: telemetry\ndata: ${JSON.stringify(lastPayload)}\n\n`);
    }
    void id;
    return;
  }

  // --- worker health ---
  if (path === '/api/worker/health' || path === '/health') {
    const model = loadModel();
    return json(res, 200, {
      status: 'ok',
      source: source.kind,
      running: source.isRunning(),
      streamClients: broadcaster.clientCount,
      model: model.evaluator
        ? { version: model.evaluator.modelVersion, synthetic: model.evaluator.trainedOnSyntheticData }
        : { version: null, error: model.error },
    });
  }

  // --- simulation state ---
  if (path === '/api/simulation/state') {
    const s = source.getState?.();
    return json(res, 200, {
      running: source.isRunning(),
      scenario: s?.scenario ?? 'NORMAL',
      mode: useSimulation ? 'SIMULATION' : 'REALTIME',
      intervalMs: s?.intervalMs ?? SIMULATION_DEFAULTS.intervalMs,
      speed: s?.speed ?? SIMULATION_DEFAULTS.speed,
      nodeCount: s?.nodeCount ?? source.getNodes().length,
      startedAt: s?.startedAt ?? null,
      framesGenerated: s?.framesGenerated ?? 0,
      lastFrameAt: s?.lastFrameAt ?? null,
      lastFrame: s?.lastFrame ?? null,
      activeFaults: currentActiveFaults(s?.scenario ?? 'NORMAL'),
      simulatedTime: s?.simulatedTime ?? new Date().toISOString(),
    });
  }

  // --- live snapshot (polling fallback when SSE is unavailable) ---
  if (path === '/api/telemetry/latest') {
    if (!lastPayload) return json(res, 200, { snapshot: null, frames: [], health: null });
    return json(res, 200, lastPayload);
  }

  if (path === '/api/nodes') {
    return json(res, 200, { nodes: source.getNodes() });
  }

  // --- local control (development convenience; production goes via the API) ---
  if (req.method === 'POST' && path.startsWith('/api/simulation/')) {
    void (async () => {
      const body: Record<string, unknown> = await readBody(req).catch(() => ({}));
      const action = path.split('/').pop();

      switch (action) {
        case 'start':
          await source.start();
          break;
        case 'stop':
          await source.stop();
          break;
        case 'restart':
          await source.stop();
          await source.start();
          break;
        case 'scenario': {
          const scenario = body.scenario as ScenarioId;
          if (!scenario || !SCENARIOS[scenario]) {
            return json(res, 400, { error: 'Unknown scenario', code: 'BAD_SCENARIO' });
          }
          source.setScenario?.(scenario);
          pipeline.setScenario(scenario);
          break;
        }
        case 'config': {
          if (typeof body.intervalMs === 'number') source.setIntervalMs?.(body.intervalMs);
          if (typeof body.speed === 'number') source.setSpeed?.(body.speed);
          if (typeof body.nodeCount === 'number') {
            source.setNodeCount?.(body.nodeCount);
            pipeline.resetNodes(source.getNodes());
          }
          break;
        }
        default:
          return json(res, 404, { error: 'Unknown action', code: 'NOT_FOUND' });
      }

      await publishState();
      return json(res, 200, { ok: true, state: source.getState?.() ?? null });
    })();
    return;
  }

  json(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info('GridSync worker starting', {
    source: source.kind,
    nodes: source.getNodes().length,
    mode: useSimulation ? 'SIMULATION' : 'REALTIME',
  });

  // Report the model state at boot, loudly, so a missing model is obvious.
  const model = loadModel();
  if (model.evaluator) {
    log.info('ML inference enabled', {
      version: model.evaluator.modelVersion,
      trainedOnSyntheticData: model.evaluator.trainedOnSyntheticData,
    });
  } else {
    log.warn('ML inference DISABLED — rule engine continues unaffected', {
      reason: model.error,
    });
  }

  // Database is optional at boot: the worker runs in edge mode without it.
  const health = await checkDbHealth();
  if (health.connected) {
    log.info('MongoDB connected', { latencyMs: health.latencyMs });
    pipeline.markDbHealth(true);
    await eventRepo.record('worker_start', 'Worker started', { source: source.kind });
  } else {
    log.warn('MongoDB unavailable — starting in EDGE MODE (local processing only)', {
      error: health.error,
    });
    pipeline.markDbHealth(false, health.error ?? null);
  }

  server.listen(env.workerPort, () => {
    log.info('Worker HTTP server listening', {
      port: env.workerPort,
      stream: `http://localhost:${env.workerPort}/api/stream`,
    });
  });

  await source.start();
  await publishState();

  setInterval(() => void pollCommands(), 2000);

  // Re-check the database periodically so recovery is detected and reported.
  setInterval(() => {
    void checkDbHealth().then((h) => pipeline.markDbHealth(h.connected, h.error ?? null));
  }, 15_000);
}

// --- graceful shutdown ---
async function shutdown(signal: string): Promise<void> {
  log.info('Shutting down', { signal });
  try {
    await source.stop();
    broadcaster.close();
    server.close();
    await eventRepo.record('worker_stop', 'Worker stopped', { signal });
  } catch (err) {
    log.error('Shutdown error', errorFields(err));
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// An unhandled rejection must be logged, not silently swallowed.
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { errorMessage: String(reason) });
});

main().catch((err) => {
  log.error('Worker failed to start', errorFields(err));
  process.exit(1);
});

export { resolveNodes };
