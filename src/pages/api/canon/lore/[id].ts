export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import type { LoreCategory } from '@/lib/types';
import { UserRole, hasRoleLevel } from '@/lib/types';
import { eq, and, sql } from 'drizzle-orm';
import { loreEntries, loreEdits, entityReferences, tags } from '@/lib/schema';

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
  db: ReturnType<typeof getDrizzle>,
  baseSlug: string,
  excludeId?: number,
): Promise<string> {
  let slug = baseSlug;
  let suffix = 2;
  while (true) {
    const conditions = [eq(loreEntries.slug, slug)];
    if (excludeId) {
      conditions.push(sql`${loreEntries.id} != ${excludeId}`);
    }
    const existing = await db.select({ id: loreEntries.id })
      .from(loreEntries)
      .where(and(...conditions))
      .get();
    if (!existing) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

// GET /api/canon/lore/[id] — Single lore entry
export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const id = Number(params.id);
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Invalid lore ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const entry = await db.select()
      .from(loreEntries)
      .leftJoin(tags, eq(loreEntries.fandomTagId, tags.id))
      .where(eq(loreEntries.id, id))
      .get();

    if (!entry) {
      return new Response(
        JSON.stringify({ error: 'Lore entry not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Works referencing this lore entry — JOIN query, use raw SQL
    const { results: works } = await d1.prepare(
      `SELECT w.id, w.title, w.summary, w.word_count, w.published_at
       FROM entity_references er
       JOIN works w ON er.work_id = w.id
       WHERE er.entity_type = 'lore' AND er.entity_id = ?1
       ORDER BY w.updated_at DESC`
    ).bind(id).all<any>();

    const result = {
      ...entry.lore_entries,
      fandom_name: entry.tags?.name ?? null,
      works_referencing: works,
    };

    return new Response(
      JSON.stringify(result),
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
      JSON.stringify({ error: 'Invalid lore ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const existing = await db.select().from(loreEntries).where(eq(loreEntries.id, id)).get();
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Lore entry not found' }),
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

    if (body.title !== undefined && body.title !== existing.title) {
      const newSlug = await ensureUniqueSlug(db, slugify(body.title), id);
      changedFields.push({ field: 'title', oldValue: existing.title, newValue: body.title });
      updateValues.title = body.title;
      updateValues.slug = newSlug;
    }

    if (body.body_md !== undefined && body.body_md !== existing.bodyMd) {
      const bodyHtml = markdownToHtml(body.body_md);
      changedFields.push({ field: 'body_md', oldValue: existing.bodyMd, newValue: body.body_md });
      changedFields.push({ field: 'body_html', oldValue: existing.bodyHtml, newValue: bodyHtml });
      updateValues.bodyMd = body.body_md;
      updateValues.bodyHtml = bodyHtml;
    }

    if (
      body.category !== undefined &&
      body.category !== existing.category &&
      VALID_CATEGORIES.includes(body.category)
    ) {
      changedFields.push({ field: 'category', oldValue: existing.category, newValue: body.category });
      updateValues.category = body.category;
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

    if (Object.keys(updateValues).length === 0) {
      return new Response(
        JSON.stringify({ error: 'No fields to update' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    updateValues.updatedBy = pseudId;
    updateValues.updatedAt = sql`CURRENT_TIMESTAMP`;

    await db.update(loreEntries).set(updateValues).where(eq(loreEntries.id, id));

    // Create lore_edits for each changed field
    for (const change of changedFields) {
      await db.insert(loreEdits).values({
        loreEntryId: id,
        pseudId,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
      });
    }

    const updated = await db.select()
      .from(loreEntries)
      .leftJoin(tags, eq(loreEntries.fandomTagId, tags.id))
      .where(eq(loreEntries.id, id))
      .get();

    const result = {
      ...updated!.lore_entries,
      fandom_name: updated!.tags?.name ?? null,
    };

    return new Response(
      JSON.stringify(result),
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
      JSON.stringify({ error: 'Invalid lore ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const existing = await db.select().from(loreEntries).where(eq(loreEntries.id, id)).get();
    if (!existing) {
      return new Response(
        JSON.stringify({ error: 'Lore entry not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // lore_edits and entity_references cascade on delete
    await db.delete(loreEntries).where(eq(loreEntries.id, id));
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