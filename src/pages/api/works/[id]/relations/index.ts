export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

const VALID_RELATION_TYPES = ['inspired_by', 'remix_of', 'response_to', 'alternate_pov', 'continuation_of', 'fix_it_for'];

// Inverse relation labels for bidirectional display
const INVERSE_LABELS: Record<string, string> = {
  inspired_by: 'inspired',
  remix_of: 'remixed by',
  response_to: 'responded to by',
  alternate_pov: 'alternate pov of',
  continuation_of: 'continued by',
  fix_it_for: 'fix-it for',
};

export function getInverseLabel(relationType: string): string {
  return INVERSE_LABELS[relationType] || relationType;
}

// GET /api/works/[id]/relations — list all relations (outgoing + incoming) for a work
export const GET: APIRoute = async ({ params, locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await queryFirst<any>(db, `SELECT id FROM works WHERE id = ?1`, workId);
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Outgoing relations: this work → other works
  const outgoing = await queryAll<any>(
    db,
    `SELECT wr.id, wr.work_id, wr.related_work_id, wr.relation_type, wr.created_at,
            w.title as related_title, w.word_count as related_word_count
     FROM work_relations wr
     JOIN works w ON w.id = wr.related_work_id
     WHERE wr.work_id = ?1
     ORDER BY wr.created_at DESC`,
    workId
  );

  // Incoming relations: other works → this work
  const incoming = await queryAll<any>(
    db,
    `SELECT wr.id, wr.work_id, wr.related_work_id, wr.relation_type, wr.created_at,
            w.title as source_title, w.word_count as source_word_count
     FROM work_relations wr
     JOIN works w ON w.id = wr.work_id
     WHERE wr.related_work_id = ?1
     ORDER BY wr.created_at DESC`,
    workId
  );

  // Format incoming with inverse labels
  const incomingFormatted = incoming.map(r => ({
    id: r.id,
    work_id: r.related_work_id,
    related_work_id: r.work_id,
    relation_type: r.relation_type,
    inverse_label: getInverseLabel(r.relation_type),
    direction: 'incoming',
    related_title: r.source_title,
    related_word_count: r.source_word_count,
    created_at: r.created_at,
  }));

  // Format outgoing
  const outgoingFormatted = outgoing.map(r => ({
    id: r.id,
    work_id: r.work_id,
    related_work_id: r.related_work_id,
    relation_type: r.relation_type,
    direction: 'outgoing',
    related_title: r.related_title,
    related_word_count: r.related_word_count,
    created_at: r.created_at,
  }));

  return new Response(JSON.stringify({ outgoing: outgoingFormatted, incoming: incomingFormatted }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/works/[id]/relations — add a relation (author-only)
export const POST: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { related_work_id, relation_type } = body;
  if (!related_work_id || !relation_type) {
    return new Response(JSON.stringify({ error: 'related_work_id and relation_type are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!VALID_RELATION_TYPES.includes(relation_type)) {
    return new Response(JSON.stringify({ error: `Invalid relation_type. Valid types: ${VALID_RELATION_TYPES.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (Number(related_work_id) === workId) {
    return new Response(JSON.stringify({ error: 'A work cannot relate to itself' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify target work exists
  const targetWork = await queryFirst<any>(db, `SELECT id, published_at FROM works WHERE id = ?1`, related_work_id);
  if (!targetWork) {
    return new Response(JSON.stringify({ error: 'Related work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify ownership — user must be an author of the source work
  const creatorship = await queryFirst<any>(
    db,
    `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`,
    workId, auth.user.id
  );
  if (!creatorship) {
    return new Response(JSON.stringify({ error: 'Forbidden — only the author can add relations' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Check for duplicate
  const existing = await queryFirst<any>(
    db,
    `SELECT id FROM work_relations WHERE work_id = ?1 AND related_work_id = ?2 AND relation_type = ?3`,
    workId, related_work_id, relation_type
  );
  if (existing) {
    return new Response(JSON.stringify({ error: 'This relation already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  // Insert the relation
  const result = await run(
    db,
    `INSERT INTO work_relations (work_id, related_work_id, relation_type) VALUES (?1, ?2, ?3)`,
    workId, related_work_id, relation_type
  );

  return new Response(JSON.stringify({
    id: result.meta.last_row_id,
    work_id: workId,
    related_work_id: Number(related_work_id),
    relation_type,
  }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};