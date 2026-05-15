export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth, verifyPassword } from '@/lib/auth';
import { getDrizzle } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';

/**
 * PUT /api/user/email — change authenticated user's email
 * Accepts: { email, current_password }
 */
export const PUT: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: 5 per 5min per user
  const rlKey = `user:${auth.user.id}`;
  const rl = await checkRateLimit(d1, rlKey, 'change-email');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }
  await recordFailedAttempt(d1, rlKey, 'change-email');

  let body: { email?: string; current_password?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { email, current_password } = body;

  if (!email || typeof email !== 'string') {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (email.length > 254) {
    return new Response(JSON.stringify({ error: 'Email is too long' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify current password
  if (!current_password) {
    return new Response(JSON.stringify({ error: 'Current password is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (auth.user.passwordHash) {
    const { valid } = await verifyPassword(current_password, auth.user.passwordHash);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Check if email is already taken
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (existing && existing.id !== auth.user.id) {
    return new Response(JSON.stringify({ error: 'Email is already in use' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update email
  await db.update(users).set({
    email,
    updatedAt: sql`datetime('now')`,
  }).where(eq(users.id, auth.user.id));

  return new Response(JSON.stringify({ success: true, email }), {
    headers: { 'Content-Type': 'application/json' },
  });
};