export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { apiKeys } from '@/lib/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/** DELETE /api/user/keys/[id] — revoke an API key */
export const DELETE: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const keyId = Number(params.id);
  if (!keyId || isNaN(keyId)) {
    return new Response(JSON.stringify({ error: 'Invalid key ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDrizzle(d1);
  const userId = auth.user.id;

  // Only allow revoking own keys that are not already revoked
  const key = await db.select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .get();

  if (!key) {
    return new Response(JSON.stringify({ error: 'Key not found or already revoked' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  await db.update(apiKeys)
    .set({ revokedAt: now })
    .where(eq(apiKeys.id, keyId));

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};