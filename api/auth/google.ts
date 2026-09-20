/**
 * POST /api/auth/google — Google OAuth sign-in.
 *
 * Accepts either:
 *   { credential }  an ID token from Google Identity Services (the button flow)
 *   { code }        an authorisation code from the redirect flow
 *
 * ROLE ASSIGNMENT (spec §11)
 * A Google-authenticated user is a VIEWER unless their email appears in
 * ADMIN_EMAILS / OPERATOR_EMAILS / TECHNICIAN_EMAILS. Those lists live in
 * environment variables — privileged addresses are never in source.
 *
 * The role is re-evaluated on every sign-in, so removing an address from an
 * allowlist demotes that user the next time they authenticate.
 */

import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

import { ApiError, handler } from '../_lib/handler';
import { newUserId, permissionsFor, roleForEmail, signToken, toPublicUser } from '../../server/auth';
import { env } from '../../server/env';
import { eventRepo, stripSecrets, userRepo, type UserDocument } from '../../server/repositories';
import { errorFields, logger } from '../../server/logger';

const log = logger('auth:google');

const schema = z
  .object({
    credential: z.string().max(4000).optional(),
    code: z.string().max(2000).optional(),
  })
  .refine((v) => v.credential || v.code, {
    message: 'Either a Google credential or an authorisation code is required.',
  });

interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
}

export default handler({ methods: ['POST'], schema, rateLimit: 20 }, async ({ body }) => {
  if (!env.googleEnabled) {
    throw new ApiError(
      503,
      'GOOGLE_NOT_CONFIGURED',
      'Google sign-in is not configured on this deployment. Use email and password, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    );
  }

  const client = new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: env.googleRedirectUri,
  });

  let profile: GoogleProfile;

  try {
    if (body.credential) {
      // Identity Services button flow: verify the ID token signature and that
      // it was minted for THIS client id. Skipping the audience check would
      // accept a token issued for any other Google app.
      const ticket = await client.verifyIdToken({
        idToken: body.credential,
        audience: env.googleClientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) throw new Error('ID token contained no email');
      profile = {
        email: payload.email,
        name: payload.name ?? payload.email.split('@')[0],
        picture: payload.picture,
        emailVerified: Boolean(payload.email_verified),
      };
    } else {
      // Redirect flow: exchange the code, then verify the returned ID token.
      const { tokens } = await client.getToken(body.code as string);
      if (!tokens.id_token) throw new Error('Token exchange returned no ID token');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: env.googleClientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) throw new Error('ID token contained no email');
      profile = {
        email: payload.email,
        name: payload.name ?? payload.email.split('@')[0],
        picture: payload.picture,
        emailVerified: Boolean(payload.email_verified),
      };
    }
  } catch (err) {
    log.warn('Google verification failed', errorFields(err));
    throw new ApiError(401, 'GOOGLE_AUTH_FAILED', 'Could not verify your Google sign-in.');
  }

  if (!profile.emailVerified) {
    throw new ApiError(
      403,
      'EMAIL_NOT_VERIFIED',
      'Your Google account email is not verified.',
    );
  }

  const email = profile.email.toLowerCase().trim();
  // Default VIEWER; elevated only by env allowlist.
  const role = roleForEmail(email);

  const existing = await userRepo.findByEmail(email);

  const user: UserDocument = {
    id: existing?.id ?? newUserId(),
    name: profile.name,
    email,
    role,
    provider: 'google',
    avatarUrl: profile.picture,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  const saved = await userRepo.upsertByEmail(user);

  const { token, expiresAt } = await signToken({
    sub: saved.id,
    email: saved.email,
    role,
    name: saved.name,
  });

  await eventRepo.record('login_google', 'User signed in with Google', {
    userId: saved.id,
    role,
    isNew: !existing,
  });
  log.info('Google sign-in', { userId: saved.id, role, isNew: !existing });

  return {
    token,
    expiresAt,
    user: toPublicUser(stripSecrets({ ...saved, role })),
    permissions: permissionsFor(role),
  };
});
