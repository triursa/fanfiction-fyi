export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { characters, tags } from '@/lib/schema';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { eq, and, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

// POST /api/characters — Create a new character
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, fandom: fandomVal, group_id, description, short_desc, avatar_key, aliases } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudId = auth.pseuds[0]?.id ?? null;
  const aliasesStr = Array.isArray(aliases) ? JSON.stringify(aliases) : (typeof aliases === 'string' ? aliases : null);

  // Auto-create a matching character tag if one doesn't exist
  let tagId: number | null = null;
  const existingTag = await drz
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.name, name.trim()), eq(tags.type, 'character')))
    .get();
  if (existingTag) {
    tagId = existingTag.id;
  } else {
    try {
      const inserted = await drz.insert(tags).values({ name: name.trim(), type: 'character' }).returning({ id: tags.id }).get();
      tagId = inserted.id;
    } catch {
      // Tag creation failed (race condition?), try fetching again
      const retryTag = await drz
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.name, name.trim()), eq(tags.type, 'character')))
        .get();
      tagId = retryTag?.id ?? null;
    }
  }

  const inserted = await drz.insert(characters).values({
    name: name.trim(),
    fandom: fandomVal || null,
    groupId: group_id || null,
    tagId,
    description: description || null,
    shortDesc: short_desc || null,
    avatarKey: avatar_key || null,
    aliases: aliasesStr,
    createdBy: pseudId,
    updatedBy: pseudId,
  }).returning().get();

  return new Response(JSON.stringify(inserted), { status: 201, headers: { 'Content-Type': 'application/json' } });
};