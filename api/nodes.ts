/**
 * GET /api/nodes — the node catalogue.
 *
 * The frontend DISCOVERS nodes from here and renders whatever it receives. No
 * component hardcodes "node 1, node 2, node 3, node 4", which is what allows
 * the node count to change without touching the UI (spec §33).
 */

import { handler, intParam } from './_lib/handler';
import { resolveNodes } from '../shared/nodes.config';
import { simulationRepo } from '../server/repositories';
import type { SimulationState } from '../shared/types';

export default handler({ methods: ['GET'], auth: true }, async ({ query }) => {
  // Prefer the count the worker is actually running; fall back to the query
  // parameter, then to the default.
  let nodeCount = intParam(query.count, 0, 0, 10);

  if (!nodeCount) {
    try {
      const state = await simulationRepo.get<SimulationState>();
      nodeCount = state?.nodeCount ?? 4;
    } catch {
      nodeCount = 4;
    }
  }

  const nodes = resolveNodes(nodeCount);
  return { nodes, total: nodes.length };
});
