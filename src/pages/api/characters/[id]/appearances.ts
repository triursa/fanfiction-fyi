export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { characters, characterAppearances, works } from '@/lib/schema';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { eq, desc, count } from 'drizzle-orm';
import type { APIRoute } from 'astro';
import type { CharacterRole } from '@/lib/types';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

const VALID_ROLES: CharacterRole[] = ['protagonist', 'deuteragonist', 'antagonist', 'side', 'cameo'];

// GET /api/characters/[id]/appearances — List appearances for a character
export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const drz = getDrizzle(locals.runtime.env.DB as D1Database);
  const id = Number(params.id);
  if (!id) return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });

  const page = Math.max(Number(new URL(request.url).searchParams.get('page') || 1), 1);
  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') || 25), 100);
  const offset = (page - 1) * limit;

  const appearances = await drz
    .select({
      id: characterAppearances.id,
      characterId: characterAppearances.characterId,
      workId: characterAppearances.workId,
      role: characterAppearances.role,
      notes: characterAppearances.notes,
      addedBy: characterAppearances.addedBy,
      createdAt: characterAppearances.createdAt,
      workTitle: works.title,
      workSummary: works.summary,
      wordCount: works.wordCount,
      publishedAt: works.publishedAt,
      workComplete: works.complete,
    })
    .from(characterAppearances)
    .innerJoin(works, eq(characterAppearances.workId, works.id))
    .where(eq(characterAppearances.characterId, id))
    .orderBy(desc(characterAppearances.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  const countRow = await drz
    .select({ count: count() })
    .from(characterAppearances)
    .where(eq(characterAppearances.characterId, id))
    .get();

  return new Response(JSON.stringify({ appearances, total: countRow?.count ?? 0, page, limit }), {
    headers: { 'Content-Type': 'application/json', ...cors },
  });
};

// POST /api/characters/[id]/appearances — Add character to a work
export const POST: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const id = Number(params.id);
  if (!id) return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const character = await drz.select().from(characters).where(eq(characters.id, id)).get();
  if (!character) return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { work_id, role, notes } = body || {};
  if (!work_id) return new Response(JSON.stringify({ error: 'work_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Validate work exists
  const work = await drz.select({ id: works.id }).from(works).where(eq(works.id, Number(work_id))).get();
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const charRole: CharacterRole = (role && VALID_ROLES.includes(role)) ? role : 'side';
  const pseudId = auth.pseuds[0]?.id ?? null;

  try {
    const inserted = await drz.insert(characterAppearances).values({
      characterId: id,
      workId: Number(work_id),
      role: charRole,
      notes: notes || null,
      addedBy: pseudId,
    }).returning().get();

    return new Response(JSON.stringify(inserted), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Character already linked to this work' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};