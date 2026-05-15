export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth, hashPassword, verifyPassword } from '@/lib/auth';
import { getDrizzle } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';

/**
 * POST /api/user/password — change or set password for authenticated user
 * Accepts: { current_password, new_password }
 * If user has password_hash: verify current_password first
 * If user has NO password_hash (OAuth-only): current_password can be empty
 * D1 eventual consistency: changes may take 500-800ms to be visible in subsequent reads
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: 5 per 5min per user ID
  const rlKey = `user:${auth.user.id}`;
  const rl = await checkRateLimit(d1, rlKey, 'change-password');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rl.retryAfterSeconds),
      },
    });
  }
  await recordFailedAttempt(d1, rlKey, 'change-password');

  let body: { current_password?: string; new_password?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { current_password = '', new_password } = body;

  if (!new_password || new_password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (new_password.length > 128) {
    return new Response(JSON.stringify({ error: 'Password must be 128 characters or fewer' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // If user has existing password, verify current_password
  if (auth.user.passwordHash) {
    const { valid } = await verifyPassword(current_password, auth.user.passwordHash);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  // If user has NO passwordHash (OAuth-only), skip current_password check

  const hashed = await hashPassword(new_password);
  await db.update(users).set({
    passwordHash: hashed,
    updatedAt: sql`datetime('now')`,
  }).where(eq(users.id, auth.user.id));

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};