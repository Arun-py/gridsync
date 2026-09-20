/**
 * Simulation route implementations, dispatched by api/simulation/[action].ts.
 *
 * Consolidated into one file (from two separate route files) to stay under
 * Vercel's per-deployment serverless function cap — see api/simulation/[action].ts.
 */

import { z } from 'zod';

import { ApiError, handler } from '../handler';
import { SCENARIOS, SCENARIO_LIST, SIMULATION_DEFAULTS } from '../../../shared/constants';
import { MAX_NODE_COUNT, MIN_NODE_COUNT } from '../../../shared/nodes.config';
import type { ScenarioId, SimulationState } from '../../../shared/types';
import { eventRepo, simulationRepo } from '../../../server/repositories';
import { logger } from '../../../server/logger';

// ---------------------------------------------------------------------------
// GET /api/simulation/state — what the simulator is currently doing.
//
// Read from the database, which the worker mirrors its state into. If the
// worker has never run, this reports `running: false` and says so rather than
// fabricating a plausible-looking state.
// ---------------------------------------------------------------------------

export const stateHandler = handler({ methods: ['GET'], auth: true }, async () => {
  let state: SimulationState | null = null;
  let stale = false;

  try {
    state = await simulationRepo.get<SimulationState>();
  } catch {
    stale = true;
  }

  // The worker stopping is indistinguishable from the worker never starting,
  // unless we check how recently it reported.
  const lastFrameAgeMs = state?.lastFrameAt
    ? Date.now() - new Date(state.lastFrameAt).getTime()
    : null;
  const workerResponsive = lastFrameAgeMs !== null && lastFrameAgeMs < 30_000;

  return {
    state: state ?? {
      running: false,
      scenario: 'NORMAL',
      mode: 'SIMULATION',
      intervalMs: SIMULATION_DEFAULTS.intervalMs,
      speed: SIMULATION_DEFAULTS.speed,
      nodeCount: SIMULATION_DEFAULTS.nodeCount,
      startedAt: null,
      framesGenerated: 0,
      lastFrameAt: null,
      lastFrame: null,
      activeFaults: [],
      simulatedTime: new Date().toISOString(),
    },
    workerResponsive,
    lastFrameAgeMs,
    controlPlaneAvailable: !stale,
    scenarios: SCENARIO_LIST,
    limits: {
      minNodes: MIN_NODE_COUNT,
      maxNodes: MAX_NODE_COUNT,
      minIntervalMs: 200,
      maxIntervalMs: 60_000,
      minSpeed: 1,
      maxSpeed: 3600,
    },
  };
});

// ---------------------------------------------------------------------------
// POST /api/simulation/control — drive the simulator from the Demo Control page.
//
// HOW THIS REACHES THE WORKER
// The API runs on Vercel; the worker runs somewhere else entirely and has no
// public inbound address. Rather than require one, commands are written to
// MongoDB and the worker polls for them every 2 s. The database is the control
// plane. That also means a command issued while the worker is down is picked up
// when it returns, instead of being silently lost.
//
// Requires the `simulation:control` permission — ADMIN and OPERATOR only. A
// VIEWER or TECHNICIAN receives 403.
// ---------------------------------------------------------------------------

const controlLog = logger('simulation:control');

const controlSchema = z.object({
  action: z.enum(['START', 'STOP', 'RESTART', 'SET_SCENARIO', 'SET_INTERVAL', 'SET_SPEED', 'SET_NODE_COUNT']),
  scenario: z.string().optional(),
  intervalMs: z.number().int().min(200).max(60_000).optional(),
  speed: z.number().min(1).max(3600).optional(),
  nodeCount: z.number().int().min(MIN_NODE_COUNT).max(MAX_NODE_COUNT).optional(),
});

export const controlHandler = handler(
  { methods: ['POST'], permission: 'simulation:control', schema: controlSchema, rateLimit: 60 },
  async ({ body, user }) => {
    // Validate the payload matches the action, so a malformed command never
    // reaches the worker.
    const payload: Record<string, unknown> = {};

    switch (body.action) {
      case 'SET_SCENARIO': {
        const scenario = body.scenario as ScenarioId | undefined;
        if (!scenario || !SCENARIOS[scenario]) {
          throw new ApiError(
            400,
            'BAD_SCENARIO',
            `Unknown scenario. Valid values: ${Object.keys(SCENARIOS).join(', ')}`,
          );
        }
        payload.scenario = scenario;
        break;
      }
      case 'SET_INTERVAL': {
        if (body.intervalMs === undefined) {
          throw new ApiError(400, 'MISSING_FIELD', 'intervalMs is required for SET_INTERVAL.');
        }
        payload.intervalMs = body.intervalMs;
        break;
      }
      case 'SET_SPEED': {
        if (body.speed === undefined) {
          throw new ApiError(400, 'MISSING_FIELD', 'speed is required for SET_SPEED.');
        }
        payload.speed = body.speed;
        break;
      }
      case 'SET_NODE_COUNT': {
        if (body.nodeCount === undefined) {
          throw new ApiError(400, 'MISSING_FIELD', 'nodeCount is required for SET_NODE_COUNT.');
        }
        payload.nodeCount = body.nodeCount;
        break;
      }
      default:
        break; // START / STOP / RESTART need no payload
    }

    await simulationRepo.pushCommand({ type: body.action, payload });

    await eventRepo.record('simulation_command', `Simulation command: ${body.action}`, {
      action: body.action,
      payload,
      userId: user!.sub,
      role: user!.role,
    });
    controlLog.info('Command queued', { action: body.action, userId: user!.sub });

    return {
      queued: true,
      action: body.action,
      payload,
      // The worker polls every 2 s, so set expectations honestly rather than
      // implying the change has already taken effect.
      note: 'Command queued for the worker. It is normally applied within 2 seconds.',
    };
  },
);
