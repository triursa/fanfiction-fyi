export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const reading = await queryFirst<any>(db, `SELECT * FROM readings WHERE pseud_id = ?1 AND work_id = ?2`, pseudId, workId);
  if (!reading) return new Response(JSON.stringify(null), { headers: { 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify(reading), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const last_chapter = body?.last_chapter ?? null;
  const for_later = body?.for_later !== undefined ? (body.for_later ? 1 : 0) : undefined;

  // Upsert: insert or update reading progress
  const existing = await queryFirst<any>(db, `SELECT id FROM readings WHERE pseud_id = ?1 AND work_id = ?2`, pseudId, workId);

  if (existing) {
    const sets: string[] = [`updated_at = datetime('now')`];
    const vals: unknown[] = [];
    if (last_chapter !== null) { sets.push('last_chapter = ?'); vals.push(last_chapter); }
    if (for_later !== undefined) { sets.push('for_later = ?'); vals.push(for_later); }
    vals.push(pseudId, workId);
    await run(db, `UPDATE readings SET ${sets.join(', ')} WHERE pseud_id = ? AND work_id = ?`, ...vals);
  } else {
    await run(
      db,
      `INSERT INTO readings (pseud_id, work_id, for_later, last_chapter, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))`,
      pseudId,
      workId,
      for_later ?? 0,
      last_chapter
    );
  }

  const reading = await queryFirst<any>(db, `SELECT * FROM readings WHERE pseud_id = ?1 AND work_id = ?2`, pseudId, workId);
  return new Response(JSON.stringify(reading), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  await run(db, `DELETE FROM readings WHERE pseud_id = ?1 AND work_id = ?2`, pseudId, workId);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};