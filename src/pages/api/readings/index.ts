import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth } from '@/v2/lib/auth';
import { readings, works, pseuds } from '@/v2/lib/schema/index';
import { eq, desc, inArray, and } from 'drizzle-orm';

export const config = { auth: 'required' as const };

// GET /api/readings — Get reading history
export const GET: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  const userReadings = await db.select({
    id: readings.id, workId: readings.workId, forLater: readings.forLater,
    lastChapter: readings.lastChapter, updatedAt: readings.updatedAt,
  }).from(readings)
    .where(inArray(readings.pseudId, pseudIds))
    .orderBy(desc(readings.updatedAt));

  // Enrich with work data
  const enriched = await Promise.all(userReadings.map(async (r) => {
    const work = await db.select({ id: works.id, title: works.title, summary: works.summary, wordCount: works.wordCount, complete: works.complete })
      .from(works).where(eq(works.id, r.workId)).get();
    return { ...r, work };
  }));

  return new Response(JSON.stringify({ data: enriched }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/readings — Update reading progress or mark for later
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  const body = await request.json() as { workId: number; lastChapter?: number; forLater?: boolean };
  const { workId, lastChapter, forLater } = body;

  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'workId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (lastChapter !== undefined) updates.lastChapter = lastChapter;
  if (forLater !== undefined) updates.forLater = forLater ? 1 : 0;

  // Upsert reading
  const [defaultPseud] = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id)).limit(1);
  const existing = await db.select().from(readings)
    .where(and(eq(readings.workId, workId), eq(readings.pseudId, defaultPseud.id))).get();

  if (existing) {
    await db.update(readings).set(updates).where(eq(readings.id, existing.id));
  } else {
    await db.insert(readings).values({
      pseudId: defaultPseud.id,
      workId,
      ...updates,
    });
  }

  return new Response(JSON.stringify({ data: { updated: true } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
