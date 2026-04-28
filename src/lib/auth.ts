import type { User, Pseud, UserRole } from './types';
import { ROLE_LEVEL } from './types';
import { queryFirst, run, queryAll } from './db';

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

export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16); // 32 hex chars
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return `${salt}$${bufToHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split('$');
  if (!salt || !hashHex) return false;
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const computed = bufToHex(hash);
  // constant-time-ish compare
  if (hashHex.length !== computed.length) return false;
  let result = 0;
  for (let i = 0; i < hashHex.length; i++) {
    result |= hashHex.charCodeAt(i) ^ computed.charCodeAt(i);
  }
  return result === 0;
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = randomHex(32); // 64 hex chars
  const stmt = `
    INSERT INTO sessions (user_id, token, created_at, expires_at)
    VALUES (?1, ?2, datetime('now'), datetime('now', '+${SESSION_DAYS} days'))
  `;
  await run(db, stmt, userId, token);
  return token;
}

export async function getUserFromSession(db: D1Database, token: string): Promise<{ user: User; pseuds: Pseud[] } | null> {
  if (!token) return null;
  const row = await queryFirst<{ user_id: number }>(
    db,
    `SELECT user_id FROM sessions WHERE token = ?1 AND expires_at > datetime('now')`,
    token
  );
  if (!row) return null;

  const user = await queryFirst<User>(db, `SELECT * FROM users WHERE id = ?1`, row.user_id);
  if (!user) return null;
  const pseuds = await queryAll<Pseud>(db, `SELECT * FROM pseuds WHERE user_id = ?1`, row.user_id);
  return { user, pseuds };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await run(db, `DELETE FROM sessions WHERE token = ?1`, token);
}

// Utility for API routes — reads Astro request, returns auth info
export async function getAuth(
  db: D1Database,
  request: Request
): Promise<{ user: User; pseuds: Pseud[] } | null> {
  const cookie = request.headers.get('cookie') ?? '';
  const token = parseCookie(cookie)[SESSION_COOKIE];
  if (!token) return null;
  return getUserFromSession(db, token);
}

// Require auth for API routes (returns null if missing — callers must check and return 401)
export async function requireAuth(
  db: D1Database,
  request: Request
): Promise<{ user: User; pseuds: Pseud[] } | null> {
  const auth = await getAuth(db, request);
  return auth;
}

// Require a minimum role level (founder > admin > mod > user)
// Returns null if unauthenticated, { forbidden: true } if role insufficient, or auth info if OK
export async function requireRole(
  db: D1Database,
  request: Request,
  minimumRole: UserRole
): Promise<{ user: User; pseuds: Pseud[] } | { forbidden: true } | null> {
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
