export const prerender = false;

import { queryFirst, run, queryAll } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

// POST /api/series/[id]/works — Add a work to a series
// Body: { work_id, position? }
// DELETE /api/series/[id]/works — Remove a work from a series
// Body: { work_id }

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const seriesId = Number(params.id);
  if (!seriesId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify series exists and user owns it
  const series = await queryFirst<any>(db, `SELECT * FROM series WHERE id = ?1`, seriesId);
  if (!series) return new Response(JSON.stringify({ error: 'Series not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isOwner = auth.pseuds.some((p: any) => p.id === series.creator_pseud_id);
  if (!isOwner) return new Response(JSON.stringify({ error: 'Forbidden — only the series creator can add works' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const workId = body?.work_id;
  if (!workId) return new Response(JSON.stringify({ error: 'work_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Verify work exists and is published (or user owns it)
  const work = await queryFirst<any>(db, `SELECT * FROM works WHERE id = ?1`, workId);
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Check that the user owns the work (must be author)
  const creatorship = await queryFirst<any>(
    db,
    `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (${auth.pseuds.map(() => '?').join(',')})`,
    workId,
    ...auth.pseuds.map((p: any) => p.id)
  );
  if (!creatorship) return new Response(JSON.stringify({ error: 'You can only add your own works to a series' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  // Check if work is already in this series
  const existing = await queryFirst<any>(db, `SELECT * FROM serial_works WHERE series_id = ?1 AND work_id = ?2`, seriesId, workId);
  if (existing) return new Response(JSON.stringify({ error: 'Work is already in this series' }), { status: 409, headers: { 'Content-Type': 'application/json' } });

  // Determine position
  const position = body?.position;
  if (position) {
    // Insert at specific position — shift others down
    await run(db, `UPDATE serial_works SET position = position + 1 WHERE series_id = ?1 AND position >= ?2`, seriesId, position);
    await run(db, `INSERT INTO serial_works (series_id, work_id, position) VALUES (?1, ?2, ?3)`, seriesId, workId, position);
  } else {
    // Append at end
    const maxPos = await queryFirst<any>(db, `SELECT MAX(position) as max_pos FROM serial_works WHERE series_id = ?1`, seriesId);
    const nextPos = (maxPos?.max_pos ?? 0) + 1;
    await run(db, `INSERT INTO serial_works (series_id, work_id, position) VALUES (?1, ?2, ?3)`, seriesId, workId, nextPos);
  }

  // Update series updated_at
  await run(db, `UPDATE series SET updated_at = datetime('now') WHERE id = ?1`, seriesId);

  return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const seriesId = Number(params.id);
  if (!seriesId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership
  const series = await queryFirst<any>(db, `SELECT * FROM series WHERE id = ?1`, seriesId);
  if (!series) return new Response(JSON.stringify({ error: 'Series not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isOwner = auth.pseuds.some((p: any) => p.id === series.creator_pseud_id);
  if (!isOwner) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const workId = body?.work_id;
  if (!workId) return new Response(JSON.stringify({ error: 'work_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const result = await run(db, `DELETE FROM serial_works WHERE series_id = ?1 AND work_id = ?2`, seriesId, workId);
  if (result.meta.changes === 0) {
    return new Response(JSON.stringify({ error: 'Work not found in series' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Re-index positions to be contiguous
  const remaining = await queryAll<any>(db, `SELECT id FROM serial_works WHERE series_id = ?1 ORDER BY position`, seriesId);
  for (let i = 0; i < remaining.length; i++) {
    await run(db, `UPDATE serial_works SET position = ?1 WHERE id = ?2`, i + 1, remaining[i].id);
  }

  // Update series updated_at
  await run(db, `UPDATE series SET updated_at = datetime('now') WHERE id = ?1`, seriesId);

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};