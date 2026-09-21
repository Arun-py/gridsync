/**
 * Dispatcher for /api/alerts, /api/alerts/:id/acknowledge and
 * /api/alerts/:id/resolve — see api/_lib/routes/alerts.ts for the actual
 * implementations. One file per route would push the deployment over
 * Vercel's serverless function cap.
 *
 * `[...path].ts` LOOKS like a catch-all but, outside Next.js, Vercel's
 * generated function route only ever matches ONE path segment after
 * /api/alerts/ (confirmed against the actual deployed routing manifest —
 * a bare /api/alerts and a two-segment /api/alerts/:id/acknowledge both
 * 404 before this function is even invoked). vercel.json works around
 * this by rewriting both shapes into a single encoded segment:
 *   /api/alerts                    -> /api/alerts/list
 *   /api/alerts/:id/acknowledge    -> /api/alerts/:id~acknowledge
 *   /api/alerts/:id/resolve        -> /api/alerts/:id~resolve
 * which this dispatcher decodes below.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { acknowledgeHandler, listHandler, resolveHandler } from '../_lib/routes/alerts.js';

export default async function (req: VercelRequest, res: VercelResponse): Promise<void> {
  // Vercel names a [...path] catch-all's query key literally "...path" (with
  // the ellipsis) rather than "path" — confirmed against the deployed
  // request object, not documented behaviour worth relying on blindly again.
  const raw = ([] as string[]).concat((req.query['...path'] as string | string[]) ?? []);
  const segments = raw.length === 1 ? raw[0].split('~') : raw;

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
