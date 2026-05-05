export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { chapters, creatorships, pseuds } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/**
 * PUT /api/works/{id}/chapters/reorder
 * Batch-reorder chapters by accepting an array of { id, position }.
 * All positions are updated in a single atomic D1 batch. Positions are
 * re-indexed to be contiguous (1, 2, 3…) based on the order of the items
 * in the request.
 *
 * Body: { positions: [{ id: number, position: number }] }
 *   - The position values in the request represent the desired sort order.
 *   - The server re-indexes to guarantee contiguous positions starting at 1.
 *   - The submitted IDs must exactly match all chapter IDs for the work.
 */
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership
  const creatorship = await db.select().from(creatorships)
    .innerJoin(pseuds, eq(pseuds.id, creatorships.pseudId))
    .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const positions: unknown = body?.positions;
  if (!Array.isArray(positions) || positions.length === 0) {
    return new Response(JSON.stringify({ error: 'positions array required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Validate that every entry has numeric id and position
  for (const entry of positions) {
    if (
      typeof entry !== 'object' || entry === null ||
      typeof (entry as any).id !== 'number' || !Number.isInteger((entry as any).id) ||
      typeof (entry as any).position !== 'number' || !Number.isInteger((entry as any).position)
    ) {
      return new Response(JSON.stringify({ error: 'Each position entry must have integer id and position' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const typedPositions = positions as { id: number; position: number }[];

  // Validate uniqueness of chapter IDs in the request
  const requestedIds = typedPositions.map(p => p.id);
  if (new Set(requestedIds).size !== requestedIds.length) {
    return new Response(JSON.stringify({ error: 'Duplicate chapter IDs in positions' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Fetch all chapters for this work
  const allWorkChapters = await db.select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.workId, workId))
    .all();

  // Require the submitted IDs to exactly match all chapter IDs for the work
  const allWorkChapterIds = new Set(allWorkChapters.map(c => c.id));
  if (
    requestedIds.length !== allWorkChapterIds.size ||
    requestedIds.some(id => !allWorkChapterIds.has(id))
  ) {
    return new Response(JSON.stringify({ error: 'positions must include all chapters for this work' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Re-index positions to be contiguous (1, 2, 3…) based on request order
  const sorted = [...typedPositions].sort((a, b) => a.position - b.position);

  try {
    // Build batch statements — one UPDATE per chapter + one for the work's updatedAt
    const chapterUpdates = sorted.map((entry, i) =>
      d1.prepare(`UPDATE chapters SET position = ?, updated_at = datetime('now') WHERE id = ?`).bind(i + 1, entry.id)
    );
    const workUpdate = d1.prepare(`UPDATE works SET updated_at = datetime('now') WHERE id = ?`).bind(workId);

    // Execute atomically — D1 batch either fully applies or fully rolls back
    await d1.batch([...chapterUpdates, workUpdate]);

    // Return the updated chapter list in the same snake_case shape as other chapter endpoints
    const updatedChapters = await db.select({
      id: chapters.id,
      position: chapters.position,
      title: chapters.title,
      draft: chapters.draft,
      wordCount: chapters.wordCount,
    }).from(chapters).where(eq(chapters.workId, workId)).orderBy(chapters.position);

    const chaptersList = updatedChapters.map(c => ({
      id: c.id,
      position: c.position,
      title: c.title,
      draft: c.draft,
      word_count: c.wordCount,
    }));

    return new Response(JSON.stringify({ chapters: chaptersList }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Reorder failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};