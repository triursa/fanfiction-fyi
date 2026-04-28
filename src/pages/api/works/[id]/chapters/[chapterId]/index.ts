export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const creatorship = await queryFirst<any>(db, `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`, workId, auth.user.id);
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  const chapter = await queryFirst<any>(db, `SELECT * FROM chapters WHERE id = ?1 AND work_id = ?2`, chapterId, workId);
  if (!chapter) return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  await run(db, `INSERT INTO chapter_versions (chapter_id, version, content_md, content_html, note, created_at) SELECT id, (SELECT COALESCE(MAX(version), 0) + 1 FROM chapter_versions WHERE chapter_id = ?1), content_md, content_html, 'Auto-save before update', datetime('now') FROM chapters WHERE id = ?1`, chapterId);

  const fields: string[] = [];
  const values: any[] = [];

  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title); }
  if (body.content_md !== undefined) {
    fields.push('content_md = ?'); values.push(body.content_md);
    const html = markdownToHtml(body.content_md);
    fields.push('content_html = ?'); values.push(html);
    fields.push('word_count = ?'); values.push(body.content_md.split(/\s+/).filter(Boolean).length);
  }
  if (body.position !== undefined) { fields.push('position = ?'); values.push(body.position); }
  if (body.draft !== undefined) { fields.push('draft = ?'); values.push(body.draft ? 1 : 0); }

  // Mood engine: accept mood field (nullable, validated against known moods)
  const VALID_MOODS = ['cozy', 'tense', 'melancholy', 'triumphant', 'romantic', 'horror', 'flashback', 'action'];
  if ('mood' in body) {
    const mood = body.mood === null ? null : String(body.mood);
    if (mood !== null && !VALID_MOODS.includes(mood)) {
      return new Response(JSON.stringify({ error: 'Invalid mood value', valid: VALID_MOODS }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    fields.push('mood = ?'); values.push(mood);
  }

  // Handle images array — JSON array of R2 keys
  if (body.images !== undefined) {
    // Validate: must be an array of strings starting with 'chapters/'
    const images: string[] = Array.isArray(body.images) ? body.images : [];
    const validImages = images.filter((img: string) => typeof img === 'string' && img.startsWith('chapters/') && !img.includes('..'));
    fields.push('images = ?'); values.push(JSON.stringify(validImages));
  }

  if (fields.length === 0) return new Response(JSON.stringify(chapter), { headers: { 'Content-Type': 'application/json' } });

  fields.push("updated_at = datetime('now')");
  values.push(chapterId);

  await run(db, `UPDATE chapters SET ${fields.join(', ')} WHERE id = ?`, ...values);
  await run(db, `UPDATE works SET updated_at = datetime('now') WHERE id = ?1`, workId);
  await run(db, `UPDATE works SET word_count = (SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE work_id = ?1 AND draft = 0) WHERE id = ?1`, workId);

  const updated = await queryFirst<any>(db, `SELECT * FROM chapters WHERE id = ?1`, chapterId);
  return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
};