export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

// DELETE /api/characters/[id]/appearances/[workId] — Remove character from a work
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const id = Number(params.id);
  const workId = Number(params.workId);
  if (!id || !workId) return new Response(JSON.stringify({ error: 'Invalid IDs' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const existing = await queryFirst<any>(
    db,
    `SELECT * FROM character_appearances WHERE character_id = ?1 AND work_id = ?2`,
    id, workId
  );
  if (!existing) return new Response(JSON.stringify({ error: 'Appearance not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Permission: the person who added it, or admin/mod
  const isAdder = existing.added_by && auth.pseuds.some(p => p.id === existing.added_by);
  const isPrivileged = ['admin', 'mod', 'founder'].includes(auth.user.role);
  if (!isAdder && !isPrivileged) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await run(db, `DELETE FROM character_appearances WHERE character_id = ?1 AND work_id = ?2`, id, workId);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};