export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await queryFirst<any>(db, `SELECT * FROM works WHERE id = ?1`, workId);
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const chapters = await queryAll<any>(db, `SELECT id, position, title, draft, word_count, updated_at FROM chapters WHERE work_id = ?1 ORDER BY position`, workId);
  const tags = await queryAll<any>(db, `SELECT t.* FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ?1`, workId);
  const pseuds = await queryAll<any>(db, `SELECT p.*, c.role FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1`, workId);

  return new Response(JSON.stringify({ work, chapters, tags, pseuds }), { headers: { 'Content-Type': 'application/json' } });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const creatorship = await queryFirst<any>(db, `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`, workId, auth.user.id);
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const fields: string[] = [];
  const values: any[] = [];
  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title); }
  if (body.summary !== undefined) { fields.push('summary = ?'); values.push(body.summary); }
  if (body.notes !== undefined) { fields.push('notes = ?'); values.push(body.notes); }
  if (body.end_notes !== undefined) { fields.push('end_notes = ?'); values.push(body.end_notes); }
  if (body.complete !== undefined) { fields.push('complete = ?'); values.push(body.complete ? 1 : 0); }
  if (body.language !== undefined) { fields.push('language = ?'); values.push(body.language); }

  if (fields.length === 0) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  fields.push("updated_at = datetime('now')");
  values.push(workId);

  await run(db, `UPDATE works SET ${fields.join(', ')} WHERE id = ?`, ...values);
  const work = await queryFirst<any>(db, `SELECT * FROM works WHERE id = ?1`, workId);
  return new Response(JSON.stringify(work), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const creatorship = await queryFirst<any>(db, `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`, workId, auth.user.id);
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  await run(db, `DELETE FROM works WHERE id = ?1`, workId);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};