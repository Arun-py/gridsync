/**
 * POST /api/simulation/control — drive the simulator from the Demo Control page.
 *
 * HOW THIS REACHES THE WORKER
 * The API runs on Vercel; the worker runs somewhere else entirely and has no
 * public inbound address. Rather than require one, commands are written to
 * MongoDB and the worker polls for them every 2 s. The database is the control
 * plane. That also means a command issued while the worker is down is picked up
 * when it returns, instead of being silently lost.
 *
 * Requires the `simulation:control` permission — ADMIN and OPERATOR only. A
 * VIEWER or TECHNICIAN receives 403.
 */

import { z } from 'zod';

import { ApiError, handler } from '../_lib/handler';
import { SCENARIOS } from '../../shared/constants';
import { MAX_NODE_COUNT, MIN_NODE_COUNT } from '../../shared/nodes.config';
import type { ScenarioId } from '../../shared/types';
import { eventRepo, simulationRepo } from '../../server/repositories';
import { logger } from '../../server/logger';

const log = logger('simulation:control');

const schema = z.object({
  action: z.enum(['START', 'STOP', 'RESTART', 'SET_SCENARIO', 'SET_INTERVAL', 'SET_SPEED', 'SET_NODE_COUNT']),
  scenario: z.string().optional(),
  intervalMs: z.number().int().min(200).max(60_000).optional(),
  speed: z.number().min(1).max(3600).optional(),
  nodeCount: z.number().int().min(MIN_NODE_COUNT).max(MAX_NODE_COUNT).optional(),
});

export default handler(
  { methods: ['POST'], permission: 'simulation:control', schema, rateLimit: 60 },
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
    log.info('Command queued', { action: body.action, userId: user!.sub });

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
