import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody } from '@/v2/lib/validation';
import { updateChapterSchema } from '@/v2/lib/validation';
import { chapters, creatorships, pseuds, works } from '@/v2/lib/schema/index';
import { eq, and, sql } from 'drizzle-orm';

export const config = { auth: 'public' as const };

// GET /api/works/:id/chapters/:chapterId — Get single chapter
export const GET: APIRoute = async ({ params, locals }) => {
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId || isNaN(workId) || isNaN(chapterId)) {
    return new Response(JSON.stringify({ error: 'Invalid IDs' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const chapter = await db.select().from(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId))).get();
  if (!chapter) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ data: chapter }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// PUT /api/works/:id/chapters/:chapterId — Update chapter
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid IDs' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify authorship
  const userPseuds = await db.select().from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);
  const isAuthor = pseudIds.length > 0 && await db.select().from(creatorships)
    .where(and(eq(creatorships.workId, workId)))
    .then(rows => rows.some(c => pseudIds.includes(c.pseudId)));

  if (!isAuthor) {
    return new Response(JSON.stringify({ error: 'Not an author of this work' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const [data, error] = await validateBody(request, updateChapterSchema);
  if (error) return error;

  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.contentMd !== undefined) {
    updates.contentMd = data.contentMd;
    updates.wordCount = data.contentMd.split(/\s+/).filter(Boolean).length;
  }
  if (data.contentHtml !== undefined) updates.contentHtml = data.contentHtml;
  if (data.mood !== undefined) updates.mood = data.mood;
  if (data.draft !== undefined) {
    updates.draft = data.draft ? 1 : 0;
  }

  const updated = await db.update(chapters).set(updates).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId))).returning();
  if (!updated.length) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Recalculate work word count (only published chapters)
  await recalcWorkWordCount(db, workId);

  return new Response(JSON.stringify({ data: updated[0] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// DELETE /api/works/:id/chapters/:chapterId — Delete chapter
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid IDs' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify authorship
  const userPseuds = await db.select().from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);
  const isAuthor = pseudIds.length > 0 && await db.select().from(creatorships)
    .where(eq(creatorships.workId, workId))
    .then(rows => rows.some(c => pseudIds.includes(c.pseudId)));

  if (!isAuthor) {
    return new Response(JSON.stringify({ error: 'Not an author of this work' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await db.delete(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId)));

  // Re-number remaining chapters
  const remaining = await db.select().from(chapters).where(eq(chapters.workId, workId)).orderBy(chapters.position);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].position !== i + 1) {
      await db.update(chapters).set({ position: i + 1 }).where(eq(chapters.id, remaining[i].id));
    }
  }

  // Update work word count (only published chapters)
  await recalcWorkWordCount(db, workId);

  return new Response(JSON.stringify({ data: { deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// Recalculate work word count from published chapters only
async function recalcWorkWordCount(db: any, workId: number) {
  const result = await db.select({ total: sql`COALESCE(SUM(${chapters.wordCount}), 0)` }).from(chapters).where(and(eq(chapters.workId, workId), eq(chapters.draft, 0))).get();
  await db.update(works).set({ wordCount: result.total, updatedAt: new Date().toISOString() }).where(eq(works.id, workId));
}
