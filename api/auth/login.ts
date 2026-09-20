/**
 * POST /api/auth/login — email + password.
 *
 * Returns an identical error for "unknown email" and "wrong password", and
 * performs a dummy bcrypt comparison when the user does not exist. Without
 * that, response timing reveals which emails are registered.
 */

import { z } from 'zod';

import { ApiError, handler } from '../_lib/handler';
import { hashPassword, permissionsFor, signToken, toPublicUser, verifyPassword } from '../../server/auth';
import { eventRepo, stripSecrets, userRepo } from '../../server/repositories';
import { logger } from '../../server/logger';

const log = logger('auth:login');

const schema = z.object({
  email: z.string().email('A valid email address is required.').max(200),
  password: z.string().min(1, 'Password is required.').max(200),
});

/** Constant-ish work factor for the "no such user" path. */
let dummyHash: string | null = null;
async function dummyCompare(password: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword('gridsync-timing-equaliser');
  await verifyPassword(password, dummyHash);
}

export default handler(
  {
    methods: ['POST'],
    schema,
    // Tight limit: this is the endpoint worth brute-forcing.
    rateLimit: 10,
  },
  async ({ body }) => {
    const email = body.email.toLowerCase().trim();
    const user = await userRepo.findByEmail(email);

    if (!user || !user.passwordHash) {
      await dummyCompare(body.password);
      log.warn('Failed login', { emailDomain: email.split('@')[1] });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      log.warn('Failed login', { emailDomain: email.split('@')[1] });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }

    const { token, expiresAt } = await signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    await eventRepo.record('login', 'User signed in', { userId: user.id, role: user.role });
    log.info('Login succeeded', { userId: user.id, role: user.role });

    return {
      token,
      expiresAt,
      user: toPublicUser(stripSecrets(user)),
      permissions: permissionsFor(user.role),
    };
  },
);
