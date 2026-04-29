export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import { corsHeaders, handleCors } from '@/lib/cors';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ params, locals, url, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });

  const work = await queryFirst<any>(db, `SELECT id FROM works WHERE id = ?1`, workId);
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });

  const chapterId = url.searchParams.get('chapter_id');
  const parentId = url.searchParams.get('parent_id');

  let sql = `SELECT c.*, p.name as pseud_name FROM comments c JOIN pseuds p ON c.pseud_id = p.id WHERE c.work_id = ?1`;
  const vals: unknown[] = [workId];

  if (chapterId) {
    sql += ` AND c.chapter_id = ?`;
    vals.push(Number(chapterId));
  }
  if (parentId) {
    sql += ` AND c.parent_id = ?`;
    vals.push(Number(parentId));
  }

  sql += ` ORDER BY c.created_at ASC`;

  const comments = await queryAll<any>(db, sql, ...vals);

  // Convert markdown content to HTML for display
  for (const c of comments) {
    if (c.content) {
      c.content_html = markdownToHtml(c.content);
    }
  }

  return new Response(JSON.stringify({ comments }), { headers: { 'Content-Type': 'application/json', ...cors } });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  // Rate limit: 5 per 5min per user ID
  const rlKey = `user:${auth.user.id}`;
  const rl = await checkRateLimit(db, rlKey, 'post-comment');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }
  await recordFailedAttempt(db, rlKey, 'post-comment');

  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await queryFirst<any>(db, `SELECT id FROM works WHERE id = ?1`, workId);
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
    const parent = await queryFirst<any>(db, `SELECT id, work_id FROM comments WHERE id = ?1`, parent_id);
    if (!parent || parent.work_id !== workId) {
      return new Response(JSON.stringify({ error: 'Parent comment not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const result = await run(
    db,
    `INSERT INTO comments (work_id, chapter_id, pseud_id, parent_id, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))`,
    workId,
    chapter_id ?? null,
    pseudId,
    parent_id ?? null,
    content.trim()
  );

  const comment = await queryFirst<any>(db, `SELECT c.*, p.name as pseud_name FROM comments c JOIN pseuds p ON c.pseud_id = p.id WHERE c.id = ?1`, result.meta.last_row_id);
  if (comment && comment.content) {
    comment.content_html = markdownToHtml(comment.content);
  }

  return new Response(JSON.stringify(comment), { status: 201, headers: { 'Content-Type': 'application/json' } });
};