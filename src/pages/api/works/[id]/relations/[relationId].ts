export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

// DELETE /api/works/[id]/relations/[relationId] — remove a relation (author-only)
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const workId = Number(params.id);
  const relationId = Number(params.relationId);
  if (!workId || !relationId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify the relation exists and belongs to this work
  const relation = await queryFirst<any>(db, `SELECT * FROM work_relations WHERE id = ?1 AND work_id = ?2`, relationId, workId);
  if (!relation) {
    return new Response(JSON.stringify({ error: 'Relation not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify ownership — user must be an author of the source work
  const creatorship = await queryFirst<any>(
    db,
    `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`,
    workId, auth.user.id
  );
  if (!creatorship) {
    return new Response(JSON.stringify({ error: 'Forbidden — only the author can remove relations' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await run(db, `DELETE FROM work_relations WHERE id = ?1`, relationId);

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};