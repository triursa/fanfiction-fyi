import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, validateQuery, createCharacterGroupSchema, browseCharacterGroupsSchema } from '@/v2/lib/validation';
import { characterGroups, pseuds, characters } from '@/v2/lib/schema/index';
import { eq, and, desc, count } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/characters/groups — Browse character groups ───────────

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const query = validateQuery(url, browseCharacterGroupsSchema);
  const { page, limit } = query;
  const offset = (page - 1) * limit;

  const [{ total }] = await db
    .select({ total: count() })
    .from(characterGroups);

  const groupRows = await db
    .select({
      id: characterGroups.id,
      name: characterGroups.name,
      description: characterGroups.description,
      pseudId: characterGroups.pseudId,
      createdAt: characterGroups.createdAt,
      updatedAt: characterGroups.updatedAt,
      pseudName: pseuds.name,
    })
    .from(characterGroups)
    .innerJoin(pseuds, eq(characterGroups.pseudId, pseuds.id))
    .orderBy(desc(characterGroups.createdAt))
    .limit(limit)
    .offset(offset);

  const data = groupRows.map(g => ({
    id: g.id,
    name: g.name,
    description: g.description,
    pseudId: g.pseudId,
    pseudName: g.pseudName,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/characters/groups — Create a character group (auth required) ──

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const [data, error] = await validateBody(request, createCharacterGroupSchema);
  if (error) return error;

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

  try {
    const [inserted] = await db
      .insert(characterGroups)
      .values({
        name: data.name,
        description: data.description ?? null,
        pseudId: data.pseudId,
      })
      .returning();

    const pseudData = await db
      .select({ name: pseuds.name })
      .from(pseuds)
      .where(eq(pseuds.id, inserted.pseudId))
      .get();

    return new Response(JSON.stringify({
      data: {
        id: inserted.id,
        name: inserted.name,
        description: inserted.description,
        pseudId: inserted.pseudId,
        pseudName: pseudData?.name ?? null,
        createdAt: inserted.createdAt,
        updatedAt: inserted.updatedAt,
      },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Failed to create character group' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
