export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { users, inviteCodes, pseuds } from '@/lib/schema';
import { hashPassword, createSession, setSessionCookie } from '@/lib/auth';
import { checkRateLimit, recordFailedAttempt, clearRateLimit } from '@/lib/rate-limit';
import { eq, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { invite_code, email, password, display_name } = body || {};
  if (!invite_code || !email || !password || !display_name) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (password.length < 8 || password.length > 128) {
    return new Response(JSON.stringify({ error: 'Password must be 8–128 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Basic email format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Rate limit by IP to prevent signup spam
  const rateLimitKey = (clientAddress || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const rateLimit = await checkRateLimit(d1, rateLimitKey, 'signup');
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: `Too many signup attempts. Try again in ${rateLimit.retryAfterSeconds}s.`, retryAfter: rateLimit.retryAfterSeconds }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfterSeconds) },
    });
  }

  const invite = await db
    .select({ id: inviteCodes.id, usedBy: inviteCodes.usedBy })
    .from(inviteCodes)
    .where(eq(inviteCodes.code, invite_code))
    .get();
  if (!invite) {
    await recordFailedAttempt(d1, rateLimitKey, 'signup');
    return new Response(JSON.stringify({ error: 'Invalid invite code' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (invite.usedBy !== null) {
    return new Response(JSON.stringify({ error: 'Invite code already used' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const passwordHash = await hashPassword(password);

  // New invite-code users require approval (approved = 0)
  // Founder can pre-approve via admin panel after signup
  const userResult = await db.insert(users).values({
    email,
    passwordHash,
    inviteCode: invite_code,
    approved: 0,
    createdAt: sql`(datetime('now'))`,
    updatedAt: sql`(datetime('now'))`,
  });
  const userId = userResult.meta.last_row_id as number;

  await db.update(inviteCodes)
    .set({ usedBy: userId, usedAt: sql`(datetime('now'))` })
    .where(eq(inviteCodes.id, invite.id));

  const pseudResult = await db.insert(pseuds).values({
    userId,
    name: display_name,
    createdAt: sql`(datetime('now'))`,
  });
  const pseudId = pseudResult.meta.last_row_id as number;

  // Clear rate limit on successful signup
  await clearRateLimit(d1, rateLimitKey, 'signup');

  const token = await createSession(d1, userId);

  return new Response(JSON.stringify({ id: userId, email, pseud_id: pseudId, approvalStatus: 'pending' }), {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': setSessionCookie(token) },
  });
};