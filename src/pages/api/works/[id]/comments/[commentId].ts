export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import { corsHeaders, handleCors } from '@/lib/cors';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';
import { works, comments, pseuds } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  // Auth check
  const auth = await requireAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  // Rate limit: 10 edits per 5 min per user
  const rlKey = `user:${auth.user.id}:edit-comment`;
  const rl = await checkRateLimit(d1, rlKey, 'edit-comment');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds), ...cors },
    });
  }
  await recordFailedAttempt(d1, rlKey, 'edit-comment');

  const workId = Number(params.id);
  const commentId = Number(params.commentId);
  if (!workId || !commentId) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  // Parse body
  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  const { content } = body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return new Response(JSON.stringify({ error: 'content is required and must be non-empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
  if (content.length > 10000) {
    return new Response(JSON.stringify({ error: 'content must be 10000 characters or fewer' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  // Fetch the comment
  const comment = await db
    .select({
      id: comments.id,
      workId: comments.workId,
      pseudId: comments.pseudId,
    })
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.workId, workId)))
    .get();

  if (!comment) {
    return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  // Only the comment author can edit
  const userPseudIds = auth.pseuds.map((p: any) => p.id);
  if (!userPseudIds.includes(comment.pseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: you can only edit your own comments' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  // Update the comment
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await db
    .update(comments)
    .set({
      content: content.trim(),
      updatedAt: now,
    })
    .where(eq(comments.id, commentId));

  // Fetch updated comment with pseud name
  const updated = await db
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
    .where(eq(comments.id, commentId))
    .get();

  const result: any = updated ? {
    id: updated.id,
    work_id: updated.workId,
    chapter_id: updated.chapterId,
    pseud_id: updated.pseudId,
    parent_id: updated.parentId,
    content: updated.content,
    content_html: updated.content ? markdownToHtml(updated.content) : null,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt ?? null,
    pseud_name: updated.pseudName,
  } : null;

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', ...cors } });
};