import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../lib/db';
import { getAuth, requireAuth, checkApproved } from '../../../lib/auth';
import { validateBody, validateQuery, createWorkSchema, paginationSchema } from '../../../lib/validation';
import { works, chapters, tags, taggings, creatorships, pseuds, kudos } from '../../../lib/schema/index';
import { eq, and, or, like, desc, asc, count, sql } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/works — List published works ─────────────────────────

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Parse query params
  const sortParam = url.searchParams.get('sort') || 'updated';
  const validSorts = ['updated', 'published', 'words'] as const;
  const sort = validSorts.includes(sortParam as any) ? (sortParam as typeof validSorts[number]) : 'updated';

  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const offset = (page - 1) * limit;

  // Optional tag type filters (fandom=...&rating=... etc)
  const tagFilters: Record<string, string> = {};
  for (const [key, val] of url.searchParams.entries()) {
    if (['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'].includes(key) && val) {
      tagFilters[key] = val;
    }
  }

  // Base condition: only published (draft=0) works
  const conditions = [eq(works.draft, 0)];

  // If tag filters are present, find matching work IDs first
  let filteredWorkIds: number[] | null = null;
  if (Object.keys(tagFilters).length > 0) {
    for (const [tagType, tagName] of Object.entries(tagFilters)) {
      const matching = await db
        .select({ workId: taggings.workId })
        .from(taggings)
        .innerJoin(tags, eq(taggings.tagId, tags.id))
        .where(and(eq(tags.type, tagType), eq(tags.name, tagName)));
      const ids = matching.map(m => m.workId);
      if (filteredWorkIds === null) {
        filteredWorkIds = ids;
      } else {
        filteredWorkIds = filteredWorkIds.filter(id => ids.includes(id));
      }
    }
    if (filteredWorkIds !== null && filteredWorkIds.length === 0) {
      // No works match all tag filters
      return new Response(JSON.stringify({ data: [], total: 0, page, limit }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (filteredWorkIds !== null) {
      conditions.push(sql`${works.id} IN (${sql.join(filteredWorkIds.map(id => sql`${id}`), sql`, `)})`);
    }
  }

  const whereClause = and(...conditions);

  // Count total for pagination
  const [{ total }] = await db
    .select({ total: count() })
    .from(works)
    .where(whereClause);

  // Determine sort order
  let orderBy;
  switch (sort) {
    case 'published':
      orderBy = desc(works.publishedAt);
      break;
    case 'words':
      orderBy = desc(works.wordCount);
      break;
    case 'updated':
    default:
      orderBy = desc(works.updatedAt);
      break;
  }

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

  const workIds = workRows.map(w => w.id);

  // Fetch author pseuds for all works in one query
  const authorRows = await db
    .select({
      workId: creatorships.workId,
      pseudId: pseuds.id,
      name: pseuds.name,
      role: creatorships.role,
    })
    .from(creatorships)
    .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
    .where(sql`${creatorships.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`);

  // Fetch tags for all works in one query
  const taggingRows = await db
    .select({
      workId: taggings.workId,
      tagId: tags.id,
      tagName: tags.name,
      tagType: tags.type,
    })
    .from(taggings)
    .innerJoin(tags, eq(taggings.tagId, tags.id))
    .where(sql`${taggings.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`);

  // Fetch kudos count per work
  const kudosRows = await db
    .select({
      workId: kudos.workId,
      count: count(),
    })
    .from(kudos)
    .where(sql`${kudos.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`)
    .groupBy(kudos.workId);

  // Fetch chapter count per work
  const chapterRows = await db
    .select({
      workId: chapters.workId,
      count: count(),
    })
    .from(chapters)
    .where(sql`${chapters.workId} IN (${sql.join(workIds.map(id => sql`${id}`), sql`, `)})`)
    .groupBy(chapters.workId);

  // Build maps
  const authorsByWork = new Map<number, { pseudId: number; name: string; role: string }[]>();
  for (const row of authorRows) {
    if (!authorsByWork.has(row.workId)) authorsByWork.set(row.workId, []);
    authorsByWork.get(row.workId)!.push({ pseudId: row.pseudId, name: row.name, role: row.role });
  }

  const tagsByWork = new Map<number, { id: number; name: string; type: string }[]>();
  for (const row of taggingRows) {
    if (!tagsByWork.has(row.workId)) tagsByWork.set(row.workId, []);
    tagsByWork.get(row.workId)!.push({ id: row.tagId, name: row.tagName, type: row.tagType });
  }

  const kudosByWork = new Map<number, number>();
  for (const row of kudosRows) {
    kudosByWork.set(row.workId, row.count);
  }

  const chaptersByWork = new Map<number, number>();
  for (const row of chapterRows) {
    chaptersByWork.set(row.workId, row.count);
  }

  // Assemble response
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
    kudosCount: kudosByWork.get(w.id) || 0,
    chapterCount: chaptersByWork.get(w.id) || 0,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/works — Create new work ─────────────────────────────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, createWorkSchema);
  if (error) return error;

  // Verify the pseud belongs to this user
  const pseud = await db
    .select()
    .from(pseuds)
    .where(and(eq(pseuds.id, data.pseudId), eq(pseuds.userId, auth.user.id)))
    .get();

  if (!pseud) {
    return new Response(JSON.stringify({ error: 'Pseud not found or does not belong to you' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Resolve tags: find existing or create new ones
  const resolvedTags: { id: number; type: string; name: string }[] = [];
  for (const tagInput of data.tags) {
    if (tagInput.id) {
      // Look up by ID
      const existing = await db.select().from(tags).where(eq(tags.id, tagInput.id)).get();
      if (existing) {
        resolvedTags.push({ id: existing.id, type: existing.type, name: existing.name });
      }
    } else {
      // Look up by name + type, or create
      const existing = await db
        .select()
        .from(tags)
        .where(and(eq(tags.name, tagInput.name), eq(tags.type, tagInput.type)))
        .get();

      if (existing) {
        resolvedTags.push({ id: existing.id, type: existing.type, name: existing.name });
      } else {
        const [created] = await db
          .insert(tags)
          .values({ name: tagInput.name, type: tagInput.type })
          .returning({ id: tags.id, type: tags.type, name: tags.name });
        resolvedTags.push(created);
      }
    }
  }

  // New works are drafts by default (draft=1)
  const now = new Date().toISOString();
  const [newWork] = await db
    .insert(works)
    .values({
      title: data.title,
      summary: data.summary ?? null,
      notes: data.notes ?? null,
      endNotes: data.endNotes ?? null,
      language: data.language,
      workSkin: data.workSkin,
      draft: 1,
      wordCount: 0,
      complete: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Create creatorship linking pseud to work
  await db.insert(creatorships).values({
    pseudId: data.pseudId,
    workId: newWork.id,
    role: 'author',
  });

  // Create taggings
  if (resolvedTags.length > 0) {
    await db.insert(taggings).values(
      resolvedTags.map(tag => ({
        tagId: tag.id,
        workId: newWork.id,
      }))
    );
  }

  return new Response(JSON.stringify({
    data: {
      ...newWork,
      authors: [{ pseudId: pseud.id, name: pseud.name, role: 'author' }],
      tags: resolvedTags,
    },
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};