export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import { UserRole, hasRoleLevel } from '@/lib/types';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

function slugify(name: string): string {
  let slug = name
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
    let sql = `SELECT id FROM locations WHERE slug = ?1`;
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

// GET /api/canon/locations/[id] — Single location
export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const id = Number(params.id);
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Invalid location ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const location = await queryFirst<any>(
      db,
      `SELECT l.*, p.name as parent_name, t.name as fandom_name
       FROM locations l
       LEFT JOIN locations p ON l.parent_location_id = p.id
       LEFT JOIN tags t ON l.fandom_tag_id = t.id
       WHERE l.id = ?1`,
      id,
    );
    if (!location) {
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Children locations
    const children = await queryAll<any>(
      db,
      `SELECT id, name, slug FROM locations WHERE parent_location_id = ?1 ORDER BY name ASC`,
      id,
    );
    location.children = children;

    // Works referencing this location
    const works = await queryAll<any>(
      db,
      `SELECT w.id, w.title, w.summary, w.word_count, w.published_at
       FROM entity_references er
       JOIN works w ON er.work_id = w.id
       WHERE er.entity_type = 'location' AND er.entity_id = ?1
       ORDER BY w.updated_at DESC`,
      id,
    );
    location.works_referencing = works;

    return new Response(
      JSON.stringify(location),
      { headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};

// PUT /api/canon/locations/[id] — Update location
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
      JSON.stringify({ error: 'Invalid location ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const existing = await queryFirst<any>(
      db,
      `SELECT * FROM locations WHERE id = ?1`,
      id,
    );
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
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

    if (body.name !== undefined && body.name !== existing.name) {
      const newSlug = await ensureUniqueSlug(db, slugify(body.name), id);
      changedFields.push({ field: 'name', oldValue: existing.name, newValue: body.name });
      updates.push(`name = ?${idx++}`);
      bindings.push(body.name);
      updates.push(`slug = ?${idx++}`);
      bindings.push(newSlug);
    }

    if (body.description_md !== undefined && body.description_md !== existing.description_md) {
      const descHtml = markdownToHtml(body.description_md);
      changedFields.push({ field: 'description_md', oldValue: existing.description_md, newValue: body.description_md });
      changedFields.push({ field: 'description_html', oldValue: existing.description_html, newValue: descHtml });
      updates.push(`description_md = ?${idx++}`);
      bindings.push(body.description_md);
      updates.push(`description_html = ?${idx++}`);
      bindings.push(descHtml);
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

    if (body.parent_location_id !== undefined) {
      const newVal = body.parent_location_id ? Number(body.parent_location_id) : null;
      const oldVal = existing.parent_location_id;
      if (newVal !== oldVal) {
        changedFields.push({
          field: 'parent_location_id',
          oldValue: String(oldVal ?? ''),
          newValue: String(newVal ?? ''),
        });
        updates.push(`parent_location_id = ?${idx++}`);
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
    const sql = `UPDATE locations SET ${updates.join(', ')} WHERE id = ?${idx}`;
    await run(db, sql, ...bindings);

    // Create location_edits for each changed field
    for (const change of changedFields) {
      await run(
        db,
        `INSERT INTO location_edits (location_id, pseud_id, field, old_value, new_value)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
        id, pseudId, change.field, change.oldValue, change.newValue,
      );
    }

    const updated = await queryFirst<any>(
      db,
      `SELECT l.*, p.name as parent_name, t.name as fandom_name
       FROM locations l
       LEFT JOIN locations p ON l.parent_location_id = p.id
       LEFT JOIN tags t ON l.fandom_tag_id = t.id
       WHERE l.id = ?1`,
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

// DELETE /api/canon/locations/[id] — Delete location (admin/mod only)
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
      JSON.stringify({ error: 'Invalid location ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const existing = await queryFirst<any>(
      db,
      `SELECT * FROM locations WHERE id = ?1`,
      id,
    );
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // location_edits and entity_references cascade on delete
    await run(db, `DELETE FROM locations WHERE id = ?1`, id);
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
