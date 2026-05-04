export const prerender = false;

import { getDrizzle } from '@/lib/db';
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