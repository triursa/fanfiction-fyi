export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { requireRole, getAuth } from '@/lib/auth';
import { UserRole, ROLE_LEVEL } from '@/lib/types';
import type { APIRoute } from 'astro';

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const userId = Number(params.id);
  if (!userId || isNaN(userId)) {
    return new Response(JSON.stringify({ error: 'Invalid user ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Require admin+ role
  const auth = await requireRole(db, request, UserRole.Admin);
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
    const targetUser = await queryFirst<{ id: number; role: string }>(db, `SELECT id, role FROM users WHERE id = ?1`, userId);
    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (targetUser.role === UserRole.Founder) {
      return new Response(JSON.stringify({ error: 'Cannot change founder role' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await run(db, `UPDATE users SET role = ?1, updated_at = datetime('now') WHERE id = ?2`, body.role, userId);
    return new Response(JSON.stringify({ ok: true, role: body.role }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Handle ban/activate toggle
  if (body.banned !== undefined) {
    const banned = body.banned ? 1 : 0;
    const targetUser = await queryFirst<{ id: number; role: string }>(db, `SELECT id, role FROM users WHERE id = ?1`, userId);
    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (targetUser.role === UserRole.Founder) {
      return new Response(JSON.stringify({ error: 'Cannot ban founder' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await run(db, `UPDATE users SET banned = ?1, updated_at = datetime('now') WHERE id = ?2`, banned, userId);
    return new Response(JSON.stringify({ ok: true, banned }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Handle approve/reject toggle
  if (body.approved !== undefined) {
    const approved = body.approved ? 1 : 0;
    const targetUser = await queryFirst<{ id: number; role: string }>(db, `SELECT id, role FROM users WHERE id = ?1`, userId);
    if (!targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (targetUser.role === UserRole.Founder) {
      return new Response(JSON.stringify({ error: 'Cannot modify founder approval' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    await run(db, `UPDATE users SET approved = ?1, updated_at = datetime('now') WHERE id = ?2`, approved, userId);
    return new Response(JSON.stringify({ ok: true, approved }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'No action specified. Send {role}, {banned}, or {approved}' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
};