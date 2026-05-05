export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { users } from '@/lib/schema';
import { requireRole, getAuth } from '@/lib/auth';
import { UserRole, ROLE_LEVEL } from '@/lib/types';
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

  // Handle role change
  if (body.role !== undefined) {
    const validRoles = [UserRole.Admin, UserRole.Mod, UserRole.User];
    if (!validRoles.includes(body.role)) {
      return new Response(JSON.stringify({ error: 'Invalid role. Allowed: admin, mod, user' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Can't change founder's role
    const targetUser = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (targetUser.role === UserRole.Founder) {
      return new Response(JSON.stringify({ error: 'Cannot change founder role' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await db.update(users)
      .set({ role: body.role, updatedAt: sql`(datetime('now'))` })
      .where(eq(users.id, userId));
    return new Response(JSON.stringify({ ok: true, role: body.role }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Handle ban/activate toggle
  if (body.banned !== undefined) {
    const banned = body.banned ? 1 : 0;
    const targetUser = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (targetUser.role === UserRole.Founder) {
      return new Response(JSON.stringify({ error: 'Cannot ban founder' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await db.update(users)
      .set({ banned, updatedAt: sql`(datetime('now'))` })
      .where(eq(users.id, userId));
    return new Response(JSON.stringify({ ok: true, banned }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Handle approve/reject toggle
  if (body.approved !== undefined) {
    const approved = body.approved ? 1 : 0;
    const targetUser = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (targetUser.role === UserRole.Founder) {
      return new Response(JSON.stringify({ error: 'Cannot modify founder approval' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await db.update(users)
      .set({ approved, updatedAt: sql`(datetime('now'))` })
      .where(eq(users.id, userId));
    return new Response(JSON.stringify({ ok: true, approved }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'No action specified. Send {role}, {banned}, or {approved}' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
};