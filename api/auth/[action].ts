/**
 * Dispatcher for /api/auth/:action — see api/_lib/routes/auth.ts for the
 * actual login/signup/google/me implementations. One file per action would
 * push the deployment over Vercel's serverless function cap.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { googleHandler, loginHandler, meHandler, signupHandler } from '../_lib/routes/auth.js';

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  login: loginHandler,
  signup: signupHandler,
  google: googleHandler,
  me: meHandler,
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
