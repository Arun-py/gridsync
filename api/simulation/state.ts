/**
 * GET /api/simulation/state — what the simulator is currently doing.
 *
 * Read from the database, which the worker mirrors its state into. If the
 * worker has never run, this reports `running: false` and says so rather than
 * fabricating a plausible-looking state.
 */

import { handler } from '../_lib/handler';
import { SCENARIO_LIST, SIMULATION_DEFAULTS } from '../../shared/constants';
import { MAX_NODE_COUNT, MIN_NODE_COUNT } from '../../shared/nodes.config';
import type { SimulationState } from '../../shared/types';
import { simulationRepo } from '../../server/repositories';

export default handler({ methods: ['GET'], auth: true }, async () => {
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
