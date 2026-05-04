export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { pseuds, works, creatorships, tags, taggings, kudos, chapters } from '@/lib/schema';
import { eq, sql, and, isNotNull, inArray, desc } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/**
 * GET /api/pseuds/[id]/public — public pseud portfolio data
 * Returns pseud info, pinned works, all works (with tags), stats, and activity dates.
 * No auth required — this is a public endpoint.
 */
export const GET: APIRoute = async ({ locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const pseudId = parseInt(params.id ?? '', 10);
  if (isNaN(pseudId)) {
    return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Get pseud details
  const pseud = await db.select({
    id: pseuds.id,
    name: pseuds.name,
    description: pseuds.description,
    iconKey: pseuds.iconKey,
    bannerKey: pseuds.bannerKey,
    pinnedWorkIds: pseuds.pinnedWorkIds,
    createdAt: pseuds.createdAt,
  }).from(pseuds).where(eq(pseuds.id, pseudId)).get();
  if (!pseud) {
    return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Parse pinned_work_ids JSON
  let pinnedIds: number[] = [];
  try {
    pinnedIds = JSON.parse(pseud.pinnedWorkIds || '[]');
    if (!Array.isArray(pinnedIds)) pinnedIds = [];
  } catch { pinnedIds = []; }

  // Get all published works by this pseud (JOIN query)
  const worksList = await db.select({
    id: works.id,
    title: works.title,
    summary: works.summary,
    wordCount: works.wordCount,
    complete: works.complete,
    publishedAt: works.publishedAt,
    updatedAt: works.updatedAt,
    language: works.language,
    creatorshipRole: creatorships.role,
  }).from(works)
    .innerJoin(creatorships, eq(creatorships.workId, works.id))
    .where(and(eq(creatorships.pseudId, pseudId), isNotNull(works.publishedAt)))
    .orderBy(desc(works.updatedAt));

  const workIds = worksList.map(w => w.id);

  // Get tags for all works using raw SQL for dynamic IN clause
  const workTags: Record<number, any[]> = {};
  if (workIds.length > 0) {
    const tagRows = await db.execute(sql`
      SELECT tg.work_id, t.id, t.name, t.type
      FROM tags t
      JOIN taggings tg ON t.id = tg.tag_id
      WHERE tg.work_id IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})
    `);
    for (const tag of tagRows.rows as any[]) {
      if (!workTags[tag.work_id]) workTags[tag.work_id] = [];
      workTags[tag.work_id].push({ id: tag.id, name: tag.name, type: tag.type });
    }
  }

  // Get pinned works
  let pinnedWorks: any[] = [];
  if (pinnedIds.length > 0) {
    const validPinnedIds = pinnedIds.filter((id: number) => workIds.includes(id));
    if (validPinnedIds.length > 0) {
      const pinned = await db.select({
        id: works.id,
        title: works.title,
        summary: works.summary,
        wordCount: works.wordCount,
        complete: works.complete,
        publishedAt: works.publishedAt,
        updatedAt: works.updatedAt,
        language: works.language,
      }).from(works)
        .where(and(
          inArray(works.id, validPinnedIds),
          isNotNull(works.publishedAt),
        ));

      // Sort by pin order
      const orderMap = new Map(validPinnedIds.map((id: number, i: number) => [id, i]));
      pinnedWorks = pinned.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));

      // Get tags for pinned works
      const pinnedWorkIds = pinnedWorks.map(w => w.id);
      if (pinnedWorkIds.length > 0) {
        const pinnedTagRows = await db.execute(sql`
          SELECT tg.work_id, t.id, t.name, t.type
          FROM tags t
          JOIN taggings tg ON t.id = tg.tag_id
          WHERE tg.work_id IN (${sql.join(pinnedWorkIds.map(id => sql`${id}`), sql`, `)})
        `);
        const pinnedWorkTags: Record<number, any[]> = {};
        for (const tag of pinnedTagRows.rows as any[]) {
          if (!pinnedWorkTags[tag.work_id]) pinnedWorkTags[tag.work_id] = [];
          pinnedWorkTags[tag.work_id].push({ id: tag.id, name: tag.name, type: tag.type });
        }
        pinnedWorks = pinnedWorks.map(w => ({ ...w, tags: pinnedWorkTags[w.id] || [] }));
      }
    }
  }

  // Attach tags to all works
  const worksWithTags = worksList.map(w => ({
    ...w,
    tags: workTags[w.id] || [],
  }));

  // Get kudos count per work
  const kudosMap: Record<number, number> = {};
  if (workIds.length > 0) {
    const kudosRows = await db.select({
      workId: kudos.workId,
      cnt: sql<number>`count(*)`.as('cnt'),
    }).from(kudos)
      .where(inArray(kudos.workId, workIds))
      .groupBy(kudos.workId);
    for (const row of kudosRows) kudosMap[row.workId] = row.cnt;
  }

  // Stats computation
  const totalWords = worksList.reduce((sum, w) => sum + (w.wordCount || 0), 0);
  const totalWorks = worksList.length;
  const completedWorks = worksList.filter(w => w.complete === 1).length;

  // Genre distribution (tag type = fandom + freeform)
  const genreCounts: Record<string, number> = {};
  for (const w of worksWithTags) {
    const fandoms = (w.tags || []).filter((t: any) => t.type === 'fandom');
    const freeforms = (w.tags || []).filter((t: any) => t.type === 'freeform');
    for (const tag of [...fandoms, ...freeforms]) {
      genreCounts[tag.name] = (genreCounts[tag.name] || 0) + 1;
    }
  }
  const genreDistribution = Object.entries(genreCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Word count over time (sparkline data) — by month
  const wordsByMonth: Record<string, number> = {};
  if (workIds.length > 0) {
    const chapterData = await db.select({
      wordCount: chapters.wordCount,
      updatedAt: chapters.updatedAt,
    }).from(chapters)
      .where(and(inArray(chapters.workId, workIds), eq(chapters.draft, 0)));
    for (const ch of chapterData) {
      if (!ch.updatedAt) continue;
      const month = ch.updatedAt.substring(0, 7); // YYYY-MM
      wordsByMonth[month] = (wordsByMonth[month] || 0) + (ch.wordCount || 0);
    }
  }
  const wordCountTimeline = Object.entries(wordsByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, words]) => ({ month, words }));

  // Activity dates for heat map (publication dates)
  const activityDates: Record<string, number> = {};
  if (workIds.length > 0) {
    const pubDates = await db.select({ publishedAt: works.publishedAt })
      .from(works)
      .where(and(inArray(works.id, workIds), isNotNull(works.publishedAt)));
    for (const row of pubDates) {
      if (row.publishedAt) {
        const day = row.publishedAt.substring(0, 10); // YYYY-MM-DD
        activityDates[day] = (activityDates[day] || 0) + 1;
      }
    }
  }

  // Update cadence (average days between published works)
  let avgUpdateCadence = 0;
  if (worksList.length >= 2) {
    const pubDates = worksList
      .map(w => w.publishedAt)
      .filter(Boolean)
      .sort() as string[];
    if (pubDates.length >= 2) {
      let totalDays = 0;
      for (let i = 1; i < pubDates.length; i++) {
        const d1 = new Date(pubDates[i - 1]);
        const d2 = new Date(pubDates[i]);
        totalDays += (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
      }
      avgUpdateCadence = Math.round(totalDays / (pubDates.length - 1));
    }
  }

  const totalKudos = Object.values(kudosMap).reduce((sum, n) => sum + n, 0);

  return new Response(JSON.stringify({
    pseud: {
      id: pseud.id,
      name: pseud.name,
      description: pseud.description,
      icon_key: pseud.iconKey,
      banner_key: pseud.bannerKey,
      created_at: pseud.createdAt,
    },
    pinnedWorks,
    works: worksWithTags,
    kudos: kudosMap,
    stats: {
      totalWorks,
      totalWords,
      completedWorks,
      totalKudos,
      avgUpdateCadence,
      genreDistribution,
      wordCountTimeline,
    },
    activity: activityDates,
  }), { headers: { 'Content-Type': 'application/json' } });
};