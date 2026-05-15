export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { users } from '@/lib/schema';
import { requireRole } from '@/lib/auth';
import { UserRole } from '@/lib/types';
import { logAudit } from '@/lib/audit';
import { eq, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const userId = Number(params.id);
  if (!userId || isNaN(userId)) {
    return new Response(JSON.stringify({ error: 'Invalid user ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Require admin+ role
  const auth = await requireRole(d1, request, UserRole.Admin);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if ('forbidden' in auth) return new Response(JSON.stringify({ error: 'Insufficient role' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const duration = Number(body.duration);
  if (!duration || duration <= 0) {
    return new Response(JSON.stringify({ error: 'Duration (hours) is required and must be positive' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Can't suspend a founder
  const targetUser = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!targetUser) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (targetUser.role === UserRole.Founder) {
    return new Response(JSON.stringify({ error: 'Cannot suspend founder' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await db.update(users)
    .set({ suspendedUntil: sql.raw(`datetime('now', '+${Number(duration)} hours')`), updatedAt: sql`(datetime('now'))` })
    .where(eq(users.id, userId));

  const updatedUser = await db
    .select({ id: users.id, email: users.email, role: users.role, banned: users.banned, suspendedUntil: users.suspendedUntil })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  await logAudit(d1, auth.user.id, 'user.suspend', 'user', userId, { duration_hours: duration, reason: body.reason });
  return new Response(JSON.stringify({ ok: true, user: updatedUser }), { headers: { 'Content-Type': 'application/json' } });
};