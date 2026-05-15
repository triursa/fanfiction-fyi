export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth, checkApproved } from '@/lib/auth';
import { collections, collectionItems, works, pseuds } from '@/lib/schema';
import { eq, and, like, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/**
 * POST /api/collectionItems — Add a work to a collection
 * Body: { collection_id, work_id }
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const approval = checkApproved(auth);
  if ('forbidden' in approval) {
    return new Response(JSON.stringify({ error: approval.forbidden === 'banned' ? 'Account suspended' : 'Account not yet approved' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { collection_id, work_id } = body;
  if (!collection_id || !work_id) {
    return new Response(JSON.stringify({ error: 'collection_id and work_id are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check collection exists and user is owner
  const collection = await db.select({ id: collections.id, ownerPseudId: collections.ownerPseudId })
    .from(collections).where(eq(collections.id, Number(collection_id))).get();
  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const isOwner = auth.pseuds.some(p => p.id === collection.ownerPseudId);
  if (!isOwner) {
    return new Response(JSON.stringify({ error: 'Only the collection owner can add works' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Check work exists and is published
  const work = await db.select({ id: works.id, title: works.title, publishedAt: works.publishedAt })
    .from(works).where(eq(works.id, Number(work_id))).get();
  if (!work || !work.publishedAt) {
    return new Response(JSON.stringify({ error: 'Work not found or not published' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Check for duplicate
  const existing = await db.select({ id: collectionItems.id })
    .from(collectionItems)
    .where(and(eq(collectionItems.collectionId, collection.id), eq(collectionItems.workId, work.id)))
    .get();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Work already in collection' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  await db.insert(collectionItems).values({
    collectionId: collection.id,
    workId: work.id,
  });

  return new Response(JSON.stringify({ ok: true, work_id: work.id, collection_id: collection.id }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

/**
 * DELETE /api/collectionItems — Remove a work from a collection
 * Body: { collection_id, work_id }
 */
export const DELETE: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { collection_id, work_id } = body;
  if (!collection_id || !work_id) {
    return new Response(JSON.stringify({ error: 'collection_id and work_id are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check collection exists and user is owner
  const collection = await db.select({ id: collections.id, ownerPseudId: collections.ownerPseudId })
    .from(collections).where(eq(collections.id, Number(collection_id))).get();
  if (!collection) {
    return new Response(JSON.stringify({ error: 'Collection not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const isOwner = auth.pseuds.some(p => p.id === collection.ownerPseudId);
  if (!isOwner) {
    return new Response(JSON.stringify({ error: 'Only the collection owner can remove works' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await db.delete(collectionItems)
    .where(and(eq(collectionItems.collectionId, collection.id), eq(collectionItems.workId, Number(work_id))));

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};