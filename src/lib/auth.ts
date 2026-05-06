import type { UserRole } from './types';
import { ROLE_LEVEL } from './types';
import { getDrizzle } from './db';
import { users, sessions, pseuds } from './schema';
import { eq, and, gt, sql } from 'drizzle-orm';

// Re-export Drizzle-inferred types for use across the app
export type UserRow = typeof users.$inferSelect;
export type PseudRow = typeof pseuds.$inferSelect;

const SESSION_COOKIE = 'session';
const SESSION_DAYS = 30;

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2Derive(password: string, salt: string, iterations: number): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16); // 32 hex chars
  const hash = await pbkdf2Derive(password, salt, PBKDF2_ITERATIONS);
  return `${salt}$${PBKDF2_ITERATIONS}$${hash}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!stored) return { valid: false, needsRehash: false };
  const parts = stored.split('$');

  if (parts.length === 3) {
    // New PBKDF2 format: salt$iterations$hash
    const [salt, iterStr, hashHex] = parts;
    const iterations = parseInt(iterStr, 10);
    if (!salt || !iterStr || !hashHex) return { valid: false, needsRehash: false };
    const computed = await pbkdf2Derive(password, salt, iterations);
    const valid = constantTimeEqual(computed, hashHex);
    return { valid, needsRehash: valid && iterations !== PBKDF2_ITERATIONS };
  }

  if (parts.length === 2) {
    // Legacy SHA-256 format: salt$hash — verify with old method, then flag for rehash
    const [salt, hashHex] = parts;
    if (!salt || !hashHex) return { valid: false, needsRehash: false };
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const computed = bufToHex(hash);
    const valid = constantTimeEqual(computed, hashHex);
    return { valid, needsRehash: valid };
  }

  return { valid: false, needsRehash: false };
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const drizzle = getDrizzle(db);
  const token = randomHex(32); // 64 hex chars
  await drizzle.insert(sessions).values({
    userId,
    token,
    createdAt: sql`(datetime('now'))`,
    expiresAt: sql`(datetime('now', '+${SESSION_DAYS} days'))`,
  });
  return token;
}

export async function getUserFromSession(db: D1Database, token: string): Promise<{ user: UserRow; pseuds: PseudRow[] } | null> {
  if (!token) return null;
  const drizzle = getDrizzle(db);
  const session = await drizzle
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, sql`(datetime('now'))`)))
    .get();
  if (!session) return null;

  const user = await drizzle
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user) return null;
  const pseudRows = await drizzle
    .select()
    .from(pseuds)
    .where(eq(pseuds.userId, session.userId));
  return { user, pseuds: pseudRows };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  const drizzle = getDrizzle(db);
  await drizzle.delete(sessions).where(eq(sessions.token, token));
}

// Utility for API routes — reads Astro request, returns auth info
export async function getAuth(
  db: D1Database,
  request: Request
): Promise<{ user: UserRow; pseuds: PseudRow[] } | null> {
  const cookie = request.headers.get('cookie') ?? '';
  const token = parseCookie(cookie)[SESSION_COOKIE];
  if (!token) return null;
  return getUserFromSession(db, token);
}

// Require auth for API routes (returns null if missing — callers must check and return 401)
export async function requireAuth(
  db: D1Database,
  request: Request
): Promise<{ user: UserRow; pseuds: PseudRow[] } | null> {
  const auth = await getAuth(db, request);
  return auth;
}

// Check if a user is approved (not banned, not suspended, and approved = 1)
// Returns: null if unauthenticated, { forbidden: 'banned' } if banned,
//   { forbidden: 'suspended', suspendedUntil: string } if suspended,
//   { forbidden: 'unapproved' } if not yet approved, or the auth info if OK
export function checkApproved(auth: { user: UserRow; pseuds: PseudRow[] } | null):
  | { user: UserRow; pseuds: PseudRow[] }
  | { forbidden: 'banned' | 'suspended' | 'unapproved'; suspendedUntil?: string }
  | null {
  if (!auth) return null;
  if (auth.user.banned) return { forbidden: 'banned' };
  if (auth.user.suspendedUntil) {
    const suspendedTime = new Date(auth.user.suspendedUntil + 'Z').getTime();
    if (Date.now() < suspendedTime) {
      return { forbidden: 'suspended', suspendedUntil: auth.user.suspendedUntil };
    }
  }
  if (!auth.user.approved) return { forbidden: 'unapproved' };
  return auth;
}

// Require a minimum role level (founder > admin > mod > user)
// Returns null if unauthenticated, { forbidden: true } if role insufficient, or auth info if OK
export async function requireRole(
  db: D1Database,
  request: Request,
  minimumRole: UserRole
): Promise<{ user: UserRow; pseuds: PseudRow[] } | { forbidden: true } | null> {
  const auth = await requireAuth(db, request);
  if (!auth) return null;
  const userLevel = ROLE_LEVEL[auth.user.role as UserRole] ?? 0;
  const requiredLevel = ROLE_LEVEL[minimumRole] ?? 0;
  if (userLevel < requiredLevel) return { forbidden: true };
  return auth;
}

export function setSessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function parseCookie(cookie: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = v.join('=').trim();
  }
  return out;
}