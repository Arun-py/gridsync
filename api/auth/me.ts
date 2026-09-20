/**
 * GET /api/auth/me — current session.
 *
 * The role is re-read from the DATABASE rather than trusted from the token, so
 * a role change takes effect on the next request instead of waiting out the
 * token's lifetime. Permissions are returned alongside so the UI can render the
 * right controls — though the server enforces them regardless.
 */

import { ApiError, handler } from '../_lib/handler';
import { permissionsFor, toPublicUser } from '../../server/auth';
import { stripSecrets, userRepo } from '../../server/repositories';
import { env } from '../../server/env';

export default handler({ methods: ['GET'], auth: true }, async ({ user }) => {
  const record = await userRepo.findById(user!.sub);
  if (!record) {
    throw new ApiError(401, 'USER_NOT_FOUND', 'This account no longer exists.');
  }

  return {
    user: toPublicUser(stripSecrets(record)),
    permissions: permissionsFor(record.role),
    googleEnabled: env.googleEnabled,
  };
});
