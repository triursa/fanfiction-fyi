export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { creatorships, pseuds, workRelations } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

// DELETE /api/works/[id]/relations/[relationId] — remove a relation (author-only)
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const workId = Number(params.id);
  const relationId = Number(params.relationId);
  if (!workId || !relationId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify the relation exists and belongs to this work
  const relation = await db.select().from(workRelations)
    .where(and(eq(workRelations.id, relationId), eq(workRelations.workId, workId))).get();
  if (!relation) {
    return new Response(JSON.stringify({ error: 'Relation not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify ownership — user must be an author of the source work
  const creatorship = await db.select().from(creatorships)
    .innerJoin(pseuds, eq(pseuds.id, creatorships.pseudId))
    .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!creatorship) {
    return new Response(JSON.stringify({ error: 'Forbidden — only the author can remove relations' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await db.delete(workRelations).where(eq(workRelations.id, relationId));

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};