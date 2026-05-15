export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { characters, characterGroups, characterAppearances, works, tags } from '@/lib/schema';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { eq, and, ne, desc, count, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const drz = getDrizzle(locals.runtime.env.DB as D1Database);
  const id = Number(params.id);
  if (!id) {
    return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  const character = await drz.select().from(characters).where(eq(characters.id, id)).get();
  if (!character) {
    return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  // Group info
  let group = null;
  if (character.groupId) {
    group = await drz.select().from(characterGroups).where(eq(characterGroups.id, character.groupId)).get();
  }

  // Group siblings (other characters in the same group)
  let groupSiblings: any[] = [];
  if (character.groupId) {
    groupSiblings = await drz
      .select({ id: characters.id, name: characters.name, fandom: characters.fandom })
      .from(characters)
      .where(and(eq(characters.groupId, character.groupId), ne(characters.id, id)))
      .all();
  }

  // Appearances
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
    })
    .from(characterAppearances)
    .innerJoin(works, eq(characterAppearances.workId, works.id))
    .where(eq(characterAppearances.characterId, id))
    .orderBy(desc(characterAppearances.createdAt))
    .all();

  // Work count
  const workCountRow = await drz
    .select({ count: count() })
    .from(characterAppearances)
    .where(eq(characterAppearances.characterId, id))
    .get();

  // Linked tag
  let tag = null;
  if (character.tagId) {
    tag = await drz.select().from(tags).where(eq(tags.id, character.tagId)).get();
  }

  return new Response(JSON.stringify({
    ...character,
    group,
    group_siblings: groupSiblings,
    appearances,
    work_count: workCountRow?.count ?? 0,
    tag,
  }), {
    headers: { 'Content-Type': 'application/json', ...cors },
  });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const id = Number(params.id);
  if (!id) return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const existing = await drz.select().from(characters).where(eq(characters.id, id)).get();
  if (!existing) return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Permission: creator or admin/mod
  const isCreator = existing.createdBy && auth.pseuds.some(p => p.id === existing.createdBy);
  const isPrivileged = ['admin', 'mod', 'founder'].includes(auth.user.role);
  if (!isCreator && !isPrivileged) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const allowedFields: Record<string, any> = {
    name: characters.name,
    fandom: characters.fandom,
    group_id: characters.groupId,
    description: characters.description,
    short_desc: characters.shortDesc,
    avatar_key: characters.avatarKey,
    aliases: characters.aliases,
  };

  const updates: Record<string, any> = {};
  let hasUpdates = false;

  for (const [field, column] of Object.entries(allowedFields)) {
    if (body[field] !== undefined) {
      updates[column] = field === 'aliases' && Array.isArray(body[field]) ? JSON.stringify(body[field]) : body[field];
      hasUpdates = true;
    }
  }

  if (!hasUpdates) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Always update updated_by and updated_at
  const pseudId = auth.pseuds[0]?.id ?? null;
  updates[characters.updatedBy] = pseudId;
  updates[characters.updatedAt] = sql`CURRENT_TIMESTAMP`;

  await drz.update(characters).set(updates).where(eq(characters.id, id));

  const updated = await drz.select().from(characters).where(eq(characters.id, id)).get();
  return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const isPrivileged = ['admin', 'mod', 'founder'].includes(auth.user.role);
  if (!isPrivileged) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin/mod role required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const id = Number(params.id);
  if (!id) return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const existing = await drz.select().from(characters).where(eq(characters.id, id)).get();
  if (!existing) return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // character_appearances cascade on delete
  await drz.delete(characters).where(eq(characters.id, id));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};