export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { corsHeaders, handleCors } from '@/lib/cors';
import { collections, collectionItems } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  const collectionRows = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      privacy: collections.privacy,
      itemCount: sql<number>`COUNT(${collectionItems.id})`.as('item_count'),
      createdAt: collections.createdAt,
    })
    .from(collections)
    .leftJoin(collectionItems, eq(collections.id, collectionItems.collectionId))
    .where(inArray(collections.privacy, ['public', 'unrevealed'] as any[]))
    .groupBy(collections.id)
    .orderBy(desc(collections.createdAt))
    .limit(50);

  // Convert to snake_case
  const collectionsList = collectionRows.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    privacy: c.privacy,
    item_count: c.itemCount,
    created_at: c.createdAt,
  }));

  return new Response(JSON.stringify({ collections: collectionsList }), {
    headers: { 'Content-Type': 'application/json', ...cors }
  });
};