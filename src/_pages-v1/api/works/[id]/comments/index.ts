export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import { corsHeaders, handleCors } from '@/lib/cors';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';
import { works, comments, pseuds } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ params, locals, url, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });

  const work = await db.select({ id: works.id }).from(works).where(eq(works.id, workId)).get();
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });

  const chapterId = url.searchParams.get('chapter_id');
  const parentId = url.searchParams.get('parent_id');

  // Build conditions
  const conditions = [eq(comments.workId, workId)];
  if (chapterId) conditions.push(eq(comments.chapterId, Number(chapterId)));
  if (parentId) conditions.push(eq(comments.parentId, Number(parentId)));

  const commentRows = await db
    .select({
      id: comments.id,
      workId: comments.workId,
      chapterId: comments.chapterId,
      pseudId: comments.pseudId,
      parentId: comments.parentId,
      content: comments.content,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      pseudName: pseuds.name,
    })
    .from(comments)
    .innerJoin(pseuds, eq(pseuds.id, comments.pseudId))
    .where(and(...conditions))
    .orderBy(asc(comments.createdAt));

  // Convert to snake_case and add content_html
  const commentsList = commentRows.map(c => ({
    id: c.id,
    work_id: c.workId,
    chapter_id: c.chapterId,
    pseud_id: c.pseudId,
    parent_id: c.parentId,
    content: c.content,
    content_html: c.content ? markdownToHtml(c.content) : null,
    created_at: c.createdAt,
    updated_at: c.updatedAt ?? null,
    pseud_name: c.pseudName,
  }));

  return new Response(JSON.stringify({ comments: commentsList }), { headers: { 'Content-Type': 'application/json', ...cors } });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  // Rate limit: 5 per 5min per user ID
  const rlKey = `user:${auth.user.id}`;
  const rl = await checkRateLimit(d1, rlKey, 'post-comment');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }
  await recordFailedAttempt(d1, rlKey, 'post-comment');

  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await db.select({ id: works.id }).from(works).where(eq(works.id, workId)).get();
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { content, chapter_id, parent_id } = body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return new Response(JSON.stringify({ error: 'content required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // If parent_id given, validate it belongs to this work
  if (parent_id) {
    const parent = await db.select({ id: comments.id, workId: comments.workId }).from(comments).where(eq(comments.id, parent_id)).get();
    if (!parent || parent.workId !== workId) {
      return new Response(JSON.stringify({ error: 'Parent comment not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const result = await db.insert(comments).values({
    workId,
    chapterId: chapter_id ?? null,
    pseudId,
    parentId: parent_id ?? null,
    content: content.trim(),
  });

  const lastRowId = Number(result.meta?.last_row_id ?? result[0]?.meta?.last_row_id);

  const comment = await db
    .select({
      id: comments.id,
      workId: comments.workId,
      chapterId: comments.chapterId,
      pseudId: comments.pseudId,
      parentId: comments.parentId,
      content: comments.content,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      pseudName: pseuds.name,
    })
    .from(comments)
    .innerJoin(pseuds, eq(pseuds.id, comments.pseudId))
    .where(eq(comments.id, lastRowId))
    .get();

  const commentOut: any = comment ? {
    id: comment.id,
    work_id: comment.workId,
    chapter_id: comment.chapterId,
    pseud_id: comment.pseudId,
    parent_id: comment.parentId,
    content: comment.content,
    content_html: comment.content ? markdownToHtml(comment.content) : null,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt ?? null,
    pseud_name: comment.pseudName,
  } : null;

  return new Response(JSON.stringify(commentOut), { status: 201, headers: { 'Content-Type': 'application/json' } });
};