/**
 * GET /api/health — unauthenticated liveness probe.
 *
 * Deliberately minimal and public: uptime monitors need it, so it must not
 * require a token. It therefore reveals only whether components respond, never
 * versions, hostnames, connection strings or configuration.
 */

import { handler } from './_lib/handler';
import { checkDbHealth } from '../server/db';
import { loadModel } from '../server/ml';

export default handler({ methods: ['GET'], rateLimit: 60 }, async ({ res }) => {
  const db = await checkDbHealth();
  const model = loadModel();

  const healthy = db.connected;
  if (!healthy) res.status(503);

  return {
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      api: 'ok',
      database: db.connected ? 'ok' : 'unreachable',
      mlModel: model.evaluator ? 'loaded' : 'unavailable',
    },
  };
});
