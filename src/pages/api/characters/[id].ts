export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const id = Number(params.id);
  if (!id) {
    return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  const character = await queryFirst<any>(db, `SELECT * FROM characters WHERE id = ?1`, id);
  if (!character) {
    return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  // Group info
  let group = null;
  if (character.group_id) {
    group = await queryFirst<any>(db, `SELECT * FROM character_groups WHERE id = ?1`, character.group_id);
  }

  // Group siblings (other characters in the same group)
  let groupSiblings: any[] = [];
  if (character.group_id) {
    groupSiblings = await queryAll<any>(
      db,
      `SELECT id, name, fandom FROM characters WHERE group_id = ?1 AND id != ?2`,
      character.group_id, id
    );
  }

  // Appearances
  const appearances = await queryAll<any>(
    db,
    `SELECT ca.*, w.title as work_title, w.id as work_id
     FROM character_appearances ca
     JOIN works w ON ca.work_id = w.id
     WHERE ca.character_id = ?1
     ORDER BY ca.created_at DESC`,
    id
  );

  // Work count
  const workCount = await queryFirst<{ count: number }>(
    db,
    `SELECT COUNT(*) as count FROM character_appearances WHERE character_id = ?1`,
    id
  );

  // Linked tag
  let tag = null;
  if (character.tag_id) {
    tag = await queryFirst<any>(db, `SELECT * FROM tags WHERE id = ?1`, character.tag_id);
  }

  return new Response(JSON.stringify({
    ...character,
    group,
    group_siblings: groupSiblings,
    appearances,
    work_count: workCount?.count ?? 0,
    tag,
  }), {
    headers: { 'Content-Type': 'application/json', ...cors },
  });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const id = Number(params.id);
  if (!id) return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const existing = await queryFirst<any>(db, `SELECT * FROM characters WHERE id = ?1`, id);
  if (!existing) return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Permission: creator or admin/mod
  const isCreator = existing.created_by && auth.pseuds.some(p => p.id === existing.created_by);
  const isPrivileged = ['admin', 'mod', 'founder'].includes(auth.user.role);
  if (!isCreator && !isPrivileged) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const allowedFields = ['name', 'fandom', 'group_id', 'description', 'short_desc', 'avatar_key', 'aliases'];
  const updates: string[] = [];
  const bindings: any[] = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      // Serialize aliases if it's an array
      bindings.push(field === 'aliases' && Array.isArray(body[field]) ? JSON.stringify(body[field]) : body[field]);
    }
  }

  if (updates.length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Always update updated_by and updated_at
  const pseudId = auth.pseuds[0]?.id ?? null;
  updates.push(`updated_by = $${idx++}`);
  bindings.push(pseudId);
  updates.push(`updated_at = CURRENT_TIMESTAMP`);

  bindings.push(id);
  const sql = `UPDATE characters SET ${updates.join(', ')} WHERE id = $${idx}`;
  await run(db, sql, ...bindings);

  const updated = await queryFirst<any>(db, `SELECT * FROM characters WHERE id = ?1`, id);
  return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const isPrivileged = ['admin', 'mod', 'founder'].includes(auth.user.role);
  if (!isPrivileged) {
    return new Response(JSON.stringify({ error: 'Forbidden: admin/mod role required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const id = Number(params.id);
  if (!id) return new Response(JSON.stringify({ error: 'Invalid character ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const existing = await queryFirst<any>(db, `SELECT * FROM characters WHERE id = ?1`, id);
  if (!existing) return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // character_appearances cascade on delete
  await run(db, `DELETE FROM characters WHERE id = ?1`, id);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};