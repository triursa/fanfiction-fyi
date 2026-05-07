export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import { eq, asc } from 'drizzle-orm';
import { loreEntries, locations as locationTable, tags } from '@/lib/schema';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

/**
 * GET /api/canon/lookup?type=lore|location&id=N
 * 
 * Returns a single canon entry (lore or location) with its rendered HTML body.
 * Used by the reading-mode canon deep-dive popover/sheet.
 */
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  const type = url.searchParams.get('type') || '';
  const id = Number(url.searchParams.get('id'));

  if (!id || !Number.isFinite(id)) {
    return new Response(
      JSON.stringify({ error: 'Invalid or missing id parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  if (type !== 'lore' && type !== 'location') {
    return new Response(
      JSON.stringify({ error: 'type must be "lore" or "location"' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    if (type === 'lore') {
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

      // Render body_md → HTML if not already rendered
      const body_html = entry.lore_entries.bodyHtml || (entry.lore_entries.bodyMd ? markdownToHtml(entry.lore_entries.bodyMd) : '');

      // Works referencing this lore entry (limited to 5 for sheet preview)
      const { results: works } = await d1.prepare(
        `SELECT w.id, w.title FROM entity_references er
         JOIN works w ON er.work_id = w.id
         WHERE er.entity_type = 'lore' AND er.entity_id = ?1
         ORDER BY w.updated_at DESC LIMIT 5`
      ).bind(id).all<any>();

      return new Response(
        JSON.stringify({
          type: 'lore',
          id: entry.lore_entries.id,
          title: entry.lore_entries.title,
          slug: entry.lore_entries.slug,
          category: entry.lore_entries.category,
          body_html,
          fandom_name: entry.tags?.name ?? null,
          works: works || [],
        }),
        { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } },
      );
    } else {
      // location — use raw SQL for self-join + tag join
      const loc = await d1.prepare(
        `SELECT l.*, t.name as fandom_name,
                p.name as parent_name, p.slug as parent_slug
         FROM locations l
         LEFT JOIN tags t ON l.fandom_tag_id = t.id
         LEFT JOIN locations p ON l.parent_location_id = p.id
         WHERE l.id = ?1`
      ).bind(id).first<any>();

      if (!loc) {
        return new Response(
          JSON.stringify({ error: 'Location not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
        );
      }

      const body_html = loc.description_html || (loc.description_md ? markdownToHtml(loc.description_md) : '');

      // Child locations
      const children = await db.select({
        id: locationTable.id,
        name: locationTable.name,
        slug: locationTable.slug,
      })
        .from(locationTable)
        .where(eq(locationTable.parentLocationId, id))
        .orderBy(asc(locationTable.name));

      // Works referencing this location (limited to 5)
      const { results: works } = await d1.prepare(
        `SELECT w.id, w.title FROM entity_references er
         JOIN works w ON er.work_id = w.id
         WHERE er.entity_type = 'location' AND er.entity_id = ?1
         ORDER BY w.updated_at DESC LIMIT 5`
      ).bind(id).all<any>();

      // Build breadcrumb path
      const breadcrumb: { id: number; name: string; slug: string }[] = [];
      if (loc.parent_name) {
        breadcrumb.push({ id: loc.parent_location_id, name: loc.parent_name, slug: loc.parent_slug });
      }

      return new Response(
        JSON.stringify({
          type: 'location',
          id: loc.id,
          title: loc.name,
          slug: loc.slug,
          body_html,
          fandom_name: loc.fandom_name,
          breadcrumb,
          children: children || [],
          works: works || [],
        }),
        { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } },
      );
    }
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};