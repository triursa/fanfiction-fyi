export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { chapters, works, creatorships, pseuds } from '@/lib/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/**
 * PUT /api/works/{id}/chapters/reorder
 * Batch-reorder chapters by accepting an array of { id, position }.
 * All positions are updated atomically. Positions are re-indexed to
 * be contiguous (1, 2, 3…) based on the order of the items in the request.
 *
 * Body: { positions: [{ id: number, position: number }] }
 *   - The position values in the request represent the desired sort order.
 *   - The server re-indexes to guarantee contiguous positions starting at 1.
 */
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership
  const userPseudIds = auth.pseuds.map(p => p.id);
  const creatorship = await db.select().from(creatorships)
    .innerJoin(pseuds, eq(pseuds.id, creatorships.pseudId))
    .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const positions: { id: number; position: number }[] = body?.positions;
  if (!Array.isArray(positions) || positions.length === 0) {
    return new Response(JSON.stringify({ error: 'positions array required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify all chapter IDs belong to this work
  const chapterIds = positions.map(p => p.id);
  const existingChapters = await db.select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.workId, workId), inArray(chapters.id, chapterIds)))
    .all();

  if (existingChapters.length !== chapterIds.length) {
    return new Response(JSON.stringify({ error: 'One or more chapters not found in this work' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Re-index positions to be contiguous (1, 2, 3…) based on request order
  const sorted = [...positions].sort((a, b) => a.position - b.position);

  try {
    // Update each chapter position
    for (let i = 0; i < sorted.length; i++) {
      const newPosition = i + 1; // 1-indexed, contiguous
      await db.update(chapters)
        .set({ position: newPosition, updatedAt: sql`datetime('now')` })
        .where(eq(chapters.id, sorted[i].id));
    }

    // Update work's updatedAt
    await db.update(works).set({ updatedAt: sql`datetime('now')` }).where(eq(works.id, workId));

    // Return the updated chapter list
    const updatedChapters = await db.select({
      id: chapters.id,
      position: chapters.position,
      title: chapters.title,
      draft: chapters.draft,
      wordCount: chapters.wordCount,
    }).from(chapters).where(eq(chapters.workId, workId)).orderBy(chapters.position);

    return new Response(JSON.stringify({ chapters: updatedChapters }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Reorder failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};