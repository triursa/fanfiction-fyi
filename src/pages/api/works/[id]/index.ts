export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import { logPublishAttempt, logPublishResult } from '@/lib/publish-logger';
import { works, chapters, creatorships, tags, taggings, pseuds } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await db.select().from(works).where(eq(works.id, workId)).get();
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Fetch pseuds first to check ownership
  const pseudRows = await db
    .select({
      id: pseuds.id,
      userId: pseuds.userId,
      name: pseuds.name,
      description: pseuds.description,
      iconKey: pseuds.iconKey,
      createdAt: pseuds.createdAt,
      pinnedWorkIds: pseuds.pinnedWorkIds,
      bannerKey: pseuds.bannerKey,
      themeColor: pseuds.themeColor,
      isDefault: pseuds.isDefault,
      role: creatorships.role,
    })
    .from(pseuds)
    .innerJoin(creatorships, eq(pseuds.id, creatorships.pseudId))
    .where(eq(creatorships.workId, workId));

  // Convert to snake_case for API compatibility
  const pseudsList = pseudRows.map(p => ({
    ...p,
    user_id: p.userId,
    icon_key: p.iconKey,
    pinned_work_ids: p.pinnedWorkIds,
    banner_key: p.bannerKey,
    theme_color: p.themeColor,
    is_default: p.isDefault,
    created_at: p.createdAt,
  }));

  const auth = await getAuth(d1, request);
  const isOwner = auth && pseudsList.some((p: any) => p.user_id === auth.user.id);

  // Unauthenticated/non-owner users can only see published works
  if (!work.publishedAt && !isOwner) {
    return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // For owners: show all chapters including drafts. For others: published only, and omit the draft column.
  const chapterConditions = [eq(chapters.workId, workId)];
  if (!isOwner) {
    chapterConditions.push(eq(chapters.draft, 0));
  }

  const chapterRows = isOwner
    ? await db
        .select({ id: chapters.id, position: chapters.position, title: chapters.title, draft: chapters.draft, wordCount: chapters.wordCount, updatedAt: chapters.updatedAt })
        .from(chapters)
        .where(eq(chapters.workId, workId))
        .orderBy(asc(chapters.position))
    : await db
        .select({ id: chapters.id, position: chapters.position, title: chapters.title, wordCount: chapters.wordCount, updatedAt: chapters.updatedAt })
        .from(chapters)
        .where(and(eq(chapters.workId, workId), eq(chapters.draft, 0)))
        .orderBy(asc(chapters.position));

  // Convert chapters to snake_case
  const chaptersList = chapterRows.map((c: any) => {
    const row: any = {
      id: c.id,
      position: c.position,
      title: c.title,
      word_count: c.wordCount,
      updated_at: c.updatedAt,
    };
    if ('draft' in c) row.draft = c.draft;
    return row;
  });

  const tagRows = await db
    .select()
    .from(tags)
    .innerJoin(taggings, eq(tags.id, taggings.tagId))
    .where(eq(taggings.workId, workId));

  const tagsList = tagRows.map(r => r.tags);

  return new Response(JSON.stringify({ work, chapters: chaptersList, tags: tagsList, pseuds: pseudsList }), { headers: { 'Content-Type': 'application/json' } });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership via subquery: check if user has a pseud with a creatorship on this work
  const userPseudIds = auth.pseuds.map(p => p.id);
  const creatorship = await db
    .select()
    .from(creatorships)
    .where(and(eq(creatorships.workId, workId), inArray(creatorships.pseudId, userPseudIds)))
    .get();
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  let workLogId = 0;
  if (body.publish) {
    workLogId = await logPublishAttempt(d1, { workId, step: 'work_publish', userId: auth.user.id, requestSummary: JSON.stringify({ publish: true }) });
  }

  try {

  // Handle tag updates: resolve tag_names + tag_ids, then clear and re-add
  const resolvedTagIds: number[] = [...(Array.isArray(body.tag_ids) ? body.tag_ids.filter((id: any) => typeof id === 'number' && id > 0) : [])];
  
  if (Array.isArray(body.tag_names)) {
    const validTypes = ['fandom', 'character', 'relationship', 'freeform'];
    for (const tn of body.tag_names) {
      if (!tn.name || !tn.type || !validTypes.includes(tn.type)) continue;
      const existing = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.name, tn.name), eq(tags.type, tn.type))).get();
      if (existing) {
        if (!resolvedTagIds.includes(existing.id)) resolvedTagIds.push(existing.id);
      } else {
        await db.insert(tags).values({ name: tn.name, type: tn.type }).onConflictDoNothing();
        const reFetched = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.name, tn.name), eq(tags.type, tn.type))).get();
        if (reFetched && !resolvedTagIds.includes(reFetched.id)) resolvedTagIds.push(reFetched.id);
      }
    }
  }

  if (resolvedTagIds.length > 0 || Array.isArray(body.tag_ids) || Array.isArray(body.tag_names)) {
    await db.delete(taggings).where(eq(taggings.workId, workId));
    for (const tid of resolvedTagIds) {
      await db.insert(taggings).values({ tagId: tid, workId }).onConflictDoNothing();
    }
  }

  // Handle auto-create rating/category/warning tags
  const autoTags = [
    { type: 'rating', name: body.rating },
    { type: 'category', name: body.category },
    { type: 'warning', name: body.warning },
  ].filter(t => t.name);

  for (const t of autoTags) {
    // Remove existing tags of this type for the work
    const typeTagIds = await db.select({ id: tags.id }).from(tags).where(eq(tags.type, t.type));
    if (typeTagIds.length > 0) {
      await db.delete(taggings).where(and(eq(taggings.workId, workId), inArray(taggings.tagId, typeTagIds.map(r => r.id))));
    }
    const existing = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.name, t.name!), eq(tags.type, t.type))).get();
    if (existing) {
      await db.insert(taggings).values({ tagId: existing.id, workId }).onConflictDoNothing();
    } else {
      const tagResult = await db.insert(tags).values({ name: t.name!, type: t.type }).onConflictDoNothing();
      const lastRowId = Number(tagResult.meta?.last_row_id ?? tagResult[0]?.meta?.last_row_id);
      if (lastRowId) {
        await db.insert(taggings).values({ tagId: lastRowId, workId }).onConflictDoNothing();
      }
    }
  }

  // Build up the SET values dynamically
  const setValues: Record<string, any> = {};
  if (body.title !== undefined) setValues.title = body.title;
  if (body.summary !== undefined) setValues.summary = body.summary;
  if (body.notes !== undefined) setValues.notes = body.notes;
  if (body.end_notes !== undefined) setValues.endNotes = body.end_notes;
  if (body.complete !== undefined) setValues.complete = body.complete ? 1 : 0;
  if (body.language !== undefined) setValues.language = body.language;
  if (body.work_skin !== undefined) {
    const validSkins = ['default', 'typewriter', 'manuscript', 'terminal', 'parchment'];
    if (validSkins.includes(body.work_skin)) {
      setValues.workSkin = body.work_skin;
    }
  }
  if (body.publish) {
    console.log('[WORK_PUT] Publishing work:', workId, 'body keys:', Object.keys(body).join(','));
    // Set published_at only if it's currently null (first publish)
    setValues.publishedAt = sql`COALESCE(${works.publishedAt}, datetime('now'))`;
  }

  if (Object.keys(setValues).length === 0 && !Array.isArray(body.tag_ids) && autoTags.length === 0) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  if (Object.keys(setValues).length > 0) {
    setValues.updatedAt = sql`datetime('now')`;
    await db.update(works).set(setValues).where(eq(works.id, workId));
  }

  // When publishing, also publish all draft chapters
  if (body.publish) {
    await db.update(chapters).set({ draft: 0, updatedAt: sql`datetime('now')` }).where(and(eq(chapters.workId, workId), eq(chapters.draft, 1)));
    await db.update(works).set({
      wordCount: sql`(SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE work_id = ${workId} AND draft = 0)`,
    }).where(eq(works.id, workId));
  }

  const updatedWork = await db.select().from(works).where(eq(works.id, workId)).get();

  // Log publish result after fetching the updated work so we can include published_at
  if (body.publish && workLogId) {
    await logPublishResult(d1, workLogId, { status: 'success', httpStatus: 200, responseSummary: JSON.stringify({ published_at: updatedWork?.publishedAt }).slice(0,200) });
  }

  return new Response(JSON.stringify(updatedWork), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[WORK_PUT] Error updating work:', workId, err);
    if (workLogId) await logPublishResult(d1, workLogId, { status: 'fail', httpStatus: 500, error: String((err as any)?.message || err) });
    return new Response(JSON.stringify({ error: (err as any)?.message || 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const userPseudIds = auth.pseuds.map(p => p.id);
  const creatorship = await db
    .select()
    .from(creatorships)
    .where(and(eq(creatorships.workId, workId), inArray(creatorships.pseudId, userPseudIds)))
    .get();
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  try {
    await db.delete(works).where(eq(works.id, workId));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[WORK_DELETE] Error deleting work:', workId, err);
    return new Response(JSON.stringify({ error: (err as any)?.message || 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};