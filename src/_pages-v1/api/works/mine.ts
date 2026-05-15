export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { works, chapters, creatorships, tags, taggings, pseuds, collectionItems } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray, isNotNull, isNull, exists } from 'drizzle-orm';
import type { APIRoute } from 'astro';

const VALID_STATUSES = ['draft', 'published', 'collection'] as const;
type WorkStatus = typeof VALID_STATUSES[number];

export const GET: APIRoute = async ({ url, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  // Auth required — no CORS headers; this endpoint is same-origin only
  const auth = await getAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const statusParam = url.searchParams.get('status') || 'draft';
  if (!(VALID_STATUSES as readonly string[]).includes(statusParam)) {
    return new Response(
      JSON.stringify({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const status = statusParam as WorkStatus;

  const pseudId = Number(url.searchParams.get('pseud_id')) || 0;
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const offset = (page - 1) * limit;

  // Build the user's pseud list for filtering
  const pseudIds = auth.pseuds.map(p => p.id);
  if (pseudIds.length === 0) {
    return new Response(JSON.stringify({ works: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build conditions
  const conditions = [inArray(creatorships.pseudId, pseudIds)];

  if (status === 'draft') {
    conditions.push(isNull(works.publishedAt));
  } else if (status === 'published') {
    conditions.push(isNotNull(works.publishedAt));
  } else if (status === 'collection') {
    // Works that belong to a collection
    conditions.push(exists(
      db.select({ id: sql`1` }).from(collectionItems).where(eq(collectionItems.workId, works.id))
    ));
  }

  // Filter by specific pseud if requested
  if (pseudId > 0) {
    conditions.push(eq(creatorships.pseudId, pseudId));
  }

  const workRows = await db
    .select({
      id: works.id,
      title: works.title,
      summary: works.summary,
      wordCount: works.wordCount,
      complete: works.complete,
      publishedAt: works.publishedAt,
      updatedAt: works.updatedAt,
      chapterCount: sql<number>`COUNT(DISTINCT ${chapters.id})`.as('chapter_count'),
    })
    .from(works)
    .innerJoin(creatorships, and(eq(creatorships.workId, works.id), ...conditions))
    .leftJoin(chapters, eq(chapters.workId, works.id))
    .groupBy(works.id)
    .orderBy(desc(works.updatedAt))
    .limit(limit)
    .offset(offset);

  // Enrich with tags and pseuds using batched queries
  const workList = workRows.map(w => ({
    ...w,
    chapter_count: w.chapterCount,
    tags: [] as { name: string; type: string }[],
    pseuds: [] as { name: string; icon_key: string | null }[],
  }));

  if (workList.length > 0) {
    const wIds = workList.map(w => w.id);

    const tagRows = await db
      .select({ workId: taggings.workId, name: tags.name, type: tags.type })
      .from(taggings)
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(inArray(taggings.workId, wIds));

    const pseudRows = await db
      .select({ workId: creatorships.workId, name: pseuds.name, iconKey: pseuds.iconKey })
      .from(creatorships)
      .innerJoin(pseuds, eq(pseuds.id, creatorships.pseudId))
      .where(inArray(creatorships.workId, wIds));

    const tagsByWorkId = new Map<number, { name: string; type: string }[]>();
    for (const row of tagRows) {
      const existing = tagsByWorkId.get(row.workId) ?? [];
      existing.push({ name: row.name, type: row.type });
      tagsByWorkId.set(row.workId, existing);
    }

    const pseudsByWorkId = new Map<number, { name: string; icon_key: string | null }[]>();
    for (const row of pseudRows) {
      const existing = pseudsByWorkId.get(row.workId) ?? [];
      existing.push({ name: row.name, icon_key: row.iconKey });
      pseudsByWorkId.set(row.workId, existing);
    }

    for (const w of workList) {
      w.tags = tagsByWorkId.get(w.id) ?? [];
      w.pseuds = pseudsByWorkId.get(w.id) ?? [];
    }
  }

  return new Response(JSON.stringify({ works: workList }), {
    headers: { 'Content-Type': 'application/json' },
  });
};