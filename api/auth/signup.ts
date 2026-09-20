/**
 * POST /api/auth/signup — self-service registration.
 *
 * SECURITY FIX CARRIED FROM v1
 * The original Flask endpoint accepted `role` from the request body, so anyone
 * could register as an administrator. Here the role is NEVER taken from the
 * client: self-registered accounts are VIEWER, and elevation happens only via
 * the env allowlist or by an existing ADMIN through /api/users.
 */

import { z } from 'zod';

import { ApiError, handler } from '../_lib/handler';
import {
  checkPasswordPolicy,
  hashPassword,
  newUserId,
  permissionsFor,
  roleForEmail,
  signToken,
  toPublicUser,
} from '../../server/auth';
import { eventRepo, userRepo, type UserDocument } from '../../server/repositories';
import { logger } from '../../server/logger';

const log = logger('auth:signup');

const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80),
  email: z.string().email('A valid email address is required.').max(200),
  password: z.string().min(1, 'Password is required.').max(200),
  // Deliberately NOT accepting `role`. Any role sent by a client is ignored.
});

export default handler({ methods: ['POST'], schema, rateLimit: 5 }, async ({ body }) => {
  const email = body.email.toLowerCase().trim();

  const policy = checkPasswordPolicy(body.password);
  if (!policy.ok) {
    throw new ApiError(400, 'WEAK_PASSWORD', `Password ${policy.problems.join(', ')}.`, {
      problems: policy.problems,
    });
  }

  const existing = await userRepo.findByEmail(email);
  if (existing) {
    // Registration is a case where confirming existence is unavoidable, but we
    // keep the wording neutral.
    throw new ApiError(409, 'EMAIL_IN_USE', 'An account with that email already exists.');
  }

  // Role comes from the server-side allowlist only.
  const role = roleForEmail(email);

  const user: UserDocument = {
    id: newUserId(),
    name: body.name.trim(),
    email,
    role,
    provider: 'password',
    createdAt: new Date().toISOString(),
    passwordHash: await hashPassword(body.password),
  };

  await userRepo.create(user);

  const { token, expiresAt } = await signToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });

  await eventRepo.record('signup', 'Account created', { userId: user.id, role });
  log.info('Account created', { userId: user.id, role });

  return {
    token,
    expiresAt,
    user: toPublicUser(user),
    permissions: permissionsFor(role),
  };
});
