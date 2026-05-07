/**
 * API Key authentication helpers.
 *
 * Key lifecycle:
 *   - Generation: 32-byte random → hex string. Store SHA-256 hash, show full key ONCE at creation.
 *   - Revocation: set revoked_at.
 *
 * Auth flow:
 *   - `Authorization: Bearer <key>` header on API requests
 *   - Hash incoming key → compare to stored hash → load user + key metadata
 *   - Revoked/expired keys return 401
 *   - Requests without API key use session auth or remain public (same as now)
 */

import { getDrizzle } from './db';
import { apiKeys, users } from './schema';
import { eq, and, isNull } from 'drizzle-orm';

/** Async SHA-256 hash → hex string using Web Crypto (Cloudflare Workers compatible). */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a new API key: returns the plaintext key (shown once) and its hash + prefix for storage. */
export async function generateApiKey(): Promise<{ plaintext: string; hash: string; prefix: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const plaintext = 'ffy_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const prefix = plaintext.slice(0, 12); // "ffy_" + first 8 hex chars
  const hash = await sha256Hex(plaintext);
  return { plaintext, hash, prefix };
}

/** Validate a Bearer token against stored API keys. Returns user + key metadata, or null. */
export async function validateApiKey(d1: D1Database, bearerToken: string): Promise<{
  user: { id: number; email: string; role: string; approved: number; banned: number };
  key: { id: number; name: string; rateLimitTier: string };
} | null> {
  const hash = await sha256Hex(bearerToken);
  const db = getDrizzle(d1);

  // Find non-revoked key by hash
  const keyRow = await db.select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .get();

  if (!keyRow) return null;

  // Load the user
  const userRow = await db.select({
    id: users.id,
    email: users.email,
    role: users.role,
    approved: users.approved,
    banned: users.banned,
  })
    .from(users)
    .where(eq(users.id, keyRow.userId))
    .get();

  if (!userRow || userRow.banned) return null;

  // Update last_used_at (fire-and-forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString().replace('T', ' ').split('.')[0] })
    .where(eq(apiKeys.id, keyRow.id))
    .run()
    .catch(() => {});

  return {
    user: userRow,
    key: {
      id: keyRow.id,
      name: keyRow.name,
      rateLimitTier: keyRow.rateLimitTier,
    },
  };
}

/** Extract Bearer token from Authorization header. Returns null if not present. */
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(ffy_[a-f0-9]+)$/i);
  return match ? match[1] : null;
}