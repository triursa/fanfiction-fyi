import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { works, tags, taggings, kudos, creatorships, pseuds } from '@/v2/lib/schema/index';
import { eq, and, ne, desc, sql } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── Types ──────────────────────────────────────────────────────

interface RecommendedWork {
  id: number;
  title: string;
  summary: string | null;
  wordCount: number;
  complete: number;
  publishedAt: string | null;
  authors: { pseudId: number; pseudName: string }[];
  overlap: number;
  matchMethod: 'kudos' | 'tags' | 'recent';
  fandoms: { id: number; name: string }[];
}

type MatchMethod = 'kudos' | 'tags' | 'recent';

const CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=300, s-maxage=600',
  'Content-Type': 'application/json',
};

const TAG_WEIGHTS: Record<string, number> = {
  fandom: 3,
  relationship: 2,
  character: 2,
  freeform: 1,
  rating: 1,
  warning: 1,
  category: 1,
};

// ─── GET /api/works/[id]/recommendations ────────────────────────

export const GET: APIRoute = async ({ locals, params, url }) => {
  const workId = Number(params?.id);
  if (!workId || Number.isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), {
      status: 400,
      headers: CACHE_HEADERS,
    });
  }

  const forceMethod = url.searchParams.get('method') as MatchMethod | null;
  if (forceMethod && !['kudos', 'tags', 'recent'].includes(forceMethod)) {
    return new Response(JSON.stringify({ error: 'Invalid method. Use kudos, tags, or recent.' }), {
      status: 400,
      headers: CACHE_HEADERS,
    });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  try {
    // Verify source work exists and is published
    const sourceWork = await db
      .select({ id: works.id })
      .from(works)
      .where(eq(works.id, workId))
      .get();

    if (!sourceWork) {
      return new Response(JSON.stringify({ error: 'Work not found' }), {
        status: 404,
        headers: CACHE_HEADERS,
      });
    }

    let recommendations: RecommendedWork[] = [];
    let method: MatchMethod = 'kudos';

    // Strategy 1: Kudos collaborative filtering (primary)
    if (forceMethod === 'kudos' || !forceMethod) {
      const kudosRecs = await getKudosRecommendations(db, workId);
      if (kudosRecs.length >= 3) {
        recommendations = kudosRecs;
        method = 'kudos';
      }
    }

    // Strategy 2: Tag-based similarity (fallback or debug)
    if (forceMethod === 'tags' || (!forceMethod && recommendations.length < 3)) {
      const tagRecs = await getTagRecommendations(db, workId);
      if (tagRecs.length > 0) {
        recommendations = tagRecs;
        method = 'tags';
      }
    }

    // Strategy 3: Recent popular (last resort or debug)
    if (forceMethod === 'recent' || (!forceMethod && recommendations.length === 0)) {
      const recentRecs = await getRecentPopularRecommendations(db, workId);
      recommendations = recentRecs;
      method = 'recent';
    }

    return new Response(JSON.stringify({ recommendations, method }), {
      status: 200,
      headers: CACHE_HEADERS,
    });
  } catch (err) {
    console.error('Recommendations error:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate recommendations' }), {
      status: 500,
      headers: CACHE_HEADERS,
    });
  }
};

// ─── Strategy 1: Kudos Collaborative Filtering ──────────────────
// Works that share kudos-givers with the source work.
// Minimum 3 overlap for reliability.

async function getKudosRecommendations(db: ReturnType<typeof getDb>, workId: number): Promise<RecommendedWork[]> {
  const kudosOverlap = await db
    .select({
      id: works.id,
      title: works.title,
      summary: works.summary,
      wordCount: works.wordCount,
      complete: works.complete,
      publishedAt: works.publishedAt,
      overlap: sql<number>`count(${kudos.id})`,
    })
    .from(kudos)
    .innerJoin(
      sql`(SELECT pseud_id FROM kudos WHERE work_id = ${workId}) AS src`,
      sql`src.pseud_id = ${kudos.pseudId}`,
    )
    .innerJoin(works, sql`${kudos.workId} = ${works.id}`)
    .where(
      and(
        ne(works.id, workId),
        eq(works.draft, 0),
        sql`${works.publishedAt} IS NOT NULL`,
      ),
    )
    .groupBy(works.id, works.title, works.summary, works.wordCount, works.complete, works.publishedAt)
    .having(sql`count(${kudos.id}) >= 3`)
    .orderBy(desc(sql`overlap`))
    .limit(8);

  if (kudosOverlap.length === 0) return [];

  const workIds = kudosOverlap.map(r => r.id);
  const [authors, fandoms] = await Promise.all([
    fetchAuthors(db, workIds),
    fetchFandoms(db, workIds),
  ]);

  return kudosOverlap.map(r => ({
    id: r.id,
    title: r.title,
    summary: truncate(r.summary, 200),
    wordCount: r.wordCount,
    complete: r.complete,
    publishedAt: r.publishedAt,
    authors: authors.get(r.id) ?? [],
    overlap: r.overlap,
    matchMethod: 'kudos' as const,
    fandoms: fandoms.get(r.id) ?? [],
  }));
}

// ─── Strategy 2: Tag-Based Similarity ──────────────────────────
// Works sharing tags with the source work, weighted by tag type.
// fandom=3, relationship=2, character=2, freeform=1, others=1.
// Minimum overlap score of 2.

async function getTagRecommendations(db: ReturnType<typeof getDb>, workId: number): Promise<RecommendedWork[]> {
  // Get the source work's tags with types
  const sourceTagRows = await db
    .select({ tagId: taggings.tagId, tagType: tags.type })
    .from(taggings)
    .innerJoin(tags, eq(taggings.tagId, tags.id))
    .where(eq(taggings.workId, workId));

  if (sourceTagRows.length === 0) return [];

  const sourceTagIds = sourceTagRows.map(t => t.tagId);

  // Build a weight map for source tags
  const sourceWeightMap = new Map<number, number>();
  for (const t of sourceTagRows) {
    sourceWeightMap.set(t.tagId, TAG_WEIGHTS[t.tagType] ?? 1);
  }

  // Find all works that share at least one tag with the source
  const sharedTagRows = await db
    .select({
      workId: taggings.workId,
      tagId: taggings.tagId,
    })
    .from(taggings)
    .innerJoin(works, eq(taggings.workId, works.id))
    .where(
      and(
        ne(works.id, workId),
        eq(works.draft, 0),
        sql`${works.publishedAt} IS NOT NULL`,
        sql`${taggings.tagId} IN (${sql.join(sourceTagIds.map(id => sql`${id}`), sql`, `)})`,
      ),
    );

  // Compute weighted overlap score per candidate work
  const scoreMap = new Map<number, number>();
  for (const row of sharedTagRows) {
    const weight = sourceWeightMap.get(row.tagId) ?? 1;
    scoreMap.set(row.workId, (scoreMap.get(row.workId) ?? 0) + weight);
  }

  // Filter: minimum overlap score of 2, sort by score desc, take top 8
  const candidateIds = [...scoreMap.entries()]
    .filter(([, score]) => score >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id);

  if (candidateIds.length === 0) return [];

  // Fetch full work details for candidates
  const candidateWorks = await db
    .select({
      id: works.id,
      title: works.title,
      summary: works.summary,
      wordCount: works.wordCount,
      complete: works.complete,
      publishedAt: works.publishedAt,
    })
    .from(works)
    .where(sql`${works.id} IN (${sql.join(candidateIds.map(id => sql`${id}`), sql`, `)})`);

  const [authors, fandoms] = await Promise.all([
    fetchAuthors(db, candidateIds),
    fetchFandoms(db, candidateIds),
  ]);

  // Return in score order
  return candidateIds.map(id => {
    const work = candidateWorks.find(w => w.id === id)!;
    return {
      id: work.id,
      title: work.title,
      summary: truncate(work.summary, 200),
      wordCount: work.wordCount,
      complete: work.complete,
      publishedAt: work.publishedAt,
      authors: authors.get(work.id) ?? [],
      overlap: scoreMap.get(work.id) ?? 0,
      matchMethod: 'tags' as const,
      fandoms: fandoms.get(work.id) ?? [],
    };
  });
}

// ─── Strategy 3: Recent Popular Works (Fallback) ────────────────
// Same fandom tags → highest kudos → most recent.

async function getRecentPopularRecommendations(db: ReturnType<typeof getDb>, workId: number): Promise<RecommendedWork[]> {
  // Get source work's fandom tag IDs
  const fandomTagIds = await db
    .select({ tagId: taggings.tagId })
    .from(taggings)
    .innerJoin(tags, eq(taggings.tagId, tags.id))
    .where(and(eq(taggings.workId, workId), eq(tags.type, 'fandom')));

  const fandomIds = fandomTagIds.map(t => t.tagId);

  let recentWorks: { id: number; title: string; summary: string | null; wordCount: number; complete: number; publishedAt: string | null; kudosCount: number }[];

  if (fandomIds.length > 0) {
    // Works in same fandom, ordered by kudos count then recent
    recentWorks = await db
      .select({
        id: works.id,
        title: works.title,
        summary: works.summary,
        wordCount: works.wordCount,
        complete: works.complete,
        publishedAt: works.publishedAt,
        kudosCount: sql<number>`(SELECT COUNT(*) FROM kudos WHERE kudos.work_id = ${works.id})`,
      })
      .from(works)
      .where(
        and(
          ne(works.id, workId),
          eq(works.draft, 0),
          sql`${works.publishedAt} IS NOT NULL`,
          sql`${works.id} IN (SELECT work_id FROM taggings WHERE tag_id IN (${sql.join(fandomIds.map(id => sql`${id}`), sql`, `)}))`,
        ),
      )
      .orderBy(desc(sql`kudosCount`), desc(works.publishedAt))
      .limit(8);
  } else {
    // No fandom — just popular recent works
    recentWorks = await db
      .select({
        id: works.id,
        title: works.title,
        summary: works.summary,
        wordCount: works.wordCount,
        complete: works.complete,
        publishedAt: works.publishedAt,
        kudosCount: sql<number>`(SELECT COUNT(*) FROM kudos WHERE kudos.work_id = ${works.id})`,
      })
      .from(works)
      .where(
        and(
          ne(works.id, workId),
          eq(works.draft, 0),
          sql`${works.publishedAt} IS NOT NULL`,
        ),
      )
      .orderBy(desc(sql`kudosCount`), desc(works.publishedAt))
      .limit(8);
  }

  if (recentWorks.length === 0) return [];

  const workIds = recentWorks.map(r => r.id);
  const [authors, fandoms] = await Promise.all([
    fetchAuthors(db, workIds),
    fetchFandoms(db, workIds),
  ]);

  return recentWorks.map(r => ({
    id: r.id,
    title: r.title,
    summary: truncate(r.summary, 200),
    wordCount: r.wordCount,
    complete: r.complete,
    publishedAt: r.publishedAt,
    authors: authors.get(r.id) ?? [],
    overlap: r.kudosCount,
    matchMethod: 'recent' as const,
    fandoms: fandoms.get(r.id) ?? [],
  }));
}

// ─── Shared Helpers ──────────────────────────────────────────────

async function fetchAuthors(db: ReturnType<typeof getDb>, workIds: number[]): Promise<Map<number, { pseudId: number; pseudName: string }[]>> {
  if (workIds.length === 0) return new Map();

  const authorRows = await db
    .select({
      workId: creatorships.workId,
      pseudId: pseuds.id,
      pseudName: pseuds.name,
    })
    .from(creatorships)
    .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
    .where(sql`${creatorships.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`);

  const authorMap = new Map<number, { pseudId: number; pseudName: string }[]>();
  for (const row of authorRows) {
    if (!authorMap.has(row.workId)) authorMap.set(row.workId, []);
    authorMap.get(row.workId)!.push({ pseudId: row.pseudId, pseudName: row.pseudName });
  }
  return authorMap;
}

async function fetchFandoms(db: ReturnType<typeof getDb>, workIds: number[]): Promise<Map<number, { id: number; name: string }[]>> {
  if (workIds.length === 0) return new Map();

  const fandomRows = await db
    .select({
      workId: taggings.workId,
      tagId: tags.id,
      tagName: tags.name,
    })
    .from(taggings)
    .innerJoin(tags, eq(taggings.tagId, tags.id))
    .where(
      and(
        sql`${taggings.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`,
        eq(tags.type, 'fandom'),
      ),
    );

  const fandomMap = new Map<number, { id: number; name: string }[]>();
  for (const row of fandomRows) {
    if (!fandomMap.has(row.workId)) fandomMap.set(row.workId, []);
    fandomMap.get(row.workId)!.push({ id: row.tagId, name: row.tagName });
  }
  return fandomMap;
}

function truncate(str: string | null, maxLen: number): string | null {
  if (!str) return null;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}