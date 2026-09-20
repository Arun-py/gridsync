/**
 * Auth route implementations, dispatched by api/auth/[action].ts.
 *
 * Consolidated into one file (from four separate route files) to stay under
 * Vercel's per-deployment serverless function cap — see api/auth/[action].ts.
 */

import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

import { ApiError, handler } from '../handler';
import {
  checkPasswordPolicy,
  hashPassword,
  newUserId,
  permissionsFor,
  roleForEmail,
  signToken,
  toPublicUser,
  verifyPassword,
} from '../../../server/auth';
import { env } from '../../../server/env';
import { eventRepo, stripSecrets, userRepo, type UserDocument } from '../../../server/repositories';
import { errorFields, logger } from '../../../server/logger';

// ---------------------------------------------------------------------------
// POST /api/auth/login — email + password.
//
// Returns an identical error for "unknown email" and "wrong password", and
// performs a dummy bcrypt comparison when the user does not exist. Without
// that, response timing reveals which emails are registered.
// ---------------------------------------------------------------------------

const loginLog = logger('auth:login');

const loginSchema = z.object({
  email: z.string().email('A valid email address is required.').max(200),
  password: z.string().min(1, 'Password is required.').max(200),
});

/** Constant-ish work factor for the "no such user" path. */
let dummyHash: string | null = null;
async function dummyCompare(password: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword('gridsync-timing-equaliser');
  await verifyPassword(password, dummyHash);
}

export const loginHandler = handler(
  {
    methods: ['POST'],
    schema: loginSchema,
    // Tight limit: this is the endpoint worth brute-forcing.
    rateLimit: 10,
  },
  async ({ body }) => {
    const email = body.email.toLowerCase().trim();
    const user = await userRepo.findByEmail(email);

    if (!user || !user.passwordHash) {
      await dummyCompare(body.password);
      loginLog.warn('Failed login', { emailDomain: email.split('@')[1] });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      loginLog.warn('Failed login', { emailDomain: email.split('@')[1] });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    }

    const { token, expiresAt } = await signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    await eventRepo.record('login', 'User signed in', { userId: user.id, role: user.role });
    loginLog.info('Login succeeded', { userId: user.id, role: user.role });

    return {
      token,
      expiresAt,
      user: toPublicUser(stripSecrets(user)),
      permissions: permissionsFor(user.role),
    };
  },
);

// ---------------------------------------------------------------------------
// POST /api/auth/signup — self-service registration.
//
// SECURITY FIX CARRIED FROM v1
// The original Flask endpoint accepted `role` from the request body, so anyone
// could register as an administrator. Here the role is NEVER taken from the
// client: self-registered accounts are VIEWER, and elevation happens only via
// the env allowlist or by an existing ADMIN through /api/users.
// ---------------------------------------------------------------------------

const signupLog = logger('auth:signup');

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80),
  email: z.string().email('A valid email address is required.').max(200),
  password: z.string().min(1, 'Password is required.').max(200),
  // Deliberately NOT accepting `role`. Any role sent by a client is ignored.
});

export const signupHandler = handler(
  { methods: ['POST'], schema: signupSchema, rateLimit: 5 },
  async ({ body }) => {
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
    signupLog.info('Account created', { userId: user.id, role });

    return {
      token,
      expiresAt,
      user: toPublicUser(user),
      permissions: permissionsFor(role),
    };
  },
);

// ---------------------------------------------------------------------------
// GET /api/auth/me — current session.
//
// The role is re-read from the DATABASE rather than trusted from the token, so
// a role change takes effect on the next request instead of waiting out the
// token's lifetime. Permissions are returned alongside so the UI can render the
// right controls — though the server enforces them regardless.
// ---------------------------------------------------------------------------

export const meHandler = handler({ methods: ['GET'], auth: true }, async ({ user }) => {
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

// ---------------------------------------------------------------------------
// POST /api/auth/google — Google OAuth sign-in.
//
// Accepts either:
//   { credential }  an ID token from Google Identity Services (the button flow)
//   { code }        an authorisation code from the redirect flow
//
// ROLE ASSIGNMENT (spec §11)
// A Google-authenticated user is a VIEWER unless their email appears in
// ADMIN_EMAILS / OPERATOR_EMAILS / TECHNICIAN_EMAILS. Those lists live in
// environment variables — privileged addresses are never in source.
//
// The role is re-evaluated on every sign-in, so removing an address from an
// allowlist demotes that user the next time they authenticate.
// ---------------------------------------------------------------------------

const googleLog = logger('auth:google');

const googleSchema = z
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

export const googleHandler = handler(
  { methods: ['POST'], schema: googleSchema, rateLimit: 20 },
  async ({ body }) => {
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
      googleLog.warn('Google verification failed', errorFields(err));
      throw new ApiError(401, 'GOOGLE_AUTH_FAILED', 'Could not verify your Google sign-in.');
    }

    if (!profile.emailVerified) {
      throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Your Google account email is not verified.');
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
    googleLog.info('Google sign-in', { userId: saved.id, role, isNew: !existing });

    return {
      token,
      expiresAt,
      user: toPublicUser(stripSecrets({ ...saved, role })),
      permissions: permissionsFor(role),
    };
  },
);
