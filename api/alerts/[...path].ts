/**
 * Dispatcher for /api/alerts, /api/alerts/:id/acknowledge and
 * /api/alerts/:id/resolve — see api/_lib/routes/alerts.ts for the actual
 * implementations. One file per route would push the deployment over
 * Vercel's serverless function cap.
 *
 * `[...path].ts` is a REQUIRED catch-all: Vercel's (non-Next.js) function
 * router does not match it against the bare `/api/alerts` path, only
 * `/api/alerts/*`. vercel.json rewrites the bare path to `/api/alerts/list`
 * so the list route is still reachable through this one function.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { acknowledgeHandler, listHandler, resolveHandler } from '../_lib/routes/alerts.js';

export default async function (req: VercelRequest, res: VercelResponse): Promise<void> {
  const segments = ([] as string[]).concat((req.query.path as string | string[]) ?? []);

  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'list')) {
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
