import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../../../lib/db';
import { requireAuth, checkApproved } from '../../../../../../lib/auth';
import { validateBody } from '../../../../../../lib/validation';
import { reorderChaptersSchema } from '../../../../../../lib/validation';
import { chapters, creatorships, pseuds, works } from '../../../../../../lib/schema/index';
import { eq, and } from 'drizzle-orm';

export const config = { auth: 'required' as const };

// POST /api/works/:id/chapters/reorder — Reorder chapters
export const POST: APIRoute = async ({ params, request, locals }) => {
  const workId = Number(params.id);
  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify authorship
  const userPseuds = await db.select().from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);
  const isAuthor = pseudIds.length > 0 && await db.select().from(creatorships)
    .where(eq(creatorships.workId, workId))
    .then(rows => rows.some(c => pseudIds.includes(c.pseudId)));

  if (!isAuthor) {
    return new Response(JSON.stringify({ error: 'Not an author of this work' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const [data, error] = await validateBody(request, reorderChaptersSchema);
  if (error) return error;

  // Update positions
  for (let i = 0; i < data.chapterIds.length; i++) {
    await db.update(chapters).set({ position: i + 1 }).where(and(eq(chapters.id, data.chapterIds[i]), eq(chapters.workId, workId)));
  }

  return new Response(JSON.stringify({ data: { reordered: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
