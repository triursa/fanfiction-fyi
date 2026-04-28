export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth';
import { checkRateLimit, recordFailedAttempt, clearRateLimit } from '@/lib/rate-limit';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const db = locals.runtime.env.DB as D1Database;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Rate limit by email (prevent brute-force on specific accounts)
  const rateLimit = await checkRateLimit(db, email.toLowerCase(), 'login');
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: `Too many login attempts. Try again in ${rateLimit.retryAfterSeconds}s.`, retryAfter: rateLimit.retryAfterSeconds }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfterSeconds) },
    });
  }

  const user = await queryFirst<any>(db, `SELECT * FROM users WHERE email = ?1`, email);
  if (!user) {
    await recordFailedAttempt(db, email.toLowerCase(), 'login');
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await recordFailedAttempt(db, email.toLowerCase(), 'login');
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // Clear rate limit on successful login
  await clearRateLimit(db, email.toLowerCase(), 'login');

  const token = await createSession(db, user.id);

  const pseuds = await queryAll<any>(db, `SELECT * FROM pseuds WHERE user_id = ?1`, user.id);

  return new Response(JSON.stringify({ user: { id: user.id, email: user.email, role: user.role }, pseuds }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': setSessionCookie(token) },
  });
};