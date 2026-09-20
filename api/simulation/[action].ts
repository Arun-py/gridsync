/**
 * Dispatcher for /api/simulation/:action — see api/_lib/routes/simulation.ts
 * for the actual state/control implementations. One file per action would
 * push the deployment over Vercel's serverless function cap.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { controlHandler, stateHandler } from '../_lib/routes/simulation.js';

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  state: stateHandler,
  control: controlHandler,
};

export default async function (req: VercelRequest, res: VercelResponse): Promise<void> {
  const action = String(req.query.action ?? '');
  const route = ROUTES[action];
  if (!route) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return;
  }
  await route(req, res);
}
