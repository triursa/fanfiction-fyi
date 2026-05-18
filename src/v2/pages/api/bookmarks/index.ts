import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../lib/db';
import { requireAuth, checkApproved } from '../../../../lib/auth';
import { validateBody } from '../../../../lib/validation';
import { createBookmarkSchema } from '../../../../lib/validation';
import { bookmarks, works, pseuds } from '../../../../lib/schema/index';
import { eq, desc, inArray, and } from 'drizzle-orm';

export const config = { auth: 'required' as const };

// GET /api/bookmarks — List user's bookmarks
export const GET: APIRoute = async ({ url, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  // Get user's pseuds
  const userPseuds = await db.select().from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  const userBookmarks = await db.select({
    id: bookmarks.id, pseudId: bookmarks.pseudId, workId: bookmarks.workId,
    notes: bookmarks.notes, private: bookmarks.private, createdAt: bookmarks.createdAt,
  }).from(bookmarks)
    .where(inArray(bookmarks.pseudId, pseudIds))
    .orderBy(desc(bookmarks.createdAt));

  // Enrich with work data
  const enriched = await Promise.all(userBookmarks.map(async (b) => {
    const work = await db.select({ id: works.id, title: works.title, summary: works.summary, wordCount: works.wordCount })
      .from(works).where(eq(works.id, b.workId)).get();
    return { ...b, work };
  }));

  return new Response(JSON.stringify({ data: enriched }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/bookmarks — Create or toggle bookmark
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const [data, error] = await validateBody(request, createBookmarkSchema);
  if (error) return error;

  // Get default pseud
  const defaultPseud = await db.select().from(pseuds)
    .where(eq(pseuds.userId, auth.user.id)).get();

  // Check if already bookmarked
  const existing = await db.select().from(bookmarks)
    .where(and(eq(bookmarks.workId, data.workId ?? 0), eq(bookmarks.pseudId, defaultPseud!.id))).get();

  if (existing) {
    // Toggle: delete bookmark
    await db.delete(bookmarks).where(eq(bookmarks.id, existing.id));
    return new Response(JSON.stringify({ data: { bookmarked: false } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create bookmark
  const bookmark = await db.insert(bookmarks).values({
    pseudId: defaultPseud!.id,
    workId: data.workId ?? 0,
    notes: data.notes ?? null,
    private: data.private ? 1 : 0,
  }).returning();

  return new Response(JSON.stringify({ data: bookmark[0] }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
};
