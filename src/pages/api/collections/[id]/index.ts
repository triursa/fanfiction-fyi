import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, updateCollectionSchema } from '@/v2/lib/validation';
import { collections, collectionItems, pseuds, works, creatorships, tags, taggings } from '@/v2/lib/schema/index';
import { eq, and, count, sql } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/collections/[id] — Collection detail with works list ──────

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

  // Fetch collection with owner pseud name and userId
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
      ownerUserId: pseuds.userId,
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

  // Privacy check: private collections only visible to owner
  const auth = await getAuth(d1, request);
  const userId = auth?.user.id;
  if (
    (collectionRow.privacy === 'private' || collectionRow.privacy === 'closed') &&
    userId !== collectionRow.ownerUserId
  ) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch works in this collection (only published, non-draft works — unless owner)
  const showDrafts = userId === collectionRow.ownerUserId;
  const workConditions = showDrafts
    ? [eq(collectionItems.collectionId, collectionId)]
    : [eq(collectionItems.collectionId, collectionId), eq(works.draft, 0)];

  const workRows = await db
    .select({
      id: works.id,
      title: works.title,
      summary: works.summary,
      wordCount: works.wordCount,
      complete: works.complete,
      draft: works.draft,
      publishedAt: works.publishedAt,
      updatedAt: works.updatedAt,
    })
    .from(collectionItems)
    .innerJoin(works, eq(collectionItems.workId, works.id))
    .where(and(...workConditions))
    .orderBy(sql`${collectionItems.addedAt} DESC`);

  // Build works with authors and tags
  let workItems: any[] = [];

  if (workRows.length > 0) {
    const workIds = workRows.map(w => w.id);

    // Fetch author pseuds for all works
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

    // Fetch tags for all works
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

    workItems = workRows.map(w => ({
      id: w.id,
      title: w.title,
      summary: w.summary,
      wordCount: w.wordCount,
      complete: w.complete,
      updatedAt: w.updatedAt,
      authors: authorsByWork.get(w.id) || [],
      tags: tagsByWork.get(w.id) || [],
    }));
  }

  return new Response(JSON.stringify({
    data: {
      id: collectionRow.id,
      name: collectionRow.name,
      title: collectionRow.title,
      description: collectionRow.description,
      ownerPseudId: collectionRow.ownerPseudId,
      ownerName: collectionRow.ownerName,
      ownerUserId: collectionRow.ownerUserId,
      privacy: collectionRow.privacy,
      createdAt: collectionRow.createdAt,
      updatedAt: collectionRow.updatedAt,
      works: workItems,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PUT /api/collections/[id] — Update collection (owner only) ──────

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
  const existing = await db
    .select()
    .from(collections)
    .where(eq(collections.id, collectionId))
    .get();

  if (!existing) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership — collection's ownerPseud must belong to this user
  const ownerPseud = await db
    .select({ userId: pseuds.userId })
    .from(pseuds)
    .where(eq(pseuds.id, existing.ownerPseudId))
    .get();

  if (!ownerPseud || ownerPseud.userId !== auth.user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the collection owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate body
  const [data, error] = await validateBody(request, updateCollectionSchema);
  if (error) return error;

  // Build update object
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
      ownerUserId: pseuds.userId,
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

// ─── DELETE /api/collections/[id] — Delete collection (owner only) ───

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
  const existing = await db
    .select()
    .from(collections)
    .where(eq(collections.id, collectionId))
    .get();

  if (!existing) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership
  const ownerPseud = await db
    .select({ userId: pseuds.userId })
    .from(pseuds)
    .where(eq(pseuds.id, existing.ownerPseudId))
    .get();

  if (!ownerPseud || ownerPseud.userId !== auth.user.id) {
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