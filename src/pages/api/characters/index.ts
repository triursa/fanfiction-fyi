import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, validateQuery, createCharacterSchema, browseCharactersSchema } from '@/v2/lib/validation';
import { characters, characterGroups, pseuds } from '@/v2/lib/schema/index';
import { eq, and, desc, count } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/characters — Browse characters (paginated, optional groupId filter) ──

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const query = validateQuery(url, browseCharactersSchema);
  const { page, limit, groupId } = query;
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];
  if (groupId) {
    conditions.push(eq(characters.groupId, groupId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(characters)
    .where(whereClause);

  // Fetch characters with pseud name and group name
  const characterRows = await db
    .select({
      id: characters.id,
      name: characters.name,
      description: characters.description,
      groupId: characters.groupId,
      pseudId: characters.pseudId,
      createdAt: characters.createdAt,
      updatedAt: characters.updatedAt,
      pseudName: pseuds.name,
      groupName: characterGroups.name,
    })
    .from(characters)
    .innerJoin(pseuds, eq(characters.pseudId, pseuds.id))
    .leftJoin(characterGroups, eq(characters.groupId, characterGroups.id))
    .where(whereClause)
    .orderBy(desc(characters.createdAt))
    .limit(limit)
    .offset(offset);

  const data = characterRows.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    groupId: c.groupId,
    pseudId: c.pseudId,
    pseudName: c.pseudName,
    groupName: c.groupName,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/characters — Create a character (auth required) ─────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const [data, error] = await validateBody(request, createCharacterSchema);
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

  // If groupId provided, verify it exists and belongs to user
  if (data.groupId) {
    const group = await db
      .select()
      .from(characterGroups)
      .where(eq(characterGroups.id, data.groupId))
      .get();

    if (!group) {
      return new Response(JSON.stringify({ error: 'Character group not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const [inserted] = await db
      .insert(characters)
      .values({
        name: data.name,
        description: data.description ?? null,
        groupId: data.groupId ?? null,
        pseudId: data.pseudId,
      })
      .returning();

    // Fetch with pseud name and group name
    const pseudData = await db
      .select({ name: pseuds.name })
      .from(pseuds)
      .where(eq(pseuds.id, inserted.pseudId))
      .get();

    let groupName: string | null = null;
    if (inserted.groupId) {
      const groupData = await db
        .select({ name: characterGroups.name })
        .from(characterGroups)
        .where(eq(characterGroups.id, inserted.groupId))
        .get();
      groupName = groupData?.name ?? null;
    }

    return new Response(JSON.stringify({
      data: {
        id: inserted.id,
        name: inserted.name,
        description: inserted.description,
        groupId: inserted.groupId,
        pseudId: inserted.pseudId,
        pseudName: pseudData?.name ?? null,
        groupName,
        createdAt: inserted.createdAt,
        updatedAt: inserted.updatedAt,
      },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Failed to create character' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
