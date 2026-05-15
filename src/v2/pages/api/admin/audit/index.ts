/**
 * Admin Audit Log API
 * GET /api/admin/audit — list audit log entries (pagination, action/targetType/actorId filters)
 * Auth: required, founder/admin only
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { auditLog, users } from '../../../../lib/schema/index';
import { eq, and, desc, sql, count } from 'drizzle-orm';

function requireAdmin(user: { role: string }): void {
  if (!['founder', 'admin'].includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── GET /api/admin/audit ────────────────────────────────────────────
export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireAdmin(auth.user);

  const db = getDb(d1);

  // Query params
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const offset = (page - 1) * limit;
  const actionFilter = url.searchParams.get('action') || '';
  const targetTypeFilter = url.searchParams.get('targetType') || '';
  const actorIdFilter = url.searchParams.get('actorId') || '';

  // Build conditions
  const conditions = [];
  if (actionFilter) {
    conditions.push(eq(auditLog.action, actionFilter));
  }
  if (targetTypeFilter && ['user', 'work', 'comment'].includes(targetTypeFilter)) {
    conditions.push(eq(auditLog.targetType, targetTypeFilter));
  }
  if (actorIdFilter) {
    const actorId = Number(actorIdFilter);
    if (!isNaN(actorId)) {
      conditions.push(eq(auditLog.actorId, actorId));
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLog)
    .where(whereClause);

  // Fetch audit entries
  const rows = await db
    .select({
      id: auditLog.id,
      actorId: auditLog.actorId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      details: auditLog.details,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  // Enrich with actor emails
  const actorIds = [...new Set(rows.map(r => r.actorId).filter((id): id is number => id !== null))];
  let actorMap: Record<number, string> = {};
  if (actorIds.length > 0) {
    const actorRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(sql`${users.id} IN (${sql.join(actorIds.map(id => sql`${id}`), sql`, `)})`);
    for (const a of actorRows) {
      actorMap[a.id] = a.email;
    }
  }

  const data = rows.map(r => ({
    ...r,
    actorEmail: r.actorId && actorMap[r.actorId] ? actorMap[r.actorId!] : null,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};