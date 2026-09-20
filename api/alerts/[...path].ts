/**
 * Dispatcher for /api/alerts, /api/alerts/:id/acknowledge and
 * /api/alerts/:id/resolve — see api/_lib/routes/alerts.ts for the actual
 * implementations. One file per route would push the deployment over
 * Vercel's serverless function cap.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { acknowledgeHandler, listHandler, resolveHandler } from '../_lib/routes/alerts';

export default async function (req: VercelRequest, res: VercelResponse): Promise<void> {
  const segments = ([] as string[]).concat((req.query.path as string | string[]) ?? []);

  if (segments.length === 0) {
    await listHandler(req, res);
    return;
  }

  if (segments.length === 2 && (segments[1] === 'acknowledge' || segments[1] === 'resolve')) {
    req.query.id = segments[0];
    await (segments[1] === 'acknowledge' ? acknowledgeHandler : resolveHandler)(req, res);
    return;
  }

  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}
