export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { UserRole } from '@/lib/types';
import { comments } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const commentId = Number(params.id);
  if (!commentId || isNaN(commentId)) {
    return new Response(JSON.stringify({ error: 'Invalid comment ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Require mod+ role
  const auth = await requireRole(d1, request, UserRole.Mod);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if ('forbidden' in auth) return new Response(JSON.stringify({ error: 'Insufficient role' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  const db = getDrizzle(d1);
  const comment = await db.select({ id: comments.id }).from(comments).where(eq(comments.id, commentId)).get();
  if (!comment) {
    return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  await db.delete(comments).where(eq(comments.id, commentId));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};