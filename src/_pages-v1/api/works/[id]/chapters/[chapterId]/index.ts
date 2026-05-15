export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import { logPublishAttempt, logPublishResult } from '@/lib/publish-logger';
import { chapters, works, creatorships, pseuds, chapterVersions } from '@/lib/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const chapter = await db.select().from(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId))).get();
  if (!chapter) return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify(chapter), { headers: { 'Content-Type': 'application/json' } });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isPublishOp = (() => { try { const b = JSON.parse(request.headers.get('x-body-preview') || '{}'); return b.draft === 0; } catch { return false; } })();

  const creatorship = await db.select().from(creatorships)
    .innerJoin(pseuds, eq(pseuds.id, creatorships.pseudId))
    .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  const chapter = await db.select().from(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId))).get();
  if (!chapter) return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const logId = await logPublishAttempt(d1, {
    workId,
    chapterId,
    step: 'chapter_save',
    userId: auth.user.id,
    requestSummary: JSON.stringify({ title: body.title, draft: body.draft, hasContent: !!body.content_md, contentLen: body.content_md?.length }),
  });

  try {
    // Auto-version: insert current state into chapter_versions before update
    await db.insert(chapterVersions).values({
      chapterId,
      version: sql`(SELECT COALESCE(MAX(version), 0) + 1 FROM chapter_versions WHERE chapter_id = ${chapterId})`,
      contentMd: chapter.contentMd,
      contentHtml: chapter.contentHtml,
      note: 'Auto-save before update',
    });

    const updateValues: Record<string, any> = {};

    if (body.title !== undefined) updateValues.title = body.title;
    if (body.content_md !== undefined) {
      updateValues.contentMd = body.content_md;
      // Prefer the HTML sent directly from the client (TipTap's actual output),
      // which is accurate even when htmlToMarkdown degrades large paste content.
      // Fall back to rendering the markdown when no client HTML is provided.
      const htmlForStorage = body.content_html || markdownToHtml(body.content_md);
      updateValues.contentHtml = htmlForStorage;
      // Always derive word count from the HTML's plain text so the persisted value
      // matches what the editor shows (avoids counting markdown syntax like *, #, etc.).
      const plainText = htmlForStorage
        .replace(/<[^>]*>/g, ' ')
        .replace(/&\w+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      updateValues.wordCount = plainText ? plainText.split(/\s+/).length : 0;
    }
    if (body.position !== undefined) updateValues.position = body.position;
    if (body.draft !== undefined) updateValues.draft = body.draft ? 1 : 0;

    // Mood engine
    const VALID_MOODS = ['cozy', 'tense', 'melancholy', 'triumphant', 'romantic', 'horror', 'flashback', 'action'];
    if ('mood' in body) {
      const mood = body.mood === null ? null : String(body.mood);
      if (mood !== null && !VALID_MOODS.includes(mood)) {
        return new Response(JSON.stringify({ error: 'Invalid mood value', valid: VALID_MOODS }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      updateValues.mood = mood;
    }

    // Handle images array
    if (body.images !== undefined) {
      const images: string[] = Array.isArray(body.images) ? body.images : [];
      const validImages = images.filter((img: string) => typeof img === 'string' && img.startsWith('chapters/') && !img.includes('..'));
      updateValues.images = JSON.stringify(validImages);
    }

    if (Object.keys(updateValues).length === 0) return new Response(JSON.stringify(chapter), { headers: { 'Content-Type': 'application/json' } });

    updateValues.updatedAt = sql`datetime('now')`;

    await db.update(chapters).set(updateValues).where(eq(chapters.id, chapterId));
    await db.update(works).set({ updatedAt: sql`datetime('now')` }).where(eq(works.id, workId));
    await db.update(works).set({
      wordCount: sql`(SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE work_id = ${workId} AND draft = 0)`,
    }).where(eq(works.id, workId));

    const updated = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
    await logPublishResult(d1, logId, { status: 'success', httpStatus: 200, responseSummary: JSON.stringify({id: updated?.id, draft: updated?.draft, word_count: updated?.wordCount}).slice(0,200) });
    return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    await logPublishResult(d1, logId, { status: 'fail', httpStatus: 500, error: err?.message });
    throw err;
  }
};