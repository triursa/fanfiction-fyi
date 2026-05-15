import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../lib/db';
import { getAuth, requireAuth, checkApproved } from '../../../lib/auth';
import { validateBody, validateQuery, createCollectionSchema, browseCollectionsSchema } from '../../../lib/validation';
import { collections, collectionItems, pseuds, works } from '../../../lib/schema/index';
import { eq, and, or, desc, count, sql, inArray } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/collections — Browse collections ──────────────────────

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Parse query params
  const query = validateQuery(url, browseCollectionsSchema);
  const { page, limit } = query;
  const offset = (page - 1) * limit;
  const privacyFilter = query.privacy;

  // Public: only show non-private collections (public, unrevealed, open, moderated)
  // If ?privacy= filter is provided AND user is owner, show private ones too
  const publicPrivacies = ['public', 'unrevealed', 'open', 'moderated'];

  let whereConditions;

  if (privacyFilter) {
    // If filtering for private/closed collections, require auth and check ownership
    if (!publicPrivacies.includes(privacyFilter)) {
      const auth = await getAuth(d1, request);
      if (!auth) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Only show user's own private collections
      const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
      const pseudIds = userPseuds.map(p => p.id);
      if (pseudIds.length === 0) {
        return new Response(JSON.stringify({ data: [], total: 0, page, limit }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      whereConditions = and(
        eq(collections.privacy, privacyFilter),
        inArray(collections.ownerPseudId, pseudIds)
      );
    } else {
      whereConditions = eq(collections.privacy, privacyFilter);
    }
  } else {
    // Default: show all public-facing collections
    whereConditions = inArray(collections.privacy, publicPrivacies as any[]);
  }

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(collections)
    .where(whereConditions);

  // Fetch collections with item counts and owner name
  const collectionRows = await db
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
    .where(whereConditions)
    .orderBy(desc(collections.createdAt))
    .limit(limit)
    .offset(offset);

  // Fetch item counts for these collections
  let itemsByCollection = new Map<number, number>();
  if (collectionRows.length > 0) {
    const collectionIds = collectionRows.map(c => c.id);
    const itemCounts = await db
      .select({
        collectionId: collectionItems.collectionId,
        count: count(),
      })
      .from(collectionItems)
      .where(inArray(collectionItems.collectionId, collectionIds))
      .groupBy(collectionItems.collectionId);

    for (const row of itemCounts) {
      itemsByCollection.set(row.collectionId, row.count);
    }
  }

  const data = collectionRows.map(c => ({
    id: c.id,
    name: c.name,
    title: c.title,
    description: c.description,
    ownerPseudId: c.ownerPseudId,
    ownerName: c.ownerName,
    privacy: c.privacy,
    itemCount: itemsByCollection.get(c.id) || 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/collections — Create a collection ───────────────────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, createCollectionSchema);
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

  // Check for duplicate name
  const existing = await db
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.name, data.name))
    .get();

  if (existing) {
    return new Response(JSON.stringify({ error: 'Collection name (slug) already taken' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create collection
  try {
    const [inserted] = await db
      .insert(collections)
      .values({
        name: data.name,
        title: data.title,
        description: data.description ?? null,
        ownerPseudId: data.pseudId,
        privacy: data.privacy,
      })
      .returning();

    return new Response(JSON.stringify({
      data: {
        id: inserted.id,
        name: inserted.name,
        title: inserted.title,
        description: inserted.description,
        ownerPseudId: inserted.ownerPseudId,
        privacy: inserted.privacy,
        createdAt: inserted.createdAt,
        updatedAt: inserted.updatedAt,
      },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Collection name (slug) already taken' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Failed to create collection' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};