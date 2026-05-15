import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { validateQuery, searchSchema } from '@/v2/lib/validation';
import { works, chapters, tags, taggings, creatorships, pseuds, kudos } from '@/v2/lib/schema/index';
import { eq, and, desc, asc, count, sql } from 'drizzle-orm';

export const config = { auth: 'public' as const };

// ─── GET /api/search — FTS5 + faceted tag filters ──────────────────

export const GET: APIRoute = async ({ url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Validate query params
  let query;
  try {
    query = validateQuery(url, searchSchema);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Invalid search parameters', details: err.errors || err.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { q, fandom, character, relationship, rating, warning, category, complete, sort, page, limit } = query;
  const offset = (page - 1) * limit;

  // ─── Step 1: FTS5 search to get matching work IDs ──────────────────
  // Use parameterized query via D1's bind mechanism through raw SQL
  const ftsQuery = q
    .split(/\s+/)
    .filter(term => term.length > 0)
    .map(term => `"${term.replace(/"/g, '""')}"*`)
    .join(' ');

  const ftsResults = await d1.prepare(
    'SELECT rowid as id FROM works_fts WHERE works_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?'
  )
    .bind(ftsQuery, limit * 5, offset)  // Get more results than needed, we'll filter down
    .all();

  const ftsWorkIds: number[] = (ftsResults.results || []).map((row: any) => row.id);

  if (ftsWorkIds.length === 0) {
    return new Response(JSON.stringify({ data: [], total: 0, page, limit }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Step 2: Apply faceted tag filters ────────────────────────────
  // Each tag filter narrows the set of matching work IDs
  const tagFilters: { type: string; name: string }[] = [];
  if (fandom) tagFilters.push({ type: 'fandom', name: fandom });
  if (character) tagFilters.push({ type: 'character', name: character });
  if (relationship) tagFilters.push({ type: 'relationship', name: relationship });
  if (rating) tagFilters.push({ type: 'rating', name: rating });
  if (warning) tagFilters.push({ type: 'warning', name: warning });
  if (category) tagFilters.push({ type: 'category', name: category });

  let candidateWorkIds = ftsWorkIds;

  for (const filter of tagFilters) {
    // Find work IDs that have this tag
    const matching = await db
      .select({ workId: taggings.workId })
      .from(taggings)
      .innerJoin(tags, eq(taggings.tagId, tags.id))
      .where(and(
        eq(tags.type, filter.type),
        eq(tags.name, filter.name),
        sql`${taggings.workId} IN (${sql.join(candidateWorkIds.map(id => sql`${id}`), sql`, `)})`
      ));

    const matchingIds = new Set(matching.map(m => m.workId));
    candidateWorkIds = candidateWorkIds.filter(id => matchingIds.has(id));
  }

  if (candidateWorkIds.length === 0) {
    return new Response(JSON.stringify({ data: [], total: 0, page, limit }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Step 3: Build main query ──────────────────────────────────────
  // Base conditions: work must be published and in our candidate set
  const conditions = [
    eq(works.draft, 0),
    sql`${works.id} IN (${sql.join(candidateWorkIds.map(id => sql`${id}`), sql`, `)})`
  ];

  if (complete !== undefined) {
    conditions.push(eq(works.complete, complete ? 1 : 0));
  }

  const whereClause = and(...conditions);

  // Determine sort order
  let orderBy;
  switch (sort) {
    case 'published':
      orderBy = desc(works.publishedAt);
      break;
    case 'words':
      orderBy = desc(works.wordCount);
      break;
    case 'kudos':
      // Will handle below with a subquery/join
      orderBy = desc(works.updatedAt); // fallback, kudos sort done separately
      break;
    case 'comments':
      orderBy = desc(works.updatedAt); // fallback, would need comment count join
      break;
    case 'updated':
    default:
      orderBy = desc(works.updatedAt);
      break;
  }

  // Count total matching works
  const [{ total }] = await db
    .select({ total: count() })
    .from(works)
    .where(whereClause);

  // Fetch works
  const workRows = await db
    .select()
    .from(works)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  if (workRows.length === 0) {
    return new Response(JSON.stringify({ data: [], total: 0, page, limit }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resultWorkIds = workRows.map(w => w.id);
  const idList = sql.join(resultWorkIds.map(id => sql`${id}`), sql`, `);

  // Fetch authors for all result works
  const authorRows = await db
    .select({
      workId: creatorships.workId,
      pseudId: pseuds.id,
      name: pseuds.name,
      role: creatorships.role,
    })
    .from(creatorships)
    .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
    .where(sql`${creatorships.workId} IN (${idList})`);

  // Fetch tags for all result works
  const tagRows = await db
    .select({
      workId: taggings.workId,
      id: tags.id,
      name: tags.name,
      type: tags.type,
    })
    .from(taggings)
    .innerJoin(tags, eq(taggings.tagId, tags.id))
    .where(sql`${taggings.workId} IN (${idList})`);

  // Fetch chapter count per work
  const chapterRows = await db
    .select({
      workId: chapters.workId,
      count: count(),
    })
    .from(chapters)
    .where(sql`${chapters.workId} IN (${idList})`)
    .groupBy(chapters.workId);

  // Fetch kudos count per work
  const kudosRows = await db
    .select({
      workId: kudos.workId,
      count: count(),
    })
    .from(kudos)
    .where(sql`${kudos.workId} IN (${idList})`)
    .groupBy(kudos.workId);

  // ─── Step 4: Build lookup maps ─────────────────────────────────────
  const authorsByWork = new Map<number, { pseudId: number; name: string; role: string }[]>();
  for (const row of authorRows) {
    if (!authorsByWork.has(row.workId)) authorsByWork.set(row.workId, []);
    authorsByWork.get(row.workId)!.push({ pseudId: row.pseudId, name: row.name, role: row.role });
  }

  const tagsByWork = new Map<number, { id: number; name: string; type: string }[]>();
  for (const row of tagRows) {
    if (!tagsByWork.has(row.workId)) tagsByWork.set(row.workId, []);
    tagsByWork.get(row.workId)!.push({ id: row.id, name: row.name, type: row.type });
  }

  const chaptersByWork = new Map<number, number>();
  for (const row of chapterRows) {
    chaptersByWork.set(row.workId, row.count);
  }

  const kudosByWork = new Map<number, number>();
  for (const row of kudosRows) {
    kudosByWork.set(row.workId, row.count);
  }

  // ─── Step 5: Assemble response ─────────────────────────────────────
  const data = workRows.map(w => ({
    id: w.id,
    title: w.title,
    summary: w.summary,
    language: w.language,
    wordCount: w.wordCount,
    complete: w.complete,
    workSkin: w.workSkin,
    publishedAt: w.publishedAt,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    authors: authorsByWork.get(w.id) || [],
    tags: tagsByWork.get(w.id) || [],
    chapterCount: chaptersByWork.get(w.id) || 0,
    kudosCount: kudosByWork.get(w.id) || 0,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};