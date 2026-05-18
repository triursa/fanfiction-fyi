import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, addCollectionItemSchema, removeCollectionItemSchema } from '@/v2/lib/validation';
import { collections, collectionItems, pseuds, works } from '@/v2/lib/schema/index';
import { eq, and } from 'drizzle-orm';

export const config = { auth: 'required' as const };

// ─── POST /api/collectionItems — Add a work to a collection ──────────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, addCollectionItemSchema);
  if (error) return error;

  // Verify collection exists
  const collection = await db
    .select()
    .from(collections)
    .where(eq(collections.id, data.collectionId))
    .get();

  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify work exists
  const work = await db
    .select({ id: works.id })
    .from(works)
    .where(eq(works.id, data.workId))
    .get();

  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Permission check based on collection privacy
  const ownerPseud = await db
    .select({ userId: pseuds.userId })
    .from(pseuds)
    .where(eq(pseuds.id, collection.ownerPseudId))
    .get();

  const isOwner = ownerPseud && ownerPseud.userId === auth.user.id;

  if (!isOwner) {
    // Non-owner can only add to "open" collections
    if (collection.privacy !== 'open') {
      return new Response(JSON.stringify({ error: 'Only the collection owner can add works to this collection' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Check for duplicate (work already in collection)
  const existing = await db
    .select({ id: collectionItems.id })
    .from(collectionItems)
    .where(and(
      eq(collectionItems.collectionId, data.collectionId),
      eq(collectionItems.workId, data.workId),
    ))
    .get();

  if (existing) {
    return new Response(JSON.stringify({ error: 'Work is already in this collection' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Add work to collection
  try {
    const [inserted] = await db
      .insert(collectionItems)
      .values({
        collectionId: data.collectionId,
        workId: data.workId,
      })
      .returning();

    // Update collection's updatedAt timestamp
    await db
      .update(collections)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(collections.id, data.collectionId));

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
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to add work to collection' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// ─── DELETE /api/collectionItems — Remove a work from a collection ───

export const DELETE: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, removeCollectionItemSchema);
  if (error) return error;

  // Verify collection exists
  const collection = await db
    .select()
    .from(collections)
    .where(eq(collections.id, data.collectionId))
    .get();

  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Permission check: owner can always remove; for open collections, anyone can remove their own works
  const ownerPseud = await db
    .select({ userId: pseuds.userId })
    .from(pseuds)
    .where(eq(pseuds.id, collection.ownerPseudId))
    .get();

  const isOwner = ownerPseud && ownerPseud.userId === auth.user.id;

  if (!isOwner) {
    // Non-owner can only remove from open collections
    if (collection.privacy !== 'open') {
      return new Response(JSON.stringify({ error: 'Only the collection owner can remove works from this collection' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Find the collection item
  const item = await db
    .select()
    .from(collectionItems)
    .where(and(
      eq(collectionItems.collectionId, data.collectionId),
      eq(collectionItems.workId, data.workId),
    ))
    .get();

  if (!item) {
    return new Response(JSON.stringify({ error: 'Work is not in this collection' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete the collection item
  await db
    .delete(collectionItems)
    .where(eq(collectionItems.id, item.id));

  // Update collection's updatedAt timestamp
  await db
    .update(collections)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(collections.id, data.collectionId));

  return new Response(JSON.stringify({ data: { id: item.id, deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};