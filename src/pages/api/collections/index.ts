import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth, checkApproved } from '@/v2/lib/auth';
import {
  validateBody,
  validateQuery,
  createCollectionSchema,
  browseCollectionsSchema,
} from '@/v2/lib/validation';
import { collections, collectionItems, pseuds } from '@/v2/lib/schema/index';
import { eq, and, desc, count, like, or, inArray, sql } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/collections — Browse collections with pagination, privacy filter, search ──

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Parse query params
  const query = validateQuery(url, browseCollectionsSchema);
  const { page, limit } = query;
  const offset = (page - 1) * limit;

  // Search by name (q param) — not in browseCollectionsSchema, read separately
  const searchQuery = url.searchParams.get('q') || '';

  // Check if user is authenticated (for showing own private collections)
  const auth = await getAuth(d1, request);
  const userId = auth?.user.id;

  // Build where conditions
  const conditions = [];

  // Privacy filter from query param
  if (query.privacy) {
    conditions.push(eq(collections.privacy, query.privacy));
  }

  // Non-owners can only see open/moderated/public collections;
  // owners also see their own private/closed/unrevealed
  if (!userId) {
    // Not authenticated: only show non-private collections
    conditions.push(
      sql`${collections.privacy} IN ('open', 'moderated', 'public')`
    );
  } else {
    // Authenticated: show public/open/moderated + own collections of any privacy
    conditions.push(
      or(
        sql`${collections.privacy} IN ('open', 'moderated', 'public')`,
        eq(pseuds.userId, userId)
      )!
    );
  }

  // Search filter
  if (searchQuery) {
    conditions.push(like(collections.title, `%${searchQuery}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(collections)
    .innerJoin(pseuds, eq(collections.ownerPseudId, pseuds.id))
    .where(whereClause);

  // Fetch collections with owner pseud name
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
      ownerUserId: pseuds.userId,
    })
    .from(collections)
    .innerJoin(pseuds, eq(collections.ownerPseudId, pseuds.id))
    .where(whereClause)
    .orderBy(desc(collections.updatedAt))
    .limit(limit)
    .offset(offset);

  // Fetch work counts for these collections
  let workCountsByCollection = new Map<number, number>();
  if (collectionRows.length > 0) {
    const collectionIds = collectionRows.map(c => c.id);
    const workCounts = await db
      .select({
        collectionId: collectionItems.collectionId,
        count: count(),
      })
      .from(collectionItems)
      .where(inArray(collectionItems.collectionId, collectionIds))
      .groupBy(collectionItems.collectionId);

    for (const row of workCounts) {
      workCountsByCollection.set(row.collectionId, row.count);
    }
  }

  const data = collectionRows.map(c => ({
    id: c.id,
    name: c.name,
    title: c.title,
    description: c.description,
    ownerPseudId: c.ownerPseudId,
    ownerName: c.ownerName,
    ownerUserId: c.ownerUserId,
    privacy: c.privacy,
    workCount: workCountsByCollection.get(c.id) || 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/collections — Create a collection ─────────────────────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth + approved
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

  // Check name uniqueness
  const existing = await db
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.name, data.name))
    .get();

  if (existing) {
    return new Response(JSON.stringify({ error: 'A collection with this URL slug already exists' }), {
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

    // Fetch owner pseud name
    const ownerPseud = await db
      .select({ name: pseuds.name, userId: pseuds.userId })
      .from(pseuds)
      .where(eq(pseuds.id, inserted.ownerPseudId))
      .get();

    return new Response(JSON.stringify({
      data: {
        id: inserted.id,
        name: inserted.name,
        title: inserted.title,
        description: inserted.description,
        ownerPseudId: inserted.ownerPseudId,
        ownerName: ownerPseud?.name ?? null,
        ownerUserId: ownerPseud?.userId ?? null,
        privacy: inserted.privacy,
        createdAt: inserted.createdAt,
        updatedAt: inserted.updatedAt,
      },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    // Handle unique constraint violation on name
    if (e?.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'A collection with this URL slug already exists' }), {
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