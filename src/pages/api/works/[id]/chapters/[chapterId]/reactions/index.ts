export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

// Valid reaction types
const VALID_REACTIONS = ['fire', 'cry', 'heartbreak', 'swords', 'heart', 'mindblown'] as const;
type ReactionType = typeof VALID_REACTIONS[number];

// GET /api/works/[id]/chapters/[chapterId]/reactions — get counts + user's reactions
export const GET: APIRoute = async ({ params, locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const chapterId = Number(params.chapterId);
  if (!chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid chapter ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Get reaction counts for this chapter
  const rows = await queryAll<{ reaction: string; cnt: number }>(
    db,
    `SELECT reaction, COUNT(*) as cnt FROM chapter_reactions WHERE chapter_id = ?1 GROUP BY reaction`,
    chapterId
  );

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.reaction] = row.cnt;
  }

  // Get user's own reactions if authenticated
  let mine: string[] = [];
  const auth = await getAuth(db, request);
  if (auth) {
    const pseudId = auth.pseuds[0]?.id;
    if (pseudId) {
      const myRows = await queryAll<{ reaction: string }>(
        db,
        `SELECT reaction FROM chapter_reactions WHERE chapter_id = ?1 AND pseud_id = ?2`,
        chapterId,
        pseudId
      );
      mine = myRows.map(r => r.reaction);
    }
  }

  return new Response(JSON.stringify({ counts, mine }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

// POST /api/works/[id]/chapters/[chapterId]/reactions — toggle a reaction
// If reaction exists → remove it. If not → add it.
export const POST: APIRoute = async ({ params, locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const chapterId = Number(params.chapterId);
  if (!chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid chapter ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { reaction } = body || {};
  if (!reaction || !VALID_REACTIONS.includes(reaction)) {
    return new Response(JSON.stringify({ error: `Invalid reaction. Must be one of: ${VALID_REACTIONS.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudId = (body?.pseud_id && auth.pseuds.some((p: any) => p.id === Number(body.pseud_id))) ? Number(body.pseud_id) : auth.pseuds[0]?.id;
  if (!pseudId) {
    return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check if the chapter exists and belongs to the work
  const workId = Number(params.id);
  const chapter = await queryFirst<any>(db, `SELECT id FROM chapters WHERE id = ?1 AND work_id = ?2`, chapterId, workId);
  if (!chapter) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Toggle: if exists, delete; if not, insert
  const existing = await queryFirst<any>(
    db,
    `SELECT id FROM chapter_reactions WHERE chapter_id = ?1 AND pseud_id = ?2 AND reaction = ?3`,
    chapterId,
    pseudId,
    reaction
  );

  let active: boolean;
  if (existing) {
    await run(db, `DELETE FROM chapter_reactions WHERE id = ?1`, existing.id);
    active = false;
  } else {
    await run(db, `INSERT INTO chapter_reactions (chapter_id, pseud_id, reaction, created_at) VALUES (?1, ?2, ?3, datetime('now'))`, chapterId, pseudId, reaction);
    active = true;
  }

  // Get updated counts
  const rows = await queryAll<{ reaction: string; cnt: number }>(
    db,
    `SELECT reaction, COUNT(*) as cnt FROM chapter_reactions WHERE chapter_id = ?1 GROUP BY reaction`,
    chapterId
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.reaction] = row.cnt;
  }

  return new Response(JSON.stringify({ ok: true, active, counts }), {
    headers: { 'Content-Type': 'application/json' }
  });
};