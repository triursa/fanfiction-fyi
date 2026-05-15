export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { chapters, chapterReactions, pseuds } from '@/lib/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

const VALID_REACTIONS = ['fire', 'cry', 'heartbreak', 'swords', 'heart', 'mindblown'] as const;
type ReactionType = typeof VALID_REACTIONS[number];

// GET /api/works/[id]/chapters/[chapterId]/reactions — get counts + user's reactions
export const GET: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const chapterId = Number(params.chapterId);
  if (!chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid chapter ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Get reaction counts
  const rows = await db.select({
    reaction: chapterReactions.reaction,
    cnt: sql<number>`count(*)`.as('cnt'),
  }).from(chapterReactions)
    .where(eq(chapterReactions.chapterId, chapterId))
    .groupBy(chapterReactions.reaction);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.reaction] = row.cnt;
  }

  // Get user's own reactions if authenticated
  let mine: string[] = [];
  const auth = await getAuth(d1, request);
  if (auth) {
    const pseudId = auth.pseuds[0]?.id;
    if (pseudId) {
      const myRows = await db.select({ reaction: chapterReactions.reaction })
        .from(chapterReactions)
        .where(and(eq(chapterReactions.chapterId, chapterId), eq(chapterReactions.pseudId, pseudId)));
      mine = myRows.map(r => r.reaction);
    }
  }

  return new Response(JSON.stringify({ counts, mine }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

// POST — toggle a reaction
export const POST: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const chapterId = Number(params.chapterId);
  if (!chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid chapter ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { reaction } = body || {};
  if (!reaction || !VALID_REACTIONS.includes(reaction)) {
    return new Response(JSON.stringify({ error: `Invalid reaction. Must be one of: ${VALID_REACTIONS.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudId = (body?.pseud_id && auth.pseuds.some((p: any) => p.id === Number(body.pseud_id))) ? Number(body.pseud_id) : auth.pseuds[0]?.id;
  if (!pseudId) {
    return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check chapter exists
  const workId = Number(params.id);
  const chapter = await db.select({ id: chapters.id }).from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId))).get();
  if (!chapter) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Toggle
  const existing = await db.select({ id: chapterReactions.id }).from(chapterReactions)
    .where(and(eq(chapterReactions.chapterId, chapterId), eq(chapterReactions.pseudId, pseudId), eq(chapterReactions.reaction, reaction)))
    .get();

  let active: boolean;
  if (existing) {
    await db.delete(chapterReactions).where(eq(chapterReactions.id, existing.id));
    active = false;
  } else {
    await db.insert(chapterReactions).values({ chapterId, pseudId, reaction });
    active = true;
  }

  // Get updated counts
  const rows = await db.select({
    reaction: chapterReactions.reaction,
    cnt: sql<number>`count(*)`.as('cnt'),
  }).from(chapterReactions)
    .where(eq(chapterReactions.chapterId, chapterId))
    .groupBy(chapterReactions.reaction);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.reaction] = row.cnt;
  }

  return new Response(JSON.stringify({ ok: true, active, counts }), {
    headers: { 'Content-Type': 'application/json' }
  });
};