import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, validateQuery, createSeriesSchema, browseSeriesSchema } from '@/v2/lib/validation';
import { series, serialWorks, pseuds, works } from '@/v2/lib/schema/index';
import { eq, and, desc, count, inArray } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/series — Browse series with pagination ──────────────────

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Parse query params
  const query = validateQuery(url, browseSeriesSchema);
  const { page, limit } = query;
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];
  if (query.complete !== undefined) {
    conditions.push(eq(series.complete, query.complete ? 1 : 0));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(series)
    .where(whereClause);

  // Fetch series with creator pseud name
  const seriesRows = await db
    .select({
      id: series.id,
      title: series.title,
      description: series.description,
      creatorPseudId: series.creatorPseudId,
      complete: series.complete,
      createdAt: series.createdAt,
      updatedAt: series.updatedAt,
      creatorName: pseuds.name,
    })
    .from(series)
    .innerJoin(pseuds, eq(series.creatorPseudId, pseuds.id))
    .where(whereClause)
    .orderBy(desc(series.createdAt))
    .limit(limit)
    .offset(offset);

  // Fetch work counts for these series
  let workCountsBySeries = new Map<number, number>();
  if (seriesRows.length > 0) {
    const seriesIds = seriesRows.map(s => s.id);
    const workCounts = await db
      .select({
        seriesId: serialWorks.seriesId,
        count: count(),
      })
      .from(serialWorks)
      .where(inArray(serialWorks.seriesId, seriesIds))
      .groupBy(serialWorks.seriesId);

    for (const row of workCounts) {
      workCountsBySeries.set(row.seriesId, row.count);
    }
  }

  const data = seriesRows.map(s => ({
    id: s.id,
    title: s.title,
    description: s.description,
    creatorPseudId: s.creatorPseudId,
    creatorName: s.creatorName,
    complete: s.complete,
    workCount: workCountsBySeries.get(s.id) || 0,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/series — Create a series ─────────────────────────────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, createSeriesSchema);
  if (error) return error;

  // Verify the pseud belongs to this user
  const pseud = await db
    .select()
    .from(pseuds)
    .where(and(eq(pseuds.id, data.pseudId), eq(pseuds.userId, auth.user.id)))
    .get();

  if (!pseud) {
    return new Response(JSON.stringify({ error: 'Pseud not found or does not belong to you' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create series
  try {
    const [inserted] = await db
      .insert(series)
      .values({
        title: data.title,
        description: data.description ?? null,
        creatorPseudId: data.pseudId,
        complete: 0,
      })
      .returning();

    // Fetch with creator name
    const creatorPseud = await db
      .select({ name: pseuds.name })
      .from(pseuds)
      .where(eq(pseuds.id, inserted.creatorPseudId))
      .get();

    return new Response(JSON.stringify({
      data: {
        id: inserted.id,
        title: inserted.title,
        description: inserted.description,
        creatorPseudId: inserted.creatorPseudId,
        creatorName: creatorPseud?.name ?? null,
        complete: inserted.complete,
        createdAt: inserted.createdAt,
        updatedAt: inserted.updatedAt,
      },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Failed to create series' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};