export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { readings, works, chapters, creatorships, pseuds } from '@/lib/schema';
import { eq, and, desc, sql, isNotNull } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Get all readings for this pseud, joined with work info and chapter count
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
    })
    .from(readings)
    .innerJoin(works, eq(readings.workId, works.id))
    .where(eq(readings.pseudId, pseudId))
    .orderBy(desc(readings.updatedAt))
    .all();

  // For each reading with a lastChapter, get the chapter position (progress)
  const enriched = await Promise.all(rows.map(async (row) => {
    let lastChapterPosition: number | null = null;
    if (row.lastChapter) {
      const chap = await db.select({ position: chapters.position })
        .from(chapters)
        .where(and(eq(chapters.id, row.lastChapter), eq(chapters.draft, 0)))
        .get();
      lastChapterPosition = chap?.position ?? null;
    }
    return {
      ...row,
      lastChapterPosition,
      progress: row.chapterCount > 0 && lastChapterPosition
        ? Math.round((lastChapterPosition / row.chapterCount) * 100)
        : 0,
    };
  }));

  return new Response(JSON.stringify(enriched), {
    headers: { 'Content-Type': 'application/json' },
  });
};