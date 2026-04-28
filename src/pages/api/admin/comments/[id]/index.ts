export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { requireRole, getAuth } from '@/lib/auth';
import { UserRole } from '@/lib/types';
import type { APIRoute } from 'astro';

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const commentId = Number(params.id);
  if (!commentId || isNaN(commentId)) {
    return new Response(JSON.stringify({ error: 'Invalid comment ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Require mod+ role
  const auth = await requireRole(db, request, UserRole.Mod);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized or insufficient role' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const comment = await queryFirst<{ id: number }>(db, `SELECT id FROM comments WHERE id = ?1`, commentId);
  if (!comment) {
    return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  await run(db, `DELETE FROM comments WHERE id = ?1`, commentId);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};