export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { logPublishAttempt, logPublishResult } from '@/lib/publish-logger';
import { chapters, works, creatorships, pseuds } from '@/lib/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Check ownership
  const creatorship = await db.select().from(creatorships)
    .innerJoin(pseuds, eq(pseuds.id, creatorships.pseudId))
    .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  const logId = await logPublishAttempt(d1, { workId, chapterId, step: 'chapter_publish_post', userId: auth.user.id, requestSummary: 'POST /publish' });

  try {
    await db.update(chapters).set({
      draft: 0,
      updatedAt: sql`datetime('now')`,
    }).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId)));

    await db.update(works).set({
      publishedAt: sql`COALESCE(published_at, datetime('now'))`,
      updatedAt: sql`datetime('now')`,
    }).where(eq(works.id, workId));

    await db.update(works).set({
      wordCount: sql`(SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE work_id = ${workId} AND draft = 0)`,
    }).where(eq(works.id, workId));

    await logPublishResult(d1, logId, { status: 'success', httpStatus: 200 });

    const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
    return new Response(JSON.stringify(chapter), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    await logPublishResult(d1, logId, { status: 'fail', httpStatus: 500, error: err?.message });
    throw err;
  }
};