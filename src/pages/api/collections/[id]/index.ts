export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth, checkApproved } from '@/lib/auth';
import { collections, collectionItems, works, pseuds } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray, isNotNull } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const collectionId = Number(params.id);
  if (!collectionId || isNaN(collectionId)) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let collectionRow;
  try {
    collectionRow = await db
      .select({
        id: collections.id,
        name: collections.name,
        title: collections.title,
        description: collections.description,
        ownerPseudId: collections.ownerPseudId,
        privacy: collections.privacy,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        ownerName: pseuds.name,
      })
      .from(collections)
      .innerJoin(pseuds, eq(pseuds.id, collections.ownerPseudId))
      .where(eq(collections.id, collectionId))
      .get();
  } catch (err) {
    console.error('DB error fetching collection:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!collectionRow) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Only show public/unrevealed collections via API
  if (!['public', 'unrevealed'].includes(collectionRow.privacy ?? '')) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Convert to snake_case for API compatibility
  const collection = {
    id: collectionRow.id,
    name: collectionRow.name,
    title: collectionRow.title,
    description: collectionRow.description,
    owner_pseud_id: collectionRow.ownerPseudId,
    privacy: collectionRow.privacy,
    created_at: collectionRow.createdAt,
    updated_at: collectionRow.updatedAt,
    owner_name: collectionRow.ownerName,
  };

  let workList: any[] = [];
  try {
    const workRows = await db
      .select({
        id: works.id,
        title: works.title,
        summary: works.summary,
        wordCount: works.wordCount,
        publishedAt: works.publishedAt,
      })
      .from(works)
      .innerJoin(collectionItems, eq(works.id, collectionItems.workId))
      .where(and(eq(collectionItems.collectionId, collectionId), isNotNull(works.publishedAt)));

    workList = workRows.map(w => ({
      id: w.id,
      title: w.title,
      summary: w.summary,
      word_count: w.wordCount,
      published_at: w.publishedAt,
    }));
  } catch (err) {
    workList = [];
  }

  return new Response(JSON.stringify({ collection, works: workList }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const collectionId = Number(params.id);
  if (!collectionId || isNaN(collectionId)) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify ownership
  const collection = await db.select().from(collections).where(eq(collections.id, collectionId)).get();
  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudIds = auth.pseuds.map((p: any) => p.id);
  if (!pseudIds.includes(collection.ownerPseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the collection owner' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { title, description, privacy } = body || {};
  const updates: any = { updatedAt: sql`(datetime('now'))` };
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (privacy !== undefined) {
    const validPrivacy = ['open', 'moderated', 'closed', 'private', 'public', 'unrevealed'];
    if (validPrivacy.includes(privacy)) updates.privacy = privacy;
  }

  await db.update(collections).set(updates).where(eq(collections.id, collectionId));
  const updated = await db.select().from(collections).where(eq(collections.id, collectionId)).get();

  return new Response(JSON.stringify({
    id: updated.id,
    name: updated.name,
    title: updated.title,
    description: updated.description,
    privacy: updated.privacy,
    updated_at: updated.updatedAt,
  }), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const collectionId = Number(params.id);
  if (!collectionId || isNaN(collectionId)) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const collection = await db.select().from(collections).where(eq(collections.id, collectionId)).get();
  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudIds = auth.pseuds.map((p: any) => p.id);
  if (!pseudIds.includes(collection.ownerPseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the collection owner' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await db.delete(collections).where(eq(collections.id, collectionId));

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};