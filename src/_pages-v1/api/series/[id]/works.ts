export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { series, serialWorks, works, creatorships } from '@/lib/schema';
import { getAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { eq, and, gte, inArray, sql, desc, asc } from 'drizzle-orm';
import type { APIRoute } from 'astro';

// POST /api/series/[id]/works — Add a work to a series
// Body: { work_id, position? }
// DELETE /api/series/[id]/works — Remove a work from a series
// Body: { work_id }

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const seriesId = Number(params.id);
  if (!seriesId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify series exists and user owns it
  const seriesRow = await drz.select().from(series).where(eq(series.id, seriesId)).get();
  if (!seriesRow) return new Response(JSON.stringify({ error: 'Series not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isOwner = auth.pseuds.some((p: any) => p.id === seriesRow.creatorPseudId);
  if (!isOwner) return new Response(JSON.stringify({ error: 'Forbidden — only the series creator can add works' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const workId = body?.work_id;
  if (!workId) return new Response(JSON.stringify({ error: 'work_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Verify work exists
  const work = await drz.select().from(works).where(eq(works.id, workId)).get();
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Check that the user owns the work (must be author)
  const pseudIds = auth.pseuds.map((p: any) => p.id);
  const creatorship = pseudIds.length > 0
    ? await drz.select().from(creatorships)
        .where(and(eq(creatorships.workId, workId), inArray(creatorships.pseudId, pseudIds)))
        .get()
    : null;
  if (!creatorship) return new Response(JSON.stringify({ error: 'You can only add your own works to a series' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  // Check if work is already in this series
  const existing = await drz.select().from(serialWorks)
    .where(and(eq(serialWorks.seriesId, seriesId), eq(serialWorks.workId, workId)))
    .get();
  if (existing) return new Response(JSON.stringify({ error: 'Work is already in this series' }), { status: 409, headers: { 'Content-Type': 'application/json' } });

  // Determine position
  const position = body?.position;
  if (position) {
    // Insert at specific position — shift others down
    await drz.update(serialWorks)
      .set({ position: sql`position + 1` })
      .where(and(eq(serialWorks.seriesId, seriesId), gte(serialWorks.position, position)));
    await drz.insert(serialWorks).values({ seriesId, workId, position });
  } else {
    // Append at end
    const maxRow = await drz.select({ maxPos: sql<number>`MAX(position)` })
      .from(serialWorks)
      .where(eq(serialWorks.seriesId, seriesId))
      .get();
    const nextPos = (maxRow?.maxPos ?? 0) + 1;
    await drz.insert(serialWorks).values({ seriesId, workId, position: nextPos });
  }

  // Update series updated_at
  await drz.update(series)
    .set({ updatedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') })
    .where(eq(series.id, seriesId));

  return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const seriesId = Number(params.id);
  if (!seriesId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership
  const seriesRow = await drz.select().from(series).where(eq(series.id, seriesId)).get();
  if (!seriesRow) return new Response(JSON.stringify({ error: 'Series not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isOwner = auth.pseuds.some((p: any) => p.id === seriesRow.creatorPseudId);
  if (!isOwner) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const workId = body?.work_id;
  if (!workId) return new Response(JSON.stringify({ error: 'work_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const deleted = await drz.delete(serialWorks)
    .where(and(eq(serialWorks.seriesId, seriesId), eq(serialWorks.workId, workId)))
    .returning();
  if (deleted.length === 0) {
    return new Response(JSON.stringify({ error: 'Work not found in series' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Re-index positions to be contiguous
  const remaining = await drz.select({ id: serialWorks.id })
    .from(serialWorks)
    .where(eq(serialWorks.seriesId, seriesId))
    .orderBy(asc(serialWorks.position));
  // Import asc here — already available but let me use number index
  for (let i = 0; i < remaining.length; i++) {
    await drz.update(serialWorks)
      .set({ position: i + 1 })
      .where(eq(serialWorks.id, remaining[i].id));
  }

  // Update series updated_at
  await drz.update(series)
    .set({ updatedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') })
    .where(eq(series.id, seriesId));

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};

