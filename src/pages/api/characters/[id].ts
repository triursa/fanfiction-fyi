import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, updateCharacterSchema } from '@/v2/lib/validation';
import { characters, characterAppearances, characterGroups, pseuds, works } from '@/v2/lib/schema/index';
import { eq, and, desc } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/characters/[id] — Character detail with appearances ──

export const GET: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const characterId = Number(params?.id);

  if (!characterId || Number.isNaN(characterId)) {
    return new Response(JSON.stringify({ error: 'Invalid character ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const characterRow = await db
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
    .where(eq(characters.id, characterId))
    .get();

  if (!characterRow) {
    return new Response(JSON.stringify({ error: 'Character not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const appearances = await db
    .select({
      id: characterAppearances.id,
      workId: characterAppearances.workId,
      role: characterAppearances.role,
      notes: characterAppearances.notes,
      createdAt: characterAppearances.createdAt,
      workTitle: works.title,
    })
    .from(characterAppearances)
    .innerJoin(works, eq(characterAppearances.workId, works.id))
    .where(eq(characterAppearances.characterId, characterId))
    .orderBy(desc(characterAppearances.createdAt));

  const data = {
    ...characterRow,
    appearances: appearances.map(a => ({
      id: a.id,
      workId: a.workId,
      workTitle: a.workTitle,
      role: a.role,
      notes: a.notes,
      createdAt: a.createdAt,
    })),
  };

  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PUT /api/characters/[id] — Update character (owner only) ──────

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const characterId = Number(params?.id);

  if (!characterId || Number.isNaN(characterId)) {
    return new Response(JSON.stringify({ error: 'Invalid character ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const character = await db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!character) {
    return new Response(JSON.stringify({ error: 'Character not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(character.pseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the character owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const [data, error] = await validateBody(request, updateCharacterSchema);
  if (error) return error;

  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.groupId !== undefined) updates.groupId = data.groupId;

  await db.update(characters).set(updates).where(eq(characters.id, characterId));

  const updated = await db
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
    .where(eq(characters.id, characterId))
    .get();

  return new Response(JSON.stringify({ data: updated }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/characters/[id] — Delete character (owner only) ────

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const characterId = Number(params?.id);

  if (!characterId || Number.isNaN(characterId)) {
    return new Response(JSON.stringify({ error: 'Invalid character ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const character = await db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!character) {
    return new Response(JSON.stringify({ error: 'Character not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(character.pseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the character owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await db.delete(characterAppearances).where(eq(characterAppearances.characterId, characterId));
  await db.delete(characters).where(eq(characters.id, characterId));

  return new Response(JSON.stringify({ data: { id: characterId, deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
