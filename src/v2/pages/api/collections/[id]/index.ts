import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../lib/db';
import { getAuth, requireAuth, checkApproved } from '../../../../lib/auth';
import { validateBody, updateCollectionSchema } from '../../../../lib/validation';
import { collections, collectionItems, pseuds, works } from '../../../../lib/schema/index';
import { eq, and, count, isNotNull } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/collections/[id] — Collection detail with items ──────

export const GET: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const collectionId = Number(params?.id);

  if (!collectionId || Number.isNaN(collectionId)) {
    return new Response(JSON.stringify({ error: 'Invalid collection ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch collection with owner name
  const collectionRow = await db
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
    .innerJoin(pseuds, eq(collections.ownerPseudId, pseuds.id))
    .where(eq(collections.id, collectionId))
    .get();

  if (!collectionRow) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Private collections: only visible to owner
  const privatePrivacies = ['private', 'closed'];
  if (privatePrivacies.includes(collectionRow.privacy ?? '')) {
    const auth = await getAuth(d1, request);
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Collection not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
    const pseudIds = userPseuds.map(p => p.id);
    if (!pseudIds.includes(collectionRow.ownerPseudId)) {
      return new Response(JSON.stringify({ error: 'Collection not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Fetch work items in this collection (only published works)
  const itemRows = await db
    .select({
      id: works.id,
      title: works.title,
      summary: works.summary,
      wordCount: works.wordCount,
      publishedAt: works.publishedAt,
      addedAt: collectionItems.addedAt,
    })
    .from(collectionItems)
    .innerJoin(works, eq(collectionItems.workId, works.id))
    .where(and(
      eq(collectionItems.collectionId, collectionId),
      isNotNull(works.publishedAt),
    ));

  const items = itemRows.map(w => ({
    id: w.id,
    title: w.title,
    summary: w.summary,
    wordCount: w.wordCount,
    publishedAt: w.publishedAt,
    addedAt: w.addedAt,
  }));

  return new Response(JSON.stringify({
    data: {
      ...collectionRow,
      items,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PUT /api/collections/[id] — Update collection ────────────────

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const collectionId = Number(params?.id);

  if (!collectionId || Number.isNaN(collectionId)) {
    return new Response(JSON.stringify({ error: 'Invalid collection ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify collection exists
  const collection = await db.select().from(collections).where(eq(collections.id, collectionId)).get();
  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership — collection's ownerPseud must belong to this user
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(collection.ownerPseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the collection owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate body
  const [data, error] = await validateBody(request, updateCollectionSchema);
  if (error) return error;

  // Build update object — name is immutable (it's the slug)
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.privacy !== undefined) updates.privacy = data.privacy;

  await db.update(collections).set(updates).where(eq(collections.id, collectionId));

  // Fetch updated collection with owner name
  const updated = await db
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
    .innerJoin(pseuds, eq(collections.ownerPseudId, pseuds.id))
    .where(eq(collections.id, collectionId))
    .get();

  return new Response(JSON.stringify({ data: updated }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/collections/[id] — Delete collection + items ─────

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const collectionId = Number(params?.id);

  if (!collectionId || Number.isNaN(collectionId)) {
    return new Response(JSON.stringify({ error: 'Invalid collection ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify collection exists
  const collection = await db.select().from(collections).where(eq(collections.id, collectionId)).get();
  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(collection.ownerPseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the collection owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete collection items first (cascade should handle it, but be explicit)
  await db.delete(collectionItems).where(eq(collectionItems.collectionId, collectionId));
  // Delete collection
  await db.delete(collections).where(eq(collections.id, collectionId));

  return new Response(JSON.stringify({ data: { id: collectionId, deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};