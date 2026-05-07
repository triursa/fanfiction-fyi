export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import { UserRole, hasRoleLevel } from '@/lib/types';
import { eq, and, sql, asc } from 'drizzle-orm';
import { locations, locationEdits, entityReferences, tags } from '@/lib/schema';

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
  db: ReturnType<typeof getDrizzle>,
  baseSlug: string,
  excludeId?: number,
): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const conditions = [eq(locations.slug, slug)];
    if (excludeId) {
      conditions.push(sql`${locations.id} != ${excludeId}`);
    }
    const existing = await db.select({ id: locations.id })
      .from(locations)
      .where(and(...conditions))
      .get();
    if (!existing) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

// GET /api/canon/locations/[id] — Single location
export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const id = Number(params.id);
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Invalid location ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    // Use raw SQL for the self-join + tag join
    const locRow = await d1.prepare(
      `SELECT l.*, p.name as parent_name, t.name as fandom_name
       FROM locations l
       LEFT JOIN locations p ON l.parent_location_id = p.id
       LEFT JOIN tags t ON l.fandom_tag_id = t.id
       WHERE l.id = ?1`
    ).bind(id).first<any>();

    if (!locRow) {
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Children locations
    const children = await db.select({
      id: locations.id,
      name: locations.name,
      slug: locations.slug,
    })
      .from(locations)
      .where(eq(locations.parentLocationId, id))
      .orderBy(asc(locations.name));

    // Works referencing this location
    const { results: works } = await d1.prepare(
      `SELECT w.id, w.title, w.summary, w.word_count, w.published_at
       FROM entity_references er
       JOIN works w ON er.work_id = w.id
       WHERE er.entity_type = 'location' AND er.entity_id = ?1
       ORDER BY w.updated_at DESC`
    ).bind(id).all<any>();

    locRow.children = children;
    locRow.works_referencing = works;

    return new Response(
      JSON.stringify(locRow),
      { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } },
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
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const cors = corsHeaders(request);
  const auth = await requireAuth(d1, request);
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
    const existing = await db.select().from(locations).where(eq(locations.id, id)).get();
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Permission: creator or admin/mod
    const isCreator =
      existing.createdBy &&
      auth.pseuds.some((p) => p.id === existing.createdBy);
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
    const updateValues: Record<string, any> = {};
    const changedFields: { field: string; oldValue: string | null; newValue: string | null }[] = [];

    if (body.name !== undefined && body.name !== existing.name) {
      const newSlug = await ensureUniqueSlug(db, slugify(body.name), id);
      changedFields.push({ field: 'name', oldValue: existing.name, newValue: body.name });
      updateValues.name = body.name;
      updateValues.slug = newSlug;
    }

    if (body.description_md !== undefined && body.description_md !== existing.descriptionMd) {
      const descHtml = markdownToHtml(body.description_md);
      changedFields.push({ field: 'description_md', oldValue: existing.descriptionMd, newValue: body.description_md });
      changedFields.push({ field: 'description_html', oldValue: existing.descriptionHtml, newValue: descHtml });
      updateValues.descriptionMd = body.description_md;
      updateValues.descriptionHtml = descHtml;
    }

    if (body.fandom_tag_id !== undefined) {
      const newVal = body.fandom_tag_id ? Number(body.fandom_tag_id) : null;
      const oldVal = existing.fandomTagId;
      if (newVal !== oldVal) {
        changedFields.push({
          field: 'fandom_tag_id',
          oldValue: String(oldVal ?? ''),
          newValue: String(newVal ?? ''),
        });
        updateValues.fandomTagId = newVal;
      }
    }

    if (body.parent_location_id !== undefined) {
      const newVal = body.parent_location_id ? Number(body.parent_location_id) : null;
      const oldVal = existing.parentLocationId;
      if (newVal !== oldVal) {
        changedFields.push({
          field: 'parent_location_id',
          oldValue: String(oldVal ?? ''),
          newValue: String(newVal ?? ''),
        });
        updateValues.parentLocationId = newVal;
      }
    }

    if (Object.keys(updateValues).length === 0) {
      return new Response(
        JSON.stringify({ error: 'No fields to update' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    updateValues.updatedBy = pseudId;
    updateValues.updatedAt = sql`CURRENT_TIMESTAMP`;

    await db.update(locations).set(updateValues).where(eq(locations.id, id));

    // Create location_edits for each changed field
    for (const change of changedFields) {
      await db.insert(locationEdits).values({
        locationId: id,
        pseudId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
    }

    // Use raw SQL for the self-join + tag join response
    const updated = await d1.prepare(
      `SELECT l.*, p.name as parent_name, t.name as fandom_name
       FROM locations l
       LEFT JOIN locations p ON l.parent_location_id = p.id
       LEFT JOIN tags t ON l.fandom_tag_id = t.id
       WHERE l.id = ?1`
    ).bind(id).first<any>();

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
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const cors = corsHeaders(request);
  const auth = await requireAuth(d1, request);
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
    const existing = await db.select().from(locations).where(eq(locations.id, id)).get();
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Location not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // location_edits and entity_references cascade on delete
    await db.delete(locations).where(eq(locations.id, id));
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