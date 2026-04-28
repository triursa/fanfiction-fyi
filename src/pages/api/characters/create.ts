export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

// POST /api/characters — Create a new character
export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, fandom, group_id, description, short_desc, avatar_key, aliases } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudId = auth.pseuds[0]?.id ?? null;
  const aliasesStr = Array.isArray(aliases) ? JSON.stringify(aliases) : (typeof aliases === 'string' ? aliases : null);

  // Auto-create a matching character tag if one doesn't exist
  let tagId: number | null = null;
  const existingTag = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM tags WHERE name = ?1 AND type = 'character'`,
    name.trim()
  );
  if (existingTag) {
    tagId = existingTag.id;
  } else {
    try {
      const tagResult = await run(db, `INSERT INTO tags (name, type) VALUES (?1, 'character')`, name.trim());
      tagId = tagResult.meta.last_row_id as number;
    } catch {
      // Tag creation failed (race condition?), try fetching again
      const retryTag = await queryFirst<{ id: number }>(
        db,
        `SELECT id FROM tags WHERE name = ?1 AND type = 'character'`,
        name.trim()
      );
      tagId = retryTag?.id ?? null;
    }
  }

  const result = await run(
    db,
    `INSERT INTO characters (name, fandom, group_id, tag_id, description, short_desc, avatar_key, aliases, created_by, updated_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    name.trim(),
    fandom || null,
    group_id || null,
    tagId,
    description || null,
    short_desc || null,
    avatar_key || null,
    aliasesStr,
    pseudId
  );

  const character = await queryFirst<any>(db, `SELECT * FROM characters WHERE id = ?1`, result.meta.last_row_id);
  return new Response(JSON.stringify(character), { status: 201, headers: { 'Content-Type': 'application/json' } });
};