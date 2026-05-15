import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../lib/db';
import { getAuth, requireAuth, checkApproved } from '../../../../lib/auth';
import { validateBody, updateSeriesSchema } from '../../../../lib/validation';
import { series, serialWorks, pseuds, works } from '../../../../lib/schema/index';
import { eq, and, count, isNotNull, asc } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/series/[id] — Series detail with ordered works ────────

export const GET: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const seriesId = Number(params?.id);

  if (!seriesId || Number.isNaN(seriesId)) {
    return new Response(JSON.stringify({ error: 'Invalid series ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch series with creator pseud name
  const seriesRow = await db
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
    .where(eq(series.id, seriesId))
    .get();

  if (!seriesRow) {
    return new Response(JSON.stringify({ error: 'Series not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch works in this series, ordered by position
  const workRows = await db
    .select({
      id: works.id,
      title: works.title,
      summary: works.summary,
      wordCount: works.wordCount,
      position: serialWorks.position,
    })
    .from(serialWorks)
    .innerJoin(works, eq(serialWorks.workId, works.id))
    .where(and(
      eq(serialWorks.seriesId, seriesId),
      isNotNull(works.publishedAt),
    ))
    .orderBy(asc(serialWorks.position));

  const workItems = workRows.map(w => ({
    id: w.id,
    title: w.title,
    summary: w.summary,
    wordCount: w.wordCount,
    position: w.position,
  }));

  return new Response(JSON.stringify({
    data: {
      ...seriesRow,
      works: workItems,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PUT /api/series/[id] — Update series ──────────────────────────

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const seriesId = Number(params?.id);

  if (!seriesId || Number.isNaN(seriesId)) {
    return new Response(JSON.stringify({ error: 'Invalid series ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify series exists
  const existingSeries = await db.select().from(series).where(eq(series.id, seriesId)).get();
  if (!existingSeries) {
    return new Response(JSON.stringify({ error: 'Series not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership — series' creatorPseud must belong to this user
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(existingSeries.creatorPseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the series owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate body
  const [data, error] = await validateBody(request, updateSeriesSchema);
  if (error) return error;

  // Build update object
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.complete !== undefined) updates.complete = data.complete ? 1 : 0;

  await db.update(series).set(updates).where(eq(series.id, seriesId));

  // Fetch updated series with creator name
  const updated = await db
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
    .where(eq(series.id, seriesId))
    .get();

  return new Response(JSON.stringify({ data: updated }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/series/[id] — Delete series ────────────────────────

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const seriesId = Number(params?.id);

  if (!seriesId || Number.isNaN(seriesId)) {
    return new Response(JSON.stringify({ error: 'Invalid series ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify series exists
  const existingSeries = await db.select().from(series).where(eq(series.id, seriesId)).get();
  if (!existingSeries) {
    return new Response(JSON.stringify({ error: 'Series not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(existingSeries.creatorPseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the series owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete serialWorks entries first (cascade should handle it, but be explicit)
  await db.delete(serialWorks).where(eq(serialWorks.seriesId, seriesId));
  // Delete series
  await db.delete(series).where(eq(series.id, seriesId));

  return new Response(JSON.stringify({ data: { id: seriesId, deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};