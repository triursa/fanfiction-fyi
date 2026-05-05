export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth, checkApproved } from '@/lib/auth';
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

export const POST: APIRoute = async ({ request, locals }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...cors } });

  const approval = checkApproved(auth);
  if ('forbidden' in approval) {
    return new Response(JSON.stringify({ error: approval.forbidden === 'banned' ? 'Account suspended' : 'Account not yet approved' }), { status: 403, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  const { name, title, description, privacy } = body || {};
  if (!name || !title) {
    return new Response(JSON.stringify({ error: 'Name and title are required' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  if (!/^[a-z0-9_-]{2,64}$/.test(name)) {
    return new Response(JSON.stringify({ error: 'Name must be 2-64 characters: lowercase letters, numbers, hyphens, underscores' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  const pseudId = body?.pseud_id && auth.pseuds.some((p: any) => p.id === Number(body.pseud_id))
    ? Number(body.pseud_id)
    : auth.pseuds[0]?.id;
  if (!pseudId) {
    return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  const existing = await db.select({ id: collections.id }).from(collections).where(eq(collections.name, name)).get();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Collection URL name already taken' }), { status: 409, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  const validPrivacy = ['public', 'unrevealed', 'private'];
  const privacyValue = validPrivacy.includes(privacy) ? privacy : 'public';

  try {
    const [inserted] = await db.insert(collections).values({
      name,
      title,
      description: description ?? null,
      ownerPseudId: pseudId,
      privacy: privacyValue,
    }).returning();

    return new Response(JSON.stringify({
      id: inserted.id,
      name: inserted.name,
      title: inserted.title,
      description: inserted.description,
      privacy: inserted.privacy,
      created_at: inserted.createdAt,
    }), { status: 201, headers: { 'Content-Type': 'application/json', ...cors } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Collection URL name already taken' }), { status: 409, headers: { 'Content-Type': 'application/json', ...cors } });
    }
    return new Response(JSON.stringify({ error: 'Failed to create collection' }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
  }
};