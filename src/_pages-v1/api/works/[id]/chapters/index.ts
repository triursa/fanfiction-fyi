export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import { works, chapters, creatorships, pseuds } from '@/lib/schema';
import { eq, and, isNotNull, isNull, sql, desc, inArray } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { work_id: workId } = body || {};
  if (!workId) return new Response(JSON.stringify({ error: 'work_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Check ownership via creatorships + pseuds
  const creatorship = await db.select().from(creatorships)
    .innerJoin(pseuds, eq(pseuds.id, creatorships.pseudId))
    .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden: not a creator of this work' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  const title = body?.title || 'Chapter';
  const contentMd = body?.content_md || '';
  const contentHtml = contentMd ? markdownToHtml(contentMd) : null;
  const wordCount = contentMd ? contentMd.split(/\s+/).filter(Boolean).length : 0;

  const maxPos = await db.select({ maxPos: sql<number>`MAX(${chapters.position})`.as('max_pos') })
    .from(chapters).where(eq(chapters.workId, workId)).get();
  const position = (maxPos?.maxPos ?? 0) + 1;

  const draft = body?.draft !== undefined ? (body.draft ? 1 : 0) : 1;

  const [inserted] = await db.insert(chapters).values({
    workId,
    position,
    title,
    contentMd,
    contentHtml,
    draft,
    wordCount,
  }).returning();

  return new Response(JSON.stringify(inserted), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

export const GET: APIRoute = async ({ url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const workId = Number(url.pathname.split('/')[3]);
  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const work = await db.select({ id: works.id, publishedAt: works.publishedAt }).from(works).where(eq(works.id, workId)).get();
  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (!work.publishedAt) {
    return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  const chapterRows = await db.select().from(chapters)
    .where(and(eq(chapters.workId, workId), eq(chapters.draft, 0)))
    .orderBy(chapters.position);
  return new Response(JSON.stringify(chapterRows), { headers: { 'Content-Type': 'application/json' } });
};