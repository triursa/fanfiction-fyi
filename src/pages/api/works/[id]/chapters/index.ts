export const prerender = false;

import { queryFirst, run, queryAll } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { work_id: workId } = body || {};
  if (!workId) return new Response(JSON.stringify({ error: 'work_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const creatorship = await queryFirst<any>(db, `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`, workId, auth.user.id);
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden: not a creator of this work' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  // Read title and content from the same body (first json() consumed the stream)
  const title = body?.title || 'Chapter';
  const contentMd = body?.content_md || '';
  const contentHtml = contentMd ? markdownToHtml(contentMd) : null;
  const wordCount = contentMd ? contentMd.split(/\s+/).filter(Boolean).length : 0;

  const maxPos = await queryFirst<{ max_pos: number }>(db, `SELECT MAX(position) as max_pos FROM chapters WHERE work_id = ?1`, workId);
  const position = (maxPos?.max_pos ?? 0) + 1;

  const draft = body?.draft !== undefined ? (body.draft ? 1 : 0) : 1;
  const result = await run(db, `INSERT INTO chapters (work_id, position, title, content_md, content_html, draft, word_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))`, workId, position, title, contentMd, contentHtml, draft, wordCount);
  const chapter = await queryFirst<any>(db, `SELECT * FROM chapters WHERE id = ?1`, result.meta.last_row_id);

  return new Response(JSON.stringify(chapter), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

export const GET: APIRoute = async ({ url, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const workId = Number(url.pathname.split('/')[3]);
  const chapters = await queryAll<any>(db, `SELECT * FROM chapters WHERE work_id = ?1 ORDER BY position`, workId);
  return new Response(JSON.stringify(chapters), { headers: { 'Content-Type': 'application/json' } });
};