export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { characterGroups, characters } from '@/lib/schema';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { eq, like, sql, count, asc } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

// GET /api/characters/groups — List all character groups
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const drz = getDrizzle(locals.runtime.env.DB as D1Database);
  const q = url.searchParams.get('q') || '';

  const conditions = [];
  if (q) conditions.push(like(characterGroups.name, `%${q}%`));

  const where = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : sql`${conditions[0]} AND ${conditions.slice(1).map(c => sql`(${c})`).join(sql` AND `)}`) : undefined;

  const groups = await drz
    .select({
      id: characterGroups.id,
      name: characterGroups.name,
      description: characterGroups.description,
      createdAt: characterGroups.createdAt,
      updatedAt: characterGroups.updatedAt,
      characterCount: count(characters.id).as('character_count'),
    })
    .from(characterGroups)
    .leftJoin(characters, eq(characterGroups.id, characters.groupId))
    .where(conditions.length === 1 ? conditions[0] : undefined)
    .groupBy(characterGroups.id)
    .orderBy(asc(characterGroups.name))
    .all();

  return new Response(JSON.stringify(groups), { headers: { 'Content-Type': 'application/json', ...cors } });
};

// POST /api/characters/groups — Create a group
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, description } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const inserted = await drz.insert(characterGroups).values({
      name: name.trim(),
      description: description || null,
    }).returning().get();

    return new Response(JSON.stringify(inserted), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Group already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};