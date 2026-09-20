/**
 * POST /api/alerts/:id/resolve
 *
 * Requires `alerts:resolve`. Note this is a NARROWER permission than
 * acknowledge: a TECHNICIAN may acknowledge an alert they are investigating but
 * only an OPERATOR or ADMIN may declare it resolved.
 */

import { ApiError, handler } from '../../_lib/handler';
import { alertRepo, eventRepo } from '../../../server/repositories';
import { logger } from '../../../server/logger';

const log = logger('alerts:resolve');

export default handler({ methods: ['POST'], permission: 'alerts:resolve' }, async ({ req, user }) => {
  const id = String(req.query.id ?? '').trim();
  if (!id) throw new ApiError(400, 'MISSING_ID', 'An alert id is required.');

  const alert = await alertRepo.setStatus(id, 'RESOLVED', user!.email);
  if (!alert) throw new ApiError(404, 'ALERT_NOT_FOUND', 'No alert with that id.');

  await eventRepo.record('alert_resolved', `Alert ${id} resolved`, {
    alertId: id,
    userId: user!.sub,
    role: user!.role,
  });
  log.info('Alert resolved', { alertId: id, userId: user!.sub });

  return { alert };
});
