export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const creatorship = await queryFirst<any>(db, `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`, workId, auth.user.id);
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  await run(db, `UPDATE chapters SET draft = 0, updated_at = datetime('now') WHERE id = ?1 AND work_id = ?2`, chapterId, workId);
  await run(db, `UPDATE works SET published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now') WHERE id = ?1`, workId);
  await run(db, `UPDATE works SET word_count = (SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE work_id = ?1 AND draft = 0) WHERE id = ?1`, workId);

  const chapter = await queryFirst<any>(db, `SELECT * FROM chapters WHERE id = ?1`, chapterId);
  return new Response(JSON.stringify(chapter), { headers: { 'Content-Type': 'application/json' } });
};