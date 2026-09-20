/**
 * Authentication and authorisation.
 *
 * Tokens are signed JWTs (HS256 via `jose`, which works on both the Node and
 * Edge runtimes). Passwords are hashed with bcrypt.
 *
 * AUTHORISATION IS ENFORCED HERE, SERVER-SIDE.
 * The frontend hides controls a role cannot use, but hiding a button is
 * cosmetic — every privileged route calls `requireRole` and a Viewer POSTing
 * directly to /api/alerts/:id/acknowledge is rejected with 403. See §55 of the
 * specification: "Do not merely hide actions visually."
 */

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

import type { Role, User } from '../shared/types.js';
import { env } from './env.js';
import { errorFields, logger } from './logger.js';

const log = logger('auth');

/** bcrypt cost. 10 is ~60 ms — meaningful against offline cracking, and fast
 *  enough not to blow a serverless function's budget. */
const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

/** Minimum viable policy. Rejected at signup with specific, actionable reasons. */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < 10) problems.push('must be at least 10 characters');
  if (!/[a-z]/.test(password)) problems.push('must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('must contain an uppercase letter');
  if (!/[0-9]/.test(password)) problems.push('must contain a digit');
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface TokenClaims {
  sub: string;
  email: string;
  role: Role;
  name: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.authSecret);
}

export async function signToken(claims: TokenClaims): Promise<{ token: string; expiresAt: string }> {
  const ttl = env.tokenTtl;
  const expiresAt = new Date(Date.now() + parseTtlMs(ttl));

  const token = await new SignJWT({ email: claims.email, role: claims.role, name: claims.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('gridsync')
    .setAudience('gridsync-web')
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());

  return { token, expiresAt: expiresAt.toISOString() };
}

export async function verifyToken(token: string): Promise<TokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'gridsync',
      audience: 'gridsync-web',
    });
    if (!payload.sub || !payload.role) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      role: payload.role as Role,
      name: String(payload.name ?? ''),
    };
  } catch (err) {
    // Expired or tampered tokens are routine; log at debug, never warn.
    log.debug('Token verification failed', errorFields(err));
    return null;
  }
}

function parseTtlMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 12 * 3600_000;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 3600_000);
}

// ---------------------------------------------------------------------------
// Roles and permissions
// ---------------------------------------------------------------------------

export type Permission =
  | 'view:dashboard'
  | 'view:analytics'
  | 'view:telemetry'
  | 'view:diagnostics'
  | 'view:maintenance'
  | 'view:ai'
  | 'alerts:acknowledge'
  | 'alerts:resolve'
  | 'simulation:control'
  | 'settings:write'
  | 'users:manage'
  | 'mode:switch'
  | 'reports:generate';

/**
 * Role -> permission matrix.
 *
 * Deliberately explicit rather than hierarchical: "Technician can do everything
 * Operator can" is not actually true here — a Technician gets diagnostics but
 * not operational alert control, which a strict hierarchy would get wrong.
 */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [
    'view:dashboard',
    'view:analytics',
    'view:telemetry',
    'view:diagnostics',
    'view:maintenance',
    'view:ai',
    'alerts:acknowledge',
    'alerts:resolve',
    'simulation:control',
    'settings:write',
    'users:manage',
    'mode:switch',
    'reports:generate',
  ],
  OPERATOR: [
    'view:dashboard',
    'view:analytics',
    'view:telemetry',
    'view:ai',
    'alerts:acknowledge',
    'alerts:resolve',
    'simulation:control',
    'reports:generate',
  ],
  TECHNICIAN: [
    'view:dashboard',
    'view:analytics',
    'view:telemetry',
    'view:diagnostics',
    'view:maintenance',
    'view:ai',
    'alerts:acknowledge',
    'reports:generate',
  ],
  // Viewer is strictly read-only. No acknowledge, no resolve, no controls.
  VIEWER: ['view:dashboard', 'view:analytics', 'view:telemetry', 'view:ai'],
};

export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.VIEWER;
}

export function can(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

// ---------------------------------------------------------------------------
// Google OAuth role resolution
// ---------------------------------------------------------------------------

/**
 * Map a Google-authenticated email to a role.
 *
 * Default is VIEWER. Elevation requires the address to appear in an env
 * allowlist — privileged emails are never hardcoded in source.
 */
export function roleForEmail(email: string): Role {
  const normalised = email.toLowerCase().trim();
  if (env.adminEmails.includes(normalised)) return 'ADMIN';
  if (env.operatorEmails.includes(normalised)) return 'OPERATOR';
  if (env.technicianEmails.includes(normalised)) return 'TECHNICIAN';
  return 'VIEWER';
}

/** Public-safe user projection. */
export function toPublicUser(user: User): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    provider: user.provider,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    mustChangePassword: user.mustChangePassword,
  };
}

export function newUserId(): string {
  return `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
