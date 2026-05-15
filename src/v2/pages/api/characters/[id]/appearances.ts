import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../../lib/db';
import { getAuth, requireAuth, checkApproved } from '../../../../../lib/auth';
import { validateBody, validateQuery, createAppearanceSchema, removeAppearanceSchema } from '../../../../../lib/validation';
import { characterAppearances, characters, works, pseuds } from '../../../../../lib/schema/index';
import { eq, and, desc } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/characters/[id]/appearances — List appearances for a character ──

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

  // Verify character exists
  const character = await db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!character) {
    return new Response(JSON.stringify({ error: 'Character not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch appearances with work info
  const appearances = await db
    .select({
      id: characterAppearances.id,
      characterId: characterAppearances.characterId,
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

  return new Response(JSON.stringify({ data: appearances }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/characters/[id]/appearances — Add appearance (auth required) ──

export const POST: APIRoute = async ({ request, locals, params }) => {
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

  const [data, error] = await validateBody(request, createAppearanceSchema);
  if (error) return error;

  // Override characterId from URL param
  data.characterId = characterId;

  // Verify character exists
  const character = await db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!character) {
    return new Response(JSON.stringify({ error: 'Character not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify work exists
  const work = await db.select().from(works).where(eq(works.id, data.workId)).get();
  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for duplicate
  const existing = await db
    .select()
    .from(characterAppearances)
    .where(and(
      eq(characterAppearances.characterId, data.characterId),
      eq(characterAppearances.workId, data.workId),
    ))
    .get();

  if (existing) {
    return new Response(JSON.stringify({ error: 'Character already appears in this work' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const [inserted] = await db
      .insert(characterAppearances)
      .values({
        characterId: data.characterId,
        workId: data.workId,
        role: data.role,
        notes: data.notes ?? null,
      })
      .returning();

    return new Response(JSON.stringify({
      data: {
        ...inserted,
        workTitle: work.title,
      },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Failed to add appearance' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// ─── DELETE /api/characters/[id]/appearances — Remove appearance (auth required) ──

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

  const [data, error] = await validateBody(request, removeAppearanceSchema);
  if (error) return error;

  // Verify the appearance exists
  const appearance = await db
    .select()
    .from(characterAppearances)
    .where(and(
      eq(characterAppearances.characterId, characterId),
      eq(characterAppearances.workId, data.workId),
    ))
    .get();

  if (!appearance) {
    return new Response(JSON.stringify({ error: 'Appearance not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await db
    .delete(characterAppearances)
    .where(eq(characterAppearances.id, appearance.id));

  return new Response(JSON.stringify({ data: { characterId, workId: data.workId, deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
