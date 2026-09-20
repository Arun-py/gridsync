/**
 * POST /api/alerts/:id/acknowledge
 *
 * Requires the `alerts:acknowledge` permission. A VIEWER calling this directly
 * — bypassing the UI, which hides the button — receives 403. Hiding a control
 * is presentation; this is the actual control (spec §55).
 */

import { ApiError, handler } from '../../_lib/handler';
import { alertRepo, eventRepo } from '../../../server/repositories';
import { logger } from '../../../server/logger';

const log = logger('alerts:acknowledge');

export default handler(
  { methods: ['POST'], permission: 'alerts:acknowledge' },
  async ({ req, user }) => {
    const id = String(req.query.id ?? '').trim();
    if (!id) throw new ApiError(400, 'MISSING_ID', 'An alert id is required.');

    const alert = await alertRepo.setStatus(id, 'ACKNOWLEDGED', user!.email);
    if (!alert) throw new ApiError(404, 'ALERT_NOT_FOUND', 'No alert with that id.');

    await eventRepo.record('alert_acknowledged', `Alert ${id} acknowledged`, {
      alertId: id,
      userId: user!.sub,
      role: user!.role,
    });
    log.info('Alert acknowledged', { alertId: id, userId: user!.sub });

    return { alert };
  },
);
