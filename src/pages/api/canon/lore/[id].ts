export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import type { LoreCategory } from '@/lib/types';
import { UserRole, hasRoleLevel } from '@/lib/types';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

const VALID_CATEGORIES: LoreCategory[] = [
  'general', 'magic', 'history', 'organization', 'concept',
  'item', 'event', 'culture', 'species',
];

function slugify(title: string): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  if (!slug) slug = `entry-${Date.now()}`;
  return slug;
}

async function ensureUniqueSlug(
  db: D1Database,
  baseSlug: string,
  excludeId?: number,
): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    let sql = `SELECT id FROM lore_entries WHERE slug = ?1`;
    const params: unknown[] = [slug];
    if (excludeId) {
      sql += ` AND id != ?2`;
      params.push(excludeId);
    }
    const existing = await queryFirst<{ id: number }>(db, sql, ...params);
    if (!existing) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

// GET /api/canon/lore/[id] — Single lore entry
export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const id = Number(params.id);
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Invalid lore ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const entry = await queryFirst<any>(
      db,
      `SELECT le.*, t.name as fandom_name
       FROM lore_entries le
       LEFT JOIN tags t ON le.fandom_tag_id = t.id
       WHERE le.id = ?1`,
      id,
    );
    if (!entry) {
      return new Response(
        JSON.stringify({ error: 'Lore entry not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Works referencing this lore entry
    const works = await queryAll<any>(
      db,
      `SELECT w.id, w.title, w.summary, w.word_count, w.published_at
       FROM entity_references er
       JOIN works w ON er.work_id = w.id
       WHERE er.entity_type = 'lore' AND er.entity_id = ?1
       ORDER BY w.updated_at DESC`,
      id,
    );
    entry.works_referencing = works;

    return new Response(
      JSON.stringify(entry),
      { headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};

// PUT /api/canon/lore/[id] — Update lore entry
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const cors = corsHeaders(request);
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const id = Number(params.id);
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Invalid lore ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const existing = await queryFirst<any>(
      db,
      `SELECT * FROM lore_entries WHERE id = ?1`,
      id,
    );
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Lore entry not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Permission: creator or admin/mod
    const isCreator =
      existing.created_by &&
      auth.pseuds.some((p) => p.id === existing.created_by);
    const isPrivileged = hasRoleLevel(auth.user.role as UserRole, UserRole.Mod);
    if (!isCreator && !isPrivileged) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    const pseudId = auth.pseuds[0]?.id ?? null;
    const updates: string[] = [];
    const bindings: unknown[] = [];
    let idx = 1;
    const changedFields: { field: string; oldValue: string | null; newValue: string | null }[] = [];

    if (body.title !== undefined && body.title !== existing.title) {
      const newSlug = await ensureUniqueSlug(db, slugify(body.title), id);
      changedFields.push({ field: 'title', oldValue: existing.title, newValue: body.title });
      updates.push(`title = ?${idx++}`);
      bindings.push(body.title);
      updates.push(`slug = ?${idx++}`);
      bindings.push(newSlug);
    }

    if (body.body_md !== undefined && body.body_md !== existing.body_md) {
      const bodyHtml = markdownToHtml(body.body_md);
      changedFields.push({ field: 'body_md', oldValue: existing.body_md, newValue: body.body_md });
      changedFields.push({ field: 'body_html', oldValue: existing.body_html, newValue: bodyHtml });
      updates.push(`body_md = ?${idx++}`);
      bindings.push(body.body_md);
      updates.push(`body_html = ?${idx++}`);
      bindings.push(bodyHtml);
    }

    if (
      body.category !== undefined &&
      body.category !== existing.category &&
      VALID_CATEGORIES.includes(body.category)
    ) {
      changedFields.push({ field: 'category', oldValue: existing.category, newValue: body.category });
      updates.push(`category = ?${idx++}`);
      bindings.push(body.category);
    }

    if (body.fandom_tag_id !== undefined) {
      const newVal = body.fandom_tag_id ? Number(body.fandom_tag_id) : null;
      const oldVal = existing.fandom_tag_id;
      if (newVal !== oldVal) {
        changedFields.push({
          field: 'fandom_tag_id',
          oldValue: String(oldVal ?? ''),
          newValue: String(newVal ?? ''),
        });
        updates.push(`fandom_tag_id = ?${idx++}`);
        bindings.push(newVal);
      }
    }

    if (updates.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No fields to update' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    updates.push(`updated_by = ?${idx++}`);
    bindings.push(pseudId);
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    bindings.push(id);
    const sql = `UPDATE lore_entries SET ${updates.join(', ')} WHERE id = ?${idx}`;
    await run(db, sql, ...bindings);

    // Create lore_edits for each changed field
    for (const change of changedFields) {
      await run(
        db,
        `INSERT INTO lore_edits (lore_entry_id, pseud_id, field, old_value, new_value)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
        id, pseudId, change.field, change.oldValue, change.newValue,
      );
    }

    const updated = await queryFirst<any>(
      db,
      `SELECT le.*, t.name as fandom_name
       FROM lore_entries le
       LEFT JOIN tags t ON le.fandom_tag_id = t.id
       WHERE le.id = ?1`,
      id,
    );

    return new Response(
      JSON.stringify(updated),
      { headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};

// DELETE /api/canon/lore/[id] — Delete lore entry (admin/mod only)
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const cors = corsHeaders(request);
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const isPrivileged = hasRoleLevel(auth.user.role as UserRole, UserRole.Mod);
  if (!isPrivileged) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: admin/mod role required' }),
      { status: 403, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const id = Number(params.id);
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Invalid lore ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const existing = await queryFirst<any>(
      db,
      `SELECT * FROM lore_entries WHERE id = ?1`,
      id,
    );
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Lore entry not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // lore_edits and entity_references cascade on delete
    await run(db, `DELETE FROM lore_entries WHERE id = ?1`, id);
    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};
