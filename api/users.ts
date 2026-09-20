/**
 * GET   /api/users — list accounts (ADMIN only)
 * PATCH /api/users — change a user's role (ADMIN only)
 *
 * Role changes are audited to system_events. An administrator cannot demote
 * themselves, which would otherwise make it possible to lock every admin out
 * of the deployment with a single mis-click.
 */

import { z } from 'zod';

import { ApiError, handler } from './_lib/handler.js';
import type { Role } from '../shared/types.js';
import { eventRepo, userRepo } from '../server/repositories.js';
import { logger } from '../server/logger.js';

const log = logger('users');

const patchSchema = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(['ADMIN', 'OPERATOR', 'TECHNICIAN', 'VIEWER']),
});

export default handler({ methods: ['GET', 'PATCH'], permission: 'users:manage' }, async ({ req, user, res }) => {
  if (req.method === 'GET') {
    const users = await userRepo.list();
    return { users, total: users.length };
  }

  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400);
    return {
      error: 'Request body is invalid.',
      code: 'VALIDATION_FAILED',
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }

  const { userId, role } = parsed.data;

  if (userId === user!.sub && role !== 'ADMIN') {
    throw new ApiError(
      400,
      'CANNOT_DEMOTE_SELF',
      'You cannot remove your own administrator role. Ask another administrator to do it.',
    );
  }

  const target = await userRepo.findById(userId);
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'No user with that id.');

  const previous = target.role;
  await userRepo.updateRole(userId, role as Role);

  await eventRepo.record('role_changed', `Role changed for ${target.email}`, {
    targetUserId: userId,
    previousRole: previous,
    newRole: role,
    changedBy: user!.sub,
  });
  log.info('Role changed', { targetUserId: userId, previousRole: previous, newRole: role });

  return { userId, previousRole: previous, role };
});
