export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { tags } from '@/lib/schema';
import { requireAuth } from '@/lib/auth';
import { eq, like, and, asc, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, locals }) => {
  const drz = getDrizzle(locals.runtime.env.DB as D1Database);
  const params = url.searchParams;
  const type = params.get('type');
  const name = params.get('name');
  const limit = Math.min(Number(params.get('limit') || 25), 100);

  const conditions = [];
  if (type) conditions.push(eq(tags.type, type as any));
  if (name) conditions.push(like(tags.name, `%${name}%`));

  const result = await drz
    .select()
    .from(tags)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(tags.name))
    .limit(limit);

  // Convert camelCase to snake_case for API compatibility
  const tagsResult = result.map(t => ({
    id: t.id,
    name: t.name,
    type: t.type,
  }));

  return new Response(JSON.stringify(tagsResult), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  if (auth.user.role !== 'admin' && auth.user.role !== 'mod') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin or mod role required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, type } = body || {};
  if (!name || !type) {
    return new Response(JSON.stringify({ error: 'Name and type are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const validTypes = ['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'];
  if (!validTypes.includes(type)) {
    return new Response(JSON.stringify({ error: `Invalid tag type. Must be one of: ${validTypes.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const [inserted] = await drz.insert(tags).values({ name, type }).returning();
    return new Response(JSON.stringify({
      id: inserted.id,
      name: inserted.name,
      type: inserted.type,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Tag already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};