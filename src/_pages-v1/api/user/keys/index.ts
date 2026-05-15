export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { apiKeys } from '@/lib/schema';
import { generateApiKey } from '@/lib/api-keys';
import { eq, and, isNull, desc } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/** GET /api/user/keys — list all non-revoked API keys for the current user */
export const GET: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const db = getDrizzle(d1);
  const userId = auth.user.id;

  const keys = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    keyPrefix: apiKeys.keyPrefix,
    rateLimitTier: apiKeys.rateLimitTier,
    lastUsedAt: apiKeys.lastUsedAt,
    createdAt: apiKeys.createdAt,
  })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));

  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

/** POST /api/user/keys — create a new API key */
export const POST: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const name = (body?.name || '').trim();
  if (!name || name.length > 64) {
    return new Response(JSON.stringify({ error: 'Key name is required (max 64 characters)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Limit: max 5 active keys per user
  const db = getDrizzle(d1);
  const userId = auth.user.id;
  const existing = await db.select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .all();

  if (existing.length >= 5) {
    return new Response(JSON.stringify({ error: 'Maximum of 5 active API keys reached. Revoke an existing key first.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Generate key
  const { plaintext, hash, prefix } = await generateApiKey();

  await db.insert(apiKeys).values({
    userId,
    name,
    keyHash: hash,
    keyPrefix: prefix,
    rateLimitTier: 'free',
  });

  // Return the plaintext key ONCE — this is the only time the user sees it
  return new Response(JSON.stringify({
    key: {
      name,
      prefix,
      secret: plaintext, // Full key — shown once only
      rateLimitTier: 'free',
    },
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};