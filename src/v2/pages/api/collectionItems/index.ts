import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../lib/db';
import { requireAuth, checkApproved } from '../../../lib/auth';
import { validateBody, addCollectionItemSchema, removeCollectionItemSchema } from '../../../lib/validation';
import { collections, collectionItems, works, pseuds } from '../../../lib/schema/index';
import { eq, and } from 'drizzle-orm';

export const config = { auth: 'required' as const };

// ─── POST /api/collectionItems — Add a work to a collection ───────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, addCollectionItemSchema);
  if (error) return error;

  // Verify the collection exists and user is the owner
  const collection = await db
    .select({ id: collections.id, ownerPseudId: collections.ownerPseudId, privacy: collections.privacy })
    .from(collections)
    .where(eq(collections.id, data.collectionId))
    .get();

  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the user owns this collection via their pseuds
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(collection.ownerPseudId)) {
    return new Response(JSON.stringify({ error: 'Only the collection owner can add works' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the work exists and is published (not draft)
  const work = await db
    .select({ id: works.id, title: works.title, draft: works.draft, publishedAt: works.publishedAt })
    .from(works)
    .where(eq(works.id, data.workId))
    .get();

  if (!work || work.draft || !work.publishedAt) {
    return new Response(JSON.stringify({ error: 'Work not found or not published' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for duplicate
  const existing = await db
    .select({ id: collectionItems.id })
    .from(collectionItems)
    .where(and(
      eq(collectionItems.collectionId, collection.id),
      eq(collectionItems.workId, work.id),
    ))
    .get();

  if (existing) {
    return new Response(JSON.stringify({ error: 'Work already in collection' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Add the work to the collection
  const [inserted] = await db
    .insert(collectionItems)
    .values({
      collectionId: collection.id,
      workId: work.id,
    })
    .returning();

  return new Response(JSON.stringify({
    data: {
      id: inserted.id,
      collectionId: inserted.collectionId,
      workId: inserted.workId,
      addedAt: inserted.addedAt,
    },
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/collectionItems — Remove a work from a collection

export const DELETE: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, removeCollectionItemSchema);
  if (error) return error;

  // Verify the collection exists
  const collection = await db
    .select({ id: collections.id, ownerPseudId: collections.ownerPseudId })
    .from(collections)
    .where(eq(collections.id, data.collectionId))
    .get();

  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the user owns this collection via their pseuds
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(collection.ownerPseudId)) {
    return new Response(JSON.stringify({ error: 'Only the collection owner can remove works' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete the collection item
  const result = await db
    .delete(collectionItems)
    .where(and(
      eq(collectionItems.collectionId, collection.id),
      eq(collectionItems.workId, data.workId),
    ));

  return new Response(JSON.stringify({ data: { collectionId: collection.id, workId: data.workId, removed: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};