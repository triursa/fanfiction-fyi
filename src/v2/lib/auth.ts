/**
 * v2 Auth helpers — email/password only, no OAuth.
 *
 * Session flow:
 * 1. POST /api/auth/signup — email + password + invite code → create user → create session → set cookie
 * 2. POST /api/auth/login — email + password → validate → create session → set cookie
 * 3. POST /api/auth/logout — delete session → clear cookie
 * 4. Middleware reads session cookie on every request → sets context.locals.user
 *
 * Password hashing uses Web Crypto (SHA-256 + salt) for Cloudflare Workers compatibility.
 */

import { eq } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';
import { users, sessions, inviteCodes } from './schema/index';
import { getDb } from './db';

const SESSION_DAYS = 30;
const SESSION_COOKIE_NAME = 'ffy_session';
const SALT_LENGTH = 16;

// ─── Password Hashing ────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const saltHex = bufferToHex(salt);
  const hash = await sha256Hex(saltHex + password);
  return saltHex + ':' + hash;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, storedHash] = stored.split(':');
  if (!saltHex || !storedHash) return false;
  const hash = await sha256Hex(saltHex + password);
  return hash === storedHash;
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return bufferToHex(new Uint8Array(hash));
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Session Management ──────────────────────────────────────────

export async function createSession(d1: D1Database, userId: number): Promise<string> {
  const token = bufferToHex(crypto.getRandomValues(new Uint8Array(32)));
  const db = getDb(d1);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.insert(sessions).values({ userId, token, expiresAt });
  return token;
}

export async function getSession(d1: D1Database, token: string) {
  const db = getDb(d1);
  const result = await db.select().from(sessions).where(eq(sessions.token, token)).get();
  if (!result) return null;
  if (new Date(result.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.token, token));
    return null;
  }
  const user = await db.select().from(users).where(eq(users.id, result.userId)).get();
  if (!user) return null;
  if (user.banned) {
    await db.delete(sessions).where(eq(sessions.token, token));
    return null;
  }
  return { session: result, user };
}

export async function deleteSession(d1: D1Database, token: string): Promise<void> {
  const db = getDb(d1);
  await db.delete(sessions).where(eq(sessions.token, token));
}

// ─── Auth Helpers for Route Handlers ─────────────────────────────

export interface AuthResult {
  user: typeof users.$inferSelect;
  session: typeof sessions.$inferSelect;
}

/**
 * Get auth from request. Returns null if no valid session (doesn't throw).
 */
export async function getAuth(d1: D1Database, request: Request): Promise<AuthResult | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  const result = await getSession(d1, token);
  if (!result) return null;
  return { user: result.user, session: result.session };
}

/**
 * Require auth. Returns auth or throws a 401 Response.
 */
export async function requireAuth(d1: D1Database, request: Request): Promise<AuthResult> {
  const auth = await getAuth(d1, request);
  if (!auth) throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  return auth;
}

/**
 * Check if user is approved. Returns auth or throws appropriate error.
 */
export function checkApproved(auth: AuthResult): AuthResult {
  if (auth.user.banned) {
    throw new Response(JSON.stringify({ error: 'Banned' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (!auth.user.approved) {
    throw new Response(JSON.stringify({ error: 'Unapproved' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (auth.user.suspendedUntil && new Date(auth.user.suspendedUntil) > new Date()) {
    throw new Response(JSON.stringify({ error: 'Suspended', suspendedUntil: auth.user.suspendedUntil }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  return auth;
}

// ─── Invite Code Validation ──────────────────────────────────────

export async function validateInviteCode(d1: D1Database, code: string): Promise<{ valid: boolean; error?: string }> {
  const db = getDb(d1);
  const invite = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).get();
  if (!invite) return { valid: false, error: 'Invalid invite code' };
  if (invite.usedBy) return { valid: false, error: 'Invite code already used' };
  return { valid: true };
}

export async function markInviteCodeUsed(d1: D1Database, code: string, userId: number): Promise<void> {
  const db = getDb(d1);
  await db.update(inviteCodes).set({ usedBy: userId, usedAt: new Date().toISOString() }).where(eq(inviteCodes.code, code));
}

// ─── Cookie Helpers ──────────────────────────────────────────────

export function getSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

export function sessionCookie(token: string, maxAge: number = SESSION_DAYS * 24 * 60 * 60): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export { SESSION_COOKIE_NAME, SESSION_DAYS };