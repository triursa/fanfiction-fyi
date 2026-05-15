/**
 * Admin Reports Detail API
 * PATCH /api/admin/reports/:id — resolve or dismiss a report
 * Auth: required, mod+ only
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth } from '@/v2/lib/auth';
import { getDb } from '@/v2/lib/db';
import { contentReports } from '@/v2/lib/schema/index';
import { validateBody, resolveReportSchema } from '@/v2/lib/validation';
import { eq } from 'drizzle-orm';

function requireMod(user: { role: string }): void {
  if (!['founder', 'admin', 'mod'].includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: moderator access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireMod(auth.user);

  const db = getDb(d1);
  const reportId = Number(params.id);
  if (!reportId || isNaN(reportId)) {
    return new Response(JSON.stringify({ error: 'Invalid report ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Find the report
  const report = await db.select().from(contentReports).where(eq(contentReports.id, reportId)).get();
  if (!report) {
    return new Response(JSON.stringify({ error: 'Report not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate body
  const [data, error] = await validateBody(request, resolveReportSchema);
  if (error) return error;

  // Update report
  const now = new Date().toISOString();
  await db
    .update(contentReports)
    .set({
      status: data.status,
      resolution: data.resolution || null,
      resolverId: auth.user.id,
      updatedAt: now,
    })
    .where(eq(contentReports.id, reportId));

  const updated = await db.select().from(contentReports).where(eq(contentReports.id, reportId)).get();

  return new Response(JSON.stringify({ data: updated }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};