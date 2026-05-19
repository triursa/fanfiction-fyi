/**
 * Admin Reports API
 * GET  /api/admin/reports — list content reports (pagination, status filter)
 * PATCH /api/admin/reports/:id — resolve/dismiss a report
 * Auth: required, mod+ only
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth } from '@/v2/lib/auth';
import { getDb } from '@/v2/lib/db';
import { contentReports, users, works, chapters } from '@/v2/lib/schema/index';
import { validateBody, resolveReportSchema } from '@/v2/lib/validation';
import { eq, and, desc, sql, count } from 'drizzle-orm';

function requireMod(user: { role: string }): void {
  if (!['founder', 'admin', 'mod'].includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: moderator access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── GET /api/admin/reports ───────────────────────────────────────────
export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireMod(auth.user);

  const db = getDb(d1);

  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const offset = (page - 1) * limit;
  const statusFilter = url.searchParams.get('status') || '';
  const typeFilter = url.searchParams.get('type') || '';

  // Build conditions
  const conditions = [];
  if (statusFilter && ['open', 'resolved', 'dismissed'].includes(statusFilter)) {
    conditions.push(eq(contentReports.status, statusFilter));
  }
  if (typeFilter && ['work', 'comment'].includes(typeFilter)) {
    conditions.push(eq(contentReports.targetType, typeFilter));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(contentReports)
    .where(whereClause);

  // Fetch reports
  const reports = await db
    .select({
      id: contentReports.id,
      reporterId: contentReports.reporterId,
      targetType: contentReports.targetType,
      targetId: contentReports.targetId,
      reason: contentReports.reason,
      details: contentReports.details,
      status: contentReports.status,
      resolverId: contentReports.resolverId,
      resolution: contentReports.resolution,
      createdAt: contentReports.createdAt,
      updatedAt: contentReports.updatedAt,
    })
    .from(contentReports)
    .where(whereClause)
    .orderBy(desc(contentReports.createdAt))
    .limit(limit)
    .offset(offset);

  // Enrich with reporter info
  const reporterIds = [...new Set(reports.map(r => r.reporterId).filter(Boolean))] as number[];
  let reporterMap: Record<number, { email: string; displayName: string | null }> = {};
  if (reporterIds.length > 0) {
    const reporterRows = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(sql`${users.id} IN (${sql.join(reporterIds.map(id => sql`${id}`), sql`, `)})`);
    for (const r of reporterRows) {
      reporterMap[r.id] = { email: r.email, displayName: r.displayName };
    }
  }

  // Enrich with resolver info
  const resolverIds = [...new Set(reports.map(r => r.resolverId).filter(Boolean))] as number[];
  let resolverMap: Record<number, { email: string; displayName: string | null }> = {};
  if (resolverIds.length > 0) {
    const resolverRows = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(sql`${users.id} IN (${sql.join(resolverIds.map(id => sql`${id}`), sql`, `)})`);
    for (const r of resolverRows) {
      resolverMap[r.id] = { email: r.email, displayName: r.displayName };
    }
  }

  const data = reports.map(r => ({
    ...r,
    reporter: r.reporterId ? { id: r.reporterId, ...reporterMap[r.reporterId] } : null,
    resolver: r.resolverId ? { id: r.resolverId, ...resolverMap[r.resolverId] } : null,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PATCH /api/admin/reports/:id ──────────────────────────────────────
// NOTE: This file handles /api/admin/reports/:id via Astro's dynamic route.
// The :id param is available at src/pages/api/admin/reports/[id].ts
// However, since we need PATCH on the collection route for bulk operations,
// we also support batch resolution here.
// For single report resolution, the [id].ts file handles it.

export const PATCH: APIRoute = async ({ request, locals }) => {
  // This shouldn't typically be called without an ID, but we'll
  // redirect to the proper pattern. Return 400.
  return new Response(JSON.stringify({ error: 'Use PATCH /api/admin/reports/:id to resolve a report' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};