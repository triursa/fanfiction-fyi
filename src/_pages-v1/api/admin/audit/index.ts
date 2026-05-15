export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { UserRole } from '@/lib/types';
import { auditLog } from '@/lib/schema';
import { users } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/**
 * GET /api/admin/audit — retrieve audit log entries (mod+ only)
 * Query params: ?page=1&limit=50
 */
export const GET: APIRoute = async ({ locals, request, url }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireRole(d1, request, UserRole.Mod);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if ('forbidden' in auth) return new Response(JSON.stringify({ error: 'Insufficient role' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const offset = (page - 1) * limit;

  const db = getDrizzle(d1);
  const entries = await db
    .select({
      id: auditLog.id,
      actorId: auditLog.actorId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
      actorEmail: users.email,
      actorRole: users.role,
    })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.actorId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return new Response(JSON.stringify({
    entries: entries.map(e => ({
      id: e.id,
      actor_id: e.actorId,
      actor_email: e.actorEmail,
      actor_role: e.actorRole,
      action: e.action,
      target_type: e.targetType,
      target_id: e.targetId,
      details: e.details ? JSON.parse(e.details) : null,
      created_at: e.createdAt,
    })),
  }), { headers: { 'Content-Type': 'application/json' } });
};