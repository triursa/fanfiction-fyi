export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { users, sessions } from '@/lib/schema';
import { createSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/**
 * GET /api/auth/google/debug
 * Temporary debug endpoint — REMOVE AFTER DEBUGGING.
 */
export const GET: APIRoute = async ({ locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const env = locals.runtime.env;

  const results: Record<string, any> = {};

  // 1. Check env vars
  results.env = {
    hasClientId: !!(env.GOOGLE_CLIENT_ID),
    clientIdLen: (env.GOOGLE_CLIENT_ID as string)?.length || 0,
    hasClientSecret: !!(env.GOOGLE_CLIENT_SECRET),
    clientSecretLen: (env.GOOGLE_CLIENT_SECRET as string)?.length || 0,
    hasFounderEmail: !!(env.FOUNDER_EMAIL),
    founderEmail: (env.FOUNDER_EMAIL as string)?.slice(0, 5) + '...' || 'MISSING',
    hasDB: !!env.DB,
  };

  // 2. Test D1 connection
  try {
    const db = getDrizzle(d1);
    const existingUser = await db.select({ id: users.id }).from(users).limit(1).get();
    results.d1 = { ok: true, sampleUser: existingUser };
  } catch (e: any) {
    results.d1 = { ok: false, error: e.message, stack: e.stack?.slice(0, 300) };
  }

  // 3. Test createSession
  try {
    const db = getDrizzle(d1);
    const existingUser = await db.select({ id: users.id }).from(users).limit(1).get();
    if (existingUser) {
      const token = await createSession(d1, existingUser.id);
      results.createSession = { ok: true, tokenLen: token.length };
      // Clean up
      await db.delete(sessions).where(eq(sessions.token, token));
    } else {
      results.createSession = { skipped: true, reason: 'No users in DB' };
    }
  } catch (e: any) {
    results.createSession = { ok: false, error: e.message, stack: e.stack?.slice(0, 500) };
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};