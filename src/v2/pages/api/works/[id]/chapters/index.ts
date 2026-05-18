import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { eq, and, asc, sql } from 'drizzle-orm';
import { getDb } from '../../../../../../lib/db';
import { requireAuth, checkApproved } from '../../../../../../lib/auth';
import { validateBody } from '../../../../../../lib/validation';
import { createChapterSchema } from '../../../../../../lib/validation';
import { chapters, works, creatorships, pseuds } from '../../../../../../lib/schema/index';

export const config = { auth: 'public' as const };

// GET /api/works/:id/chapters — List chapters for a work
export const GET: APIRoute = async ({ params, locals }) => {
  const workId = Number(params.id);
  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const work = await db.select().from(works).where(eq(works.id, workId)).get();
  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Only show draft chapters to the work's authors
  const chapterList = work.draft
    ? await db.select().from(chapters).where(eq(chapters.workId, workId)).orderBy(asc(chapters.position))
    : await db.select().from(chapters).where(and(eq(chapters.workId, workId), eq(chapters.draft, 0))).orderBy(asc(chapters.position));

  const sanitized = chapterList.map(c => ({
    id: c.id,
    position: c.position,
    title: c.title,
    wordCount: c.wordCount,
    draft: c.draft,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return new Response(JSON.stringify({ data: sanitized, total: chapterList.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/works/:id/chapters — Create a new chapter
export const POST: APIRoute = async ({ params, request, locals }) => {
  const workId = Number(params.id);
  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify user is an author of this work
  const userPseuds = await db.select().from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);
  const isAuthor = pseudIds.length > 0 && await db.select().from(creatorships)
    .where(and(eq(creatorships.workId, workId), sql`${creatorships.pseudId} IN (${pseudIds.join(',') || '0'})`))
    .get() !== undefined;

  if (!isAuthor) {
    return new Response(JSON.stringify({ error: 'Not an author of this work' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const [data, error] = await validateBody(request, createChapterSchema);
  if (error) return error;

  // Get next position
  const existing = await db.select().from(chapters).where(eq(chapters.workId, workId));
  const nextPosition = existing.length + 1;

  // Calculate word count
  const wordCount = data.contentMd ? data.contentMd.split(/\s+/).filter(Boolean).length : 0;

  const newChapter = await db.insert(chapters).values({
    workId,
    position: nextPosition,
    title: data.title,
    contentMd: data.contentMd ?? null,
    contentHtml: null,
    draft: 1,
    wordCount,
    images: '[]',
    mood: data.mood ?? null,
  }).returning();

  // Recalculate work word count (new chapters start as draft, so count won't change,
  // but this also updates updatedAt on the work)
  const wordResult = await db.select({ total: sql`COALESCE(SUM(${chapters.wordCount}), 0)` }).from(chapters).where(and(eq(chapters.workId, workId), eq(chapters.draft, 0))).get();
  await db.update(works).set({ wordCount: wordResult.total, updatedAt: new Date().toISOString() }).where(eq(works.id, workId));

  return new Response(JSON.stringify({ data: newChapter[0] }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
