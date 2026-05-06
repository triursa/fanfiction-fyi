export const prerender = false;

import type { APIRoute } from 'astro';
import { getDrizzle } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { UserRole } from '@/lib/types';
import { contentReports } from '@/lib/schema';
import { logAudit } from '@/lib/audit';
import { eq, sql } from 'drizzle-orm';

const VALID_ACTIONS = ['resolve', 'dismiss'] as const;

export const PUT: APIRoute = async ({ locals, request, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  // Mod+ required
  const auth = await requireRole(d1, request, UserRole.Mod);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if ('forbidden' in auth) {
    return new Response(JSON.stringify({ error: 'Insufficient role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const reportId = Number(params.id);
  if (!reportId || isNaN(reportId)) {
    return new Response(JSON.stringify({ error: 'Invalid report ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { action, resolution } = body;

  if (!action || !VALID_ACTIONS.includes(action)) {
    return new Response(JSON.stringify({ error: 'Invalid action. Must be "resolve" or "dismiss".' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Find the report
  const report = await db.select().from(contentReports).where(eq(contentReports.id, reportId)).get();
  if (!report) {
    return new Response(JSON.stringify({ error: 'Report not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (report.status !== 'open') {
    return new Response(JSON.stringify({ error: `Report is already ${report.status}.` }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const newStatus = action === 'resolve' ? 'resolved' : 'dismissed';

  // Update the report
  const updated = await db.update(contentReports)
    .set({
      status: newStatus,
      resolverId: auth.user.id,
      resolution: resolution || null,
      resolvedAt: sql`(datetime('now'))`,
    })
    .where(eq(contentReports.id, reportId))
    .returning()
    .get();

  // Return as snake_case
  const result = {
    id: updated.id,
    reporter_id: updated.reporterId,
    target_type: updated.targetType,
    target_id: updated.targetId,
    reason: updated.reason,
    details: updated.details,
    status: updated.status,
    resolver_id: updated.resolverId,
    resolution: updated.resolution,
    created_at: updated.createdAt,
    resolved_at: updated.resolvedAt,
  };

  // Audit log
  await logAudit(d1, auth.user.id, action === 'resolve' ? 'report.resolve' : 'report.dismiss', 'report', reportId, { target_type: report.targetType, target_id: report.targetId, resolution: resolution || null });

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
};