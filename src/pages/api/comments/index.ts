import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved, getAuth } from '@/v2/lib/auth';
import { validateBody } from '@/v2/lib/validation';
import { createCommentSchema } from '@/v2/lib/validation';
import { comments, works, pseuds, creatorships } from '@/v2/lib/schema/index';
import { eq, desc } from 'drizzle-orm';
import { notify } from '@/v2/lib/notify';

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

  const workId = data.workId ?? 0;
  const newComment = await db.insert(comments).values({
    workId,
    chapterId: data.chapterId ?? null,
    pseudId: defaultPseud.id,
    parentId: data.parentId ?? null,
    content: data.content,
  }).returning();

  // Notify work owner of new comment
  try {
    const work = await db.select().from(works).where(eq(works.id, workId)).get();
    if (work) {
      // Find all creator pseuds for this work
      const creatorLinks = await db.select({ pseudId: creatorships.pseudId })
        .from(creatorships)
        .where(eq(creatorships.workId, workId));
      for (const link of creatorLinks) {
        const pseud = await db.select({ userId: pseuds.userId })
          .from(pseuds)
          .where(eq(pseuds.id, link.pseudId))
          .get();
        if (pseud && pseud.userId !== auth.user.id) {
          await notify(d1, pseud.userId, {
            type: 'comment.new',
            title: 'New comment on your work',
            body: `${auth.user.displayName || 'Someone'} commented on "${work.title}"`,
            link: `/works/${workId}`,
          });
        }
      }
    }
  } catch { /* notification failure should not break comment creation */ }

  return new Response(JSON.stringify({ data: newComment[0] }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
};
