/**
 * Public Report Submission API
 * POST /api/reports — submit a content report (auth required, approved users only)
 *
 * Users can report works or comments for: harassment, spam, copyright, graphic, other.
 * Each user can only submit one report per target (duplicate prevention).
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { getDb } from '@/v2/lib/db';
import { contentReports, works, comments } from '@/v2/lib/schema/index';
import { validateBody, createReportSchema } from '@/v2/lib/validation';
import { eq, and } from 'drizzle-orm';

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate request body
  const [data, validationError] = await validateBody(request, createReportSchema);
  if (validationError) return validationError;

  const { targetType, targetId, reason, details } = data;
  const db = getDb(d1);

  // ─── Verify target exists ────────────────────────────────────────
  if (targetType === 'work') {
    const work = await db.select({ id: works.id }).from(works).where(eq(works.id, targetId)).get();
    if (!work) {
      return new Response(JSON.stringify({ error: 'Work not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else if (targetType === 'comment') {
    const comment = await db.select({ id: comments.id }).from(comments).where(eq(comments.id, targetId)).get();
    if (!comment) {
      return new Response(JSON.stringify({ error: 'Comment not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ─── Prevent duplicate reports ───────────────────────────────────
  const existing = await db
    .select({ id: contentReports.id })
    .from(contentReports)
    .where(
      and(
        eq(contentReports.reporterId, auth.user.id),
        eq(contentReports.targetType, targetType),
        eq(contentReports.targetId, targetId),
      ),
    )
    .get();

  if (existing) {
    return new Response(JSON.stringify({ error: 'You have already reported this content' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Create report ───────────────────────────────────────────────
  const now = new Date().toISOString();
  const result = await db.insert(contentReports).values({
    reporterId: auth.user.id,
    targetType,
    targetId,
    reason,
    details: details || null,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }).returning({ id: contentReports.id });

  const reportId = result[0].id;

  // Fetch the full report to return
  const report = await db
    .select()
    .from(contentReports)
    .where(eq(contentReports.id, reportId))
    .get();

  return new Response(JSON.stringify({ data: report }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

// All other methods are not allowed
export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
  });
};

export const PUT: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
  });
};

export const PATCH: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
  });
};

export const DELETE: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
  });
};