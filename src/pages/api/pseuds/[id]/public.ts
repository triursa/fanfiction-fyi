export const prerender = false;

import { queryAll, queryFirst } from '@/lib/db';
import type { APIRoute } from 'astro';

/**
 * GET /api/pseuds/[id]/public — public pseud portfolio data
 * Returns pseud info, pinned works, all works (with tags), stats, and activity dates.
 * No auth required — this is a public endpoint.
 */
export const GET: APIRoute = async ({ locals, params }) => {
  const db = locals.runtime.env.DB as D1Database;
  const pseudId = parseInt(params.id ?? '', 10);
  if (isNaN(pseudId)) {
    return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Get pseud details
  const pseud = await queryFirst<any>(db, `SELECT id, name, description, icon_key, banner_key, pinned_work_ids, created_at FROM pseuds WHERE id = ?1`, pseudId);
  if (!pseud) {
    return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Parse pinned_work_ids JSON
  let pinnedIds: number[] = [];
  try {
    pinnedIds = JSON.parse(pseud.pinned_work_ids || '[]');
    if (!Array.isArray(pinnedIds)) pinnedIds = [];
  } catch { pinnedIds = []; }

  // Get all published works by this pseud
  const works = await queryAll<any>(db, `
    SELECT w.id, w.title, w.summary, w.word_count, w.complete, w.published_at, w.updated_at, w.language,
      c.role as creatorship_role
    FROM works w
    JOIN creatorships c ON c.work_id = w.id
    WHERE c.pseud_id = ?1 AND w.published_at IS NOT NULL
    ORDER BY w.updated_at DESC
  `, pseudId);

  const workIds = works.map((w: any) => w.id);

  // Get tags for all works
  const workTags: Record<number, any[]> = {};
  if (workIds.length > 0) {
    const placeholders = workIds.map(() => '?').join(',');
    const tags = await queryAll<any>(db, `
      SELECT tg.work_id, t.id, t.name, t.type
      FROM tags t
      JOIN taggings tg ON t.id = tg.tag_id
      WHERE tg.work_id IN (${placeholders})
    `, ...workIds);
    for (const tag of tags) {
      if (!workTags[tag.work_id]) workTags[tag.work_id] = [];
      workTags[tag.work_id].push({ id: tag.id, name: tag.name, type: tag.type });
    }
  }

  // Get pinned works (separate query to maintain pin order)
  let pinnedWorks: any[] = [];
  if (pinnedIds.length > 0) {
    // Filter pinnedIds to only include published works by this pseud
    const validPinnedIds = pinnedIds.filter((id: number) => workIds.includes(id));
    if (validPinnedIds.length > 0) {
      const placeholders = validPinnedIds.map(() => '?').join(',');
      pinnedWorks = await queryAll<any>(db, `
        SELECT w.id, w.title, w.summary, w.word_count, w.complete, w.published_at, w.updated_at, w.language
        FROM works w
        WHERE w.id IN (${placeholders}) AND w.published_at IS NOT NULL
        ORDER BY CASE w.id ${validPinnedIds.map((id: number, i: number) => `WHEN ? THEN ${i}`).join(' ')} END
      `, ...validPinnedIds, ...validPinnedIds);
    }
    // Get tags for pinned works
    if (pinnedWorks.length > 0) {
      const pinnedWorkIds = pinnedWorks.map(w => w.id);
      const placeholders = pinnedWorkIds.map(() => '?').join(',');
      const pinnedTags = await queryAll<any>(db, `
        SELECT tg.work_id, t.id, t.name, t.type
        FROM tags t
        JOIN taggings tg ON t.id = tg.tag_id
        WHERE tg.work_id IN (${placeholders})
      `, ...pinnedWorkIds);
      const pinnedWorkTags: Record<number, any[]> = {};
      for (const tag of pinnedTags) {
        if (!pinnedWorkTags[tag.work_id]) pinnedWorkTags[tag.work_id] = [];
        pinnedWorkTags[tag.work_id].push({ id: tag.id, name: tag.name, type: tag.type });
      }
      pinnedWorks = pinnedWorks.map(w => ({ ...w, tags: pinnedWorkTags[w.id] || [] }));
    }
  }

  // Attach tags to all works
  const worksWithTags = works.map((w: any) => ({
    ...w,
    tags: workTags[w.id] || [],
  }));

  // Get kudos count per work (for portfolio display)
  const kudosMap: Record<number, number> = {};
  if (workIds.length > 0) {
    const placeholders = workIds.map(() => '?').join(',');
    const kudosRows = await queryAll<any>(db, `
      SELECT work_id, COUNT(*) as cnt FROM kudos WHERE work_id IN (${placeholders}) GROUP BY work_id
    `, ...workIds);
    for (const row of kudosRows) kudosMap[row.work_id] = row.cnt;
  }

  // Stats computation
  const totalWords = works.reduce((sum: number, w: any) => sum + (w.word_count || 0), 0);
  const totalWorks = works.length;
  const completedWorks = works.filter((w: any) => w.complete === 1).length;

  // Genre distribution (tag type = fandom + freeform)
  const genreCounts: Record<string, number> = {};
  for (const w of worksWithTags) {
    const fandoms = (w.tags || []).filter((t: any) => t.type === 'fandom');
    const freeforms = (w.tags || []).filter((t: any) => t.type === 'freeform');
    for (const tag of [...fandoms, ...freeforms]) {
      genreCounts[tag.name] = (genreCounts[tag.name] || 0) + 1;
    }
  }
  // Top 8 genres for the pie chart
  const genreDistribution = Object.entries(genreCounts)
    .sort(([, a]: any, [, b]: any) => b - a)
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Word count over time (sparkline data) — by month
  const wordsByMonth: Record<string, number> = {};
  if (workIds.length > 0) {
    const placeholders = workIds.map(() => '?').join(',');
    const chapterData = await queryAll<any>(db, `
      SELECT c.word_count, c.updated_at
      FROM chapters c
      WHERE c.work_id IN (${placeholders}) AND c.draft = 0
    `, ...workIds);
    for (const ch of chapterData) {
      if (!ch.updated_at) continue;
      const month = ch.updated_at.substring(0, 7); // YYYY-MM
      wordsByMonth[month] = (wordsByMonth[month] || 0) + (ch.word_count || 0);
    }
  }
  const wordCountTimeline = Object.entries(wordsByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, words]) => ({ month, words }));

  // Activity dates for heat map (publication dates of chapters)
  const activityDates: Record<string, number> = {};
  if (workIds.length > 0) {
    const placeholders = workIds.map(() => '?').join(',');
    // Use published_at from works + updated_at from published chapters
    const pubDates = await queryAll<any>(db, `
      SELECT published_at FROM works WHERE id IN (${placeholders}) AND published_at IS NOT NULL
    `, ...workIds);
    for (const row of pubDates) {
      if (row.published_at) {
        const day = row.published_at.substring(0, 10); // YYYY-MM-DD
        activityDates[day] = (activityDates[day] || 0) + 1;
      }
    }
  }

  // Update cadence (average days between published works)
  let avgUpdateCadence = 0;
  if (works.length >= 2) {
    const pubDates = works
      .map((w: any) => w.published_at)
      .filter(Boolean)
      .sort();
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

  // Total kudos received
  const totalKudos = Object.values(kudosMap).reduce((sum: number, n: any) => sum + n, 0);

  return new Response(JSON.stringify({
    pseud: {
      id: pseud.id,
      name: pseud.name,
      description: pseud.description,
      icon_key: pseud.icon_key,
      banner_key: pseud.banner_key,
      created_at: pseud.created_at,
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