export const prerender = false;

import { queryAll, queryFirst } from '@/lib/db';
import { corsHeaders, handleCors } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';

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
  const db = locals.runtime.env.DB as D1Database;

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

      // Render body_md → HTML if not already rendered
      const body_html = entry.body_html || (entry.body_md ? markdownToHtml(entry.body_md) : '');

      // Works referencing this lore entry (limited to 5 for sheet preview)
      const works = await queryAll<any>(
        db,
        `SELECT w.id, w.title FROM entity_references er
         JOIN works w ON er.work_id = w.id
         WHERE er.entity_type = 'lore' AND er.entity_id = ?1
         ORDER BY w.updated_at DESC LIMIT 5`,
        id,
      );

      return new Response(
        JSON.stringify({
          type: 'lore',
          id: entry.id,
          title: entry.title,
          slug: entry.slug,
          category: entry.category,
          body_html,
          fandom_name: entry.fandom_name,
          works: works || [],
        }),
        { headers: { 'Content-Type': 'application/json', ...cors } },
      );
    } else {
      // location
      const loc = await queryFirst<any>(
        db,
        `SELECT l.*, t.name as fandom_name,
                p.name as parent_name, p.slug as parent_slug
         FROM locations l
         LEFT JOIN tags t ON l.fandom_tag_id = t.id
         LEFT JOIN locations p ON l.parent_location_id = p.id
         WHERE l.id = ?1`,
        id,
      );

      if (!loc) {
        return new Response(
          JSON.stringify({ error: 'Location not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
        );
      }

      const body_html = loc.description_html || (loc.description_md ? markdownToHtml(loc.description_md) : '');

      // Child locations
      const children = await queryAll<any>(
        db,
        `SELECT id, name, slug FROM locations WHERE parent_location_id = ?1 ORDER BY name`,
        id,
      );

      // Works referencing this location (limited to 5)
      const works = await queryAll<any>(
        db,
        `SELECT w.id, w.title FROM entity_references er
         JOIN works w ON er.work_id = w.id
         WHERE er.entity_type = 'location' AND er.entity_id = ?1
         ORDER BY w.updated_at DESC LIMIT 5`,
        id,
      );

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
        { headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};