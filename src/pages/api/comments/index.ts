import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved, getAuth } from '@/v2/lib/auth';
import { validateBody } from '@/v2/lib/validation';
import { createCommentSchema } from '@/v2/lib/validation';
import { comments, works, pseuds } from '@/v2/lib/schema/index';
import { eq, desc } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// GET /api/comments?workId=X — Get comments for a work
export const GET: APIRoute = async ({ url, locals }) => {
  const workId = Number(url.searchParams.get('workId'));
  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'workId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const workComments = await db.select().from(comments)
    .where(eq(comments.workId, workId))
    .orderBy(desc(comments.createdAt));

  // Enrich with pseud names
  const enriched = await Promise.all(workComments.map(async (c) => {
    const pseud = await db.select({ id: pseuds.id, name: pseuds.name })
      .from(pseuds).where(eq(pseuds.id, c.pseudId)).get();
    return { ...c, author: pseud };
  }));

  return new Response(JSON.stringify({ data: enriched }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/comments — Create a comment
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const [data, error] = await validateBody(request, createCommentSchema);
  if (error) return error;

  const defaultPseud = await db.select().from(pseuds)
    .where(eq(pseuds.userId, auth.user.id)).get();

  if (!defaultPseud) {
    return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const newComment = await db.insert(comments).values({
    workId: data.workId ?? 0,
    chapterId: data.chapterId ?? null,
    pseudId: defaultPseud.id,
    parentId: data.parentId ?? null,
    content: data.content,
  }).returning();

  return new Response(JSON.stringify({ data: newComment[0] }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
};
