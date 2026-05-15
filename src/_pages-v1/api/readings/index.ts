export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { cacheHeaders } from '@/lib/cors';
import { readings, works } from '@/lib/schema';
import { eq, desc, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const defaultPseud = auth.pseuds.find(p => p.isDefault === 1) ?? auth.pseuds[0];
  if (!defaultPseud) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Get all readings for this pseud, joined with work info, chapter count, and last chapter position
  const rows = await db
    .select({
      readingId: readings.id,
      workId: readings.workId,
      forLater: readings.forLater,
      lastChapter: readings.lastChapter,
      updatedAt: readings.updatedAt,
      workTitle: works.title,
      workSummary: works.summary,
      wordCount: works.wordCount,
      complete: works.complete,
      workUpdatedAt: works.updatedAt,
      // Published chapter count
      chapterCount: sql<number>`(SELECT COUNT(*) FROM chapters WHERE chapters.work_id = works.id AND chapters.draft = 0)`,
      // Last-read chapter position (null when no chapter recorded)
      lastChapterPosition: sql<number | null>`(SELECT position FROM chapters WHERE id = readings.last_chapter AND draft = 0)`,
    })
    .from(readings)
    .innerJoin(works, eq(readings.workId, works.id))
    .where(eq(readings.pseudId, defaultPseud.id))
    .orderBy(desc(readings.updatedAt))
    .all();

  const enriched = rows.map((row) => ({
    ...row,
    progress: row.chapterCount > 0 && row.lastChapterPosition
      ? Math.round((row.lastChapterPosition / row.chapterCount) * 100)
      : 0,
  }));

  return new Response(JSON.stringify(enriched), {
    headers: { 'Content-Type': 'application/json', ...cacheHeaders('private') },
  });
};