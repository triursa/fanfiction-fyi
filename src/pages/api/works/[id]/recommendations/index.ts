export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { works, kudos, taggings, tags, creatorships, pseuds } from '@/lib/schema';
import { eq, and, ne, sql, desc } from 'drizzle-orm';
import type { APIRoute } from 'astro';

// GET /api/works/[id]/recommendations
// Returns 3-5 recommended works based on kudos overlap (collaborative filtering)
// Falls back to tag-based similarity for works with few kudos
export const GET: APIRoute = async ({ params, locals }) => {
  const workId = Number(params.id);
  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  try {
    // Strategy 1: Kudos-based collaborative filtering
    // "Readers who enjoyed this also enjoyed..."
    const kudosOverlap = await db
      .select({
        id: works.id,
        title: works.title,
        slug: works.slug,
        summary: works.summary,
        wordCount: works.wordCount,
        complete: works.complete,
        publishedAt: works.publishedAt,
        coverArt: works.coverArt,
        overlap: sql<number>`count(${kudos.id})`,
      })
      .from(kudos)
      .innerJoin(
        sql`(SELECT pseud_id FROM kudos WHERE work_id = ${workId}) AS src`,
        sql`src.pseud_id = ${kudos.pseudId}`
      )
      .innerJoin(works, sql`${kudos.workId} = ${works.id}`)
      .where(
        and(
          ne(works.id, workId),
          eq(works.draft, 0),
          sql`${works.publishedAt} IS NOT NULL`,
        )
      )
      .groupBy(works.id, works.title, works.slug, works.summary, works.wordCount, works.complete, works.publishedAt, works.coverArt)
      .orderBy(desc(sql`overlap`))
      .limit(5);

    // If we got ≥3 kudos-based recs, use them
    if (kudosOverlap.length >= 3) {
      const recsWithAuthors = await enrichWithAuthors(d1, kudosOverlap);
      return new Response(JSON.stringify({ recommendations: recsWithAuthors, method: 'kudos' }), {
        headers: { 'Content-Type': 'application/json', ...cacheHeaders() },
      });
    }

    // Strategy 2: Tag-based similarity
    // Find works sharing the most tags with this work
    const tagOverlap = await db
      .select({
        id: works.id,
        title: works.title,
        slug: works.slug,
        summary: works.summary,
        wordCount: works.wordCount,
        complete: works.complete,
        publishedAt: works.publishedAt,
        coverArt: works.coverArt,
        overlap: sql<number>`count(${taggings.id})`,
      })
      .from(taggings)
      .innerJoin(works, eq(taggings.workId, works.id))
      .where(
        and(
          ne(works.id, workId),
          eq(works.draft, 0),
          sql`${works.publishedAt} IS NOT NULL`,
          sql`${taggings.tagId} IN (SELECT tag_id FROM taggings WHERE work_id = ${workId})`,
        )
      )
      .groupBy(works.id, works.title, works.slug, works.summary, works.wordCount, works.complete, works.publishedAt, works.coverArt)
      .orderBy(desc(sql`overlap`))
      .limit(5);

    if (tagOverlap.length > 0) {
      const recsWithAuthors = await enrichWithAuthors(d1, tagOverlap);
      return new Response(JSON.stringify({ recommendations: recsWithAuthors, method: 'tags' }), {
        headers: { 'Content-Type': 'application/json', ...cacheHeaders() },
      });
    }

    // Strategy 3: Last resort — random recent published works
    const recent = await db
      .select({
        id: works.id,
        title: works.title,
        slug: works.slug,
        summary: works.summary,
        wordCount: works.wordCount,
        complete: works.complete,
        publishedAt: works.publishedAt,
        coverArt: works.coverArt,
      })
      .from(works)
      .where(
        and(
          ne(works.id, workId),
          eq(works.draft, 0),
          sql`${works.publishedAt} IS NOT NULL`,
        )
      )
      .orderBy(desc(works.publishedAt))
      .limit(5);

    const recsWithAuthors = await enrichWithAuthors(d1, recent);
    return new Response(JSON.stringify({ recommendations: recsWithAuthors, method: 'recent' }), {
      headers: { 'Content-Type': 'application/json', ...cacheHeaders() },
    });

  } catch (err) {
    console.error('Recommendations error:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate recommendations' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// Enrich recommendations with author pseuds
async function enrichWithAuthors(d1: D1Database, recs: any[]): Promise<any[]> {
  if (recs.length === 0) return [];

  const workIds = recs.map(r => r.id);
  const db = getDrizzle(d1);

  const authorRows = await db
    .select({
      workId: creatorships.workId,
      pseudName: pseuds.name,
      pseudId: pseuds.id,
    })
    .from(creatorships)
    .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
    .where(sql`${creatorships.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`);

  const authorMap = new Map<number, { pseudName: string; pseudId: number }[]>();
  for (const row of authorRows) {
    if (!authorMap.has(row.workId)) authorMap.set(row.workId, []);
    authorMap.get(row.workId)!.push({ pseudName: row.pseudName, pseudId: row.pseudId });
  }

  return recs.map(r => ({
    ...r,
    authors: authorMap.get(r.id) || [],
    overlap: r.overlap ?? 0,
  }));
}

function cacheHeaders() {
  return {
    'Cache-Control': 'public, max-age=300, s-maxage=600',
  };
}