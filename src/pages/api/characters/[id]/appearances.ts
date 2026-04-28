export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';
import type { CharacterRole } from '@/lib/types';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

const VALID_ROLES: CharacterRole[] = ['protagonist', 'deuteragonist', 'antagonist', 'side', 'cameo'];

// GET /api/characters/[id]/appearances — List appearances for a character
export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const id = Number(params.id);
  if (!id) return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });

  const page = Math.max(Number(new URL(request.url).searchParams.get('page') || 1), 1);
  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') || 25), 100);
  const offset = (page - 1) * limit;

  const appearances = await queryAll<any>(
    db,
    `SELECT ca.*, w.title as work_title, w.summary as work_summary, w.word_count, w.published_at,
            w.complete as work_complete
     FROM character_appearances ca
     JOIN works w ON ca.work_id = w.id
     WHERE ca.character_id = ?1
     ORDER BY ca.created_at DESC
     LIMIT ?2 OFFSET ?3`,
    id, limit, offset
  );

  const countRow = await queryFirst<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM character_appearances WHERE character_id = ?1`,
    id
  );

  return new Response(JSON.stringify({ appearances, total: countRow?.count ?? 0, page, limit }), {
    headers: { 'Content-Type': 'application/json', ...cors },
  });
};

// POST /api/characters/[id]/appearances — Add character to a work
export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const id = Number(params.id);
  if (!id) return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const character = await queryFirst<any>(db, `SELECT * FROM characters WHERE id = ?1`, id);
  if (!character) return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { work_id, role, notes } = body || {};
  if (!work_id) return new Response(JSON.stringify({ error: 'work_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Validate work exists
  const work = await queryFirst<any>(db, `SELECT id FROM works WHERE id = ?1`, Number(work_id));
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const charRole: CharacterRole = (role && VALID_ROLES.includes(role)) ? role : 'side';
  const pseudId = auth.pseuds[0]?.id ?? null;

  try {
    const result = await run(
      db,
      `INSERT INTO character_appearances (character_id, work_id, role, notes, added_by) VALUES (?1, ?2, ?3, ?4, ?5)`,
      id, Number(work_id), charRole, notes || null, pseudId
    );

    const appearance = await queryFirst<any>(db, `SELECT * FROM character_appearances WHERE id = ?1`, result.meta.last_row_id);
    return new Response(JSON.stringify(appearance), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Character already linked to this work' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};