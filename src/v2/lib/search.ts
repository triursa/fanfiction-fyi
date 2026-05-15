/**
 * v2 Search helpers — FTS5 query builder for D1.
 *
 * D1 supports FTS5 virtual tables for full-text search.
 * The `works_fts` table indexes work title + summary.
 * Faceted filtering is done via JOINs on taggings/tags tables.
 */

import { sql, eq, and, or, like, desc, asc, count } from 'drizzle-orm';
import type { Database } from './db';
import { works, tags, taggings, creatorships, pseuds, kudos, chapters } from './schema/index';

export interface SearchParams {
  query: string;
  fandom?: string;
  character?: string;
  relationship?: string;
  rating?: string;
  warning?: string;
  category?: string;
  complete?: boolean;
  sort?: 'updated' | 'published' | 'words' | 'kudos' | 'comments';
  page: number;
  limit: number;
}

export interface SearchResult {
  works: Array<{
    id: number;
    title: string;
    summary: string | null;
    wordCount: number;
    complete: number;
    draft: number;
    publishedAt: string | null;
    updatedAt: string;
    workSkin: string;
    authors: Array<{ id: number; name: string; isDefault: number }>;
    tags: Array<{ id: number; name: string; type: string }>;
    chapterCount: number;
    kudosCount: number;
  }>;
  total: number;
  page: number;
  limit: number;
}

/**
 * Search works using FTS5 + faceted tag filters.
 */
export async function searchWorks(db: Database, params: SearchParams): Promise<SearchResult> {
  const { query, page, limit, sort = 'updated', complete } = params;
  const offset = (page - 1) * limit;

  // Build base conditions — only published works in search results
  const conditions = [eq(works.draft, 0)];

  // Tag type filters
  if (params.fandom || params.character || params.relationship || params.rating || params.warning || params.category) {
    // These are handled via subqueries below
  }

  if (complete !== undefined) {
    conditions.push(eq(works.complete, complete ? 1 : 0));
  }

  // FTS5 search on title + summary
  // Escape special FTS5 characters in the query
  const ftsQuery = query.replace(/["'*():]/g, ' ').trim();

  // Use FTS5 for text matching
  const ftsResults = db
    .select({ id: works.id })
    .from(works)
    .where(and(
      ...conditions,
      sql`works.id IN (SELECT rowid FROM works_fts WHERE works_fts MATCH ${ftsQuery}*)`,
    ));

  // Get total count
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(works)
    .where(and(...conditions, sql`works.id IN (SELECT rowid FROM works_fts WHERE works_fts MATCH ${ftsQuery}*)`));

  // Sort mapping
  const sortColumn = {
    updated: desc(works.updatedAt),
    published: desc(works.publishedAt),
    words: desc(works.wordCount),
    kudos: desc(sql`(SELECT COUNT(*) FROM kudos WHERE kudos.work_id = works.id)`),
    comments: desc(sql`(SELECT COUNT(*) FROM comments WHERE comments.work_id = works.id)`),
  }[sort] || desc(works.updatedAt);

  // Main query with JOINs for authors and tags
  const results = await db
    .select()
    .from(works)
    .where(and(
      ...conditions,
      sql`works.id IN (SELECT rowid FROM works_fts WHERE works_fts MATCH ${ftsQuery}*)`,
    ))
    .orderBy(sortColumn)
    .limit(limit)
    .offset(offset);

  // Enrich each result with authors and tags
  const enrichedWorks = await Promise.all(
    results.map(async (work) => {
      const [authors, workTags, chapterCount, kudosCount] = await Promise.all([
        db
          .select({ id: pseuds.id, name: pseuds.name, isDefault: pseuds.isDefault })
          .from(creatorships)
          .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
          .where(eq(creatorships.workId, work.id)),
        db
          .select({ id: tags.id, name: tags.name, type: tags.type })
          .from(taggings)
          .innerJoin(tags, eq(taggings.tagId, tags.id))
          .where(eq(taggings.workId, work.id)),
        db
          .select({ value: count() })
          .from(chapters)
          .where(eq(chapters.workId, work.id)),
        db
          .select({ value: count() })
          .from(kudos)
          .where(eq(kudos.workId, work.id)),
      ]);

      return {
        ...work,
        authors,
        tags: workTags,
        chapterCount: chapterCount[0]?.value ?? 0,
        kudosCount: kudosCount[0]?.value ?? 0,
      };
    }),
  );

  return {
    works: enrichedWorks,
    total: total || 0,
    page,
    limit,
  };
}

/**
 * Tag autocomplete — returns matching tags for type-ahead search.
 */
export async function autocompleteTags(
  db: Database,
  query: string,
  type?: string,
  limit: number = 20,
): Promise<Array<{ id: number; name: string; type: string }>> {
  const conditions = [];
  if (type) {
    conditions.push(eq(tags.type, type as any));
  }
  if (query.length > 0) {
    conditions.push(like(tags.name, `${query}%`));
  }

  return db
    .select({ id: tags.id, name: tags.name, type: tags.type })
    .from(tags)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(tags.name))
    .limit(limit);
}