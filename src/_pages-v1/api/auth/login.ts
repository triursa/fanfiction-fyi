export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { users, pseuds } from '@/lib/schema';
import { verifyPassword, hashPassword, createSession, setSessionCookie } from '@/lib/auth';
import { checkRateLimit, recordFailedAttempt, clearRateLimit } from '@/lib/rate-limit';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Rate limit by email (prevent brute-force on specific accounts)
  const rateLimit = await checkRateLimit(d1, email.toLowerCase(), 'login');
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: `Too many login attempts. Try again in ${rateLimit.retryAfterSeconds}s.`, retryAfter: rateLimit.retryAfterSeconds }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfterSeconds) },
    });
  }

  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    await recordFailedAttempt(d1, email.toLowerCase(), 'login');
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // OAuth-only users have no password set — guide them to sign in with Google
  if (user.passwordHash === null) {
    return new Response(JSON.stringify({ error: 'no_password', message: 'This account uses Google sign-in' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedAttempt(d1, email.toLowerCase(), 'login');
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // Transparently upgrade legacy SHA-256 hashes to PBKDF2 on successful login
  if (needsRehash) {
    const newHash = await hashPassword(password);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
  }

  // Clear rate limit on successful login
  await clearRateLimit(d1, email.toLowerCase(), 'login');

  // Banned users cannot log in
  if (user.banned) {
    return new Response(JSON.stringify({ error: 'banned' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Unapproved users can log in but are redirected to pending-approval
  // Return a special flag so the frontend knows where to send them
  const approvalStatus = user.approved ? 'approved' : 'pending';

  const token = await createSession(d1, user.id);

  const userPseuds = await db.select().from(pseuds).where(eq(pseuds.userId, user.id));

  return new Response(JSON.stringify({ user: { id: user.id, email: user.email, role: user.role, approved: user.approved }, pseuds: userPseuds, approvalStatus }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': setSessionCookie(token) },
  });
};