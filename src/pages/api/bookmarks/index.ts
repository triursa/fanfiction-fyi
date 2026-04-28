export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const bookmarks = await queryAll<any>(
    db,
    `SELECT b.*, w.title, w.summary, w.word_count, w.complete, w.updated_at as work_updated_at
     FROM bookmarks b
     JOIN works w ON b.work_id = w.id
     WHERE b.pseud_id = ?1
     ORDER BY b.created_at DESC`,
    pseudId
  );

  for (const bm of bookmarks) {
    if (bm.notes) {
      bm.notes_html = markdownToHtml(bm.notes);
    }
  }

  return new Response(JSON.stringify({ bookmarks }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { work_id, notes, private: isPrivate } = body || {};
  if (!work_id) return new Response(JSON.stringify({ error: 'work_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseudId = (body?.pseud_id && auth.pseuds.some((p: any) => p.id === Number(body.pseud_id))) ? Number(body.pseud_id) : auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const work = await queryFirst<any>(db, `SELECT id FROM works WHERE id = ?1`, work_id);
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  try {
    const result = await run(
      db,
      `INSERT INTO bookmarks (pseud_id, work_id, notes, private, created_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))`,
      pseudId,
      work_id,
      notes ?? null,
      isPrivate ? 1 : 0
    );
    const bookmark = await queryFirst<any>(db, `SELECT * FROM bookmarks WHERE id = ?1`, result.meta.last_row_id);
    return new Response(JSON.stringify(bookmark), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Already bookmarked' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { work_id } = body || {};
  if (!work_id) return new Response(JSON.stringify({ error: 'work_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const result = await run(db, `DELETE FROM bookmarks WHERE pseud_id = ?1 AND work_id = ?2`, pseudId, work_id);
  if (result.meta.changes === 0) {
    return new Response(JSON.stringify({ error: 'Bookmark not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};