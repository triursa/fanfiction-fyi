export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';
import { works, chapters, creatorships, tags, taggings, pseuds } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const page = Number(url.searchParams.get('page')) || 1;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const offset = (page - 1) * limit;
  const tagType = url.searchParams.get('tag_type');
  const tagName = url.searchParams.get('tag_name');

  // Build query with conditions
  const conditions = [isNotNull(works.publishedAt)];

  if (tagType || tagName) {
    // When filtering by tag, join through taggings/tags
    const tagConditions = [isNotNull(works.publishedAt)];
    if (tagType) tagConditions.push(eq(tags.type, tagType));
    if (tagName) tagConditions.push(like(tags.name, `%${tagName}%`));

    const workRows = await db
      .select()
      .from(works)
      .innerJoin(taggings, eq(taggings.workId, works.id))
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(and(...tagConditions))
      .orderBy(desc(works.updatedAt))
      .limit(limit)
      .offset(offset);

    const workList = workRows.map(r => r.works);

    // Enrich with tags and pseuds
    for (const w of workList) {
      const wTags = await db
        .select({ name: tags.name, type: tags.type })
        .from(tags)
        .innerJoin(taggings, eq(tags.id, taggings.tagId))
        .where(eq(taggings.workId, w.id));
      (w as any).tags = wTags;

      const wPseuds = await db
        .select({ name: pseuds.name, role: creatorships.role })
        .from(pseuds)
        .innerJoin(creatorships, eq(pseuds.id, creatorships.pseudId))
        .where(eq(creatorships.workId, w.id));
      (w as any).pseuds = wPseuds;
    }

    return new Response(JSON.stringify(workList), { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } });
  }

  // No tag filter — simple query
  const workList = await db
    .select()
    .from(works)
    .where(isNotNull(works.publishedAt))
    .orderBy(desc(works.updatedAt))
    .limit(limit)
    .offset(offset);

  for (const w of workList) {
    const wTags = await db
      .select({ name: tags.name, type: tags.type })
      .from(tags)
      .innerJoin(taggings, eq(tags.id, taggings.tagId))
      .where(eq(taggings.workId, w.id));
    (w as any).tags = wTags;

    const wPseuds = await db
      .select({ name: pseuds.name, role: creatorships.role })
      .from(pseuds)
      .innerJoin(creatorships, eq(pseuds.id, creatorships.pseudId))
      .where(eq(creatorships.workId, w.id));
    (w as any).pseuds = wPseuds;
  }

  return new Response(JSON.stringify(workList), { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  // Rate limit: 5 per 5min per user IP
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(d1, clientIp, 'create-work');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }
  await recordFailedAttempt(d1, clientIp, 'create-work');

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { title, summary, notes, pseud_id, chapter_title, chapter_content, chapter_images, draft, tag_ids, tag_names, rating, category, warning, skip_chapter } = body || {};
  if (!title) return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseudId = pseud_id || auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud available' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const isDraft = draft !== undefined ? (draft ? 1 : 0) : 1;
  const skipChapter = skip_chapter === true;

  // Resolve tag_names (new/freeform tags with name+type) to tag_ids
  const resolvedTagIds: number[] = [...(Array.isArray(tag_ids) ? tag_ids.filter((id: any) => typeof id === 'number' && id > 0) : [])];
  
  if (Array.isArray(tag_names)) {
    const validTypes = ['fandom', 'character', 'relationship', 'freeform'];
    for (const tn of tag_names) {
      if (!tn.name || !tn.type || !validTypes.includes(tn.type)) continue;
      // Look up existing tag
      const existing = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.name, tn.name), eq(tags.type, tn.type))).get();
      if (existing) {
        if (!resolvedTagIds.includes(existing.id)) resolvedTagIds.push(existing.id);
      } else {
        // Auto-create the tag
        await db.insert(tags).values({ name: tn.name, type: tn.type }).onConflictDoNothing();
        const reFetched = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.name, tn.name), eq(tags.type, tn.type))).get();
        if (reFetched && !resolvedTagIds.includes(reFetched.id)) resolvedTagIds.push(reFetched.id);
      }
    }
  }

  // Work-level insert (word_count will be 0 if skipping chapter, updated later if chapter included)
  const workResult = await db.insert(works).values({
    title,
    summary: summary || null,
    notes: notes || null,
    language: 'en',
    wordCount: 0,
    complete: 0,
    publishedAt: isDraft ? null : sql`(datetime('now'))`,
  });

  const workId = Number(workResult.meta?.last_row_id ?? workResult[0]?.meta?.last_row_id);

  await db.insert(creatorships).values({ pseudId, workId, role: 'author' });

  let chapterId: number | null = null;

  if (!skipChapter) {
    const contentMd = chapter_content || '';
    const contentHtml = contentMd ? markdownToHtml(contentMd) : null;
    const wordCount = contentMd ? contentMd.split(/\s+/).filter(Boolean).length : 0;

    // Validate chapter_images: must be an array of strings starting with 'chapters/'
    const validImages: string[] = Array.isArray(chapter_images) 
      ? chapter_images.filter((img: string) => typeof img === 'string' && img.startsWith('chapters/') && !img.includes('..'))
      : [];
    const imagesJson = JSON.stringify(validImages);

    const chapterResult = await db.insert(chapters).values({
      workId,
      position: 1,
      title: chapter_title || 'Chapter 1',
      contentMd,
      contentHtml,
      draft: isDraft,
      wordCount,
      images: imagesJson,
    });
    chapterId = Number(chapterResult.meta?.last_row_id ?? chapterResult[0]?.meta?.last_row_id);

    // Update work word_count with chapter's word count
    await db.update(works).set({ wordCount }).where(eq(works.id, workId));
  }

  // Apply resolved tag IDs
  for (const tid of resolvedTagIds) {
    await db.insert(taggings).values({ tagId: tid, workId }).onConflictDoNothing();
  }

  // Auto-create rating/category/warning tags if provided
  const autoTags = [
    { type: 'rating', name: rating },
    { type: 'category', name: category },
    { type: 'warning', name: warning },
  ].filter(t => t.name);

  for (const t of autoTags) {
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

  const work = await db.select().from(works).where(eq(works.id, workId)).get();
  return new Response(JSON.stringify({ work, chapter_id: chapterId }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};