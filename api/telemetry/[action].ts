/**
 * Dispatcher for /api/telemetry/:action — see api/_lib/routes/telemetry.ts
 * for the actual latest/history implementations. One file per action would
 * push the deployment over Vercel's serverless function cap.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { historyHandler, latestHandler } from '../_lib/routes/telemetry';

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  latest: latestHandler,
  history: historyHandler,
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
