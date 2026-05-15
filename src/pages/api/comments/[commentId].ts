import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { comments } from '@/v2/lib/schema/index';
import { eq } from 'drizzle-orm';

export const config = { auth: 'required' as const };

// DELETE /api/comments/:id — Delete comment (author or mod+ only)
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const commentId = Number(params.commentId);
  if (!commentId || isNaN(commentId)) {
    return new Response(JSON.stringify({ error: 'Invalid comment ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  const comment = await db.select().from(comments).where(eq(comments.id, commentId)).get();
  if (!comment) {
    return new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Only comment author or mod+ can delete
  if (comment.pseudId !== auth.user.id && !['mod', 'admin', 'founder'].includes(auth.user.role)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await db.delete(comments).where(eq(comments.id, commentId));
  return new Response(JSON.stringify({ data: { deleted: true } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
