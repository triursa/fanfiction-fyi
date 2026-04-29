export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

function sanitizeFts(q: string): string {
  return q
    .replace(/["()*+^:-]/g, '')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')
    .trim();
}

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

// GET /api/canon/locations — Browse/search locations
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;

  const rawQ = url.searchParams.get('q')?.trim() || '';
  const fandomTagId = url.searchParams.get('fandom_tag_id') || '';
  const parentLocationId = url.searchParams.get('parent_location_id') || '';
  const page = Math.max(Number(url.searchParams.get('page') || 1), 1);
  const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);
  const offset = (page - 1) * limit;

  try {
    const sanitizedQ = rawQ ? sanitizeFts(rawQ) : '';
    let fromClause: string;
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    let idx = 1;

    if (sanitizedQ) {
      fromClause = `locations_fts f JOIN locations l ON f.rowid = l.id`;
      conditions.push(`locations_fts MATCH ?${idx++}`);
      bindings.push(sanitizedQ);
    } else {
      fromClause = `locations l`;
    }

    if (fandomTagId) {
      conditions.push(`l.fandom_tag_id = ?${idx++}`);
      bindings.push(Number(fandomTagId));
    }

    if (parentLocationId) {
      conditions.push(`l.parent_location_id = ?${idx++}`);
      bindings.push(Number(parentLocationId));
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countSql = `SELECT COUNT(*) as total FROM ${fromClause} ${whereClause}`;
    const countRow = await queryFirst<{ total: number }>(db, countSql, ...bindings);
    const total = countRow?.total ?? 0;

    // Data with parent name and fandom name
    const dataSql = `
      SELECT l.*, p.name as parent_name, t.name as fandom_name
      FROM ${fromClause}
      LEFT JOIN locations p ON l.parent_location_id = p.id
      LEFT JOIN tags t ON l.fandom_tag_id = t.id
      ${whereClause}
      ORDER BY l.updated_at DESC
      LIMIT ?${idx++} OFFSET ?${idx++}
    `;
    const dataBindings = [...bindings, limit, offset];

    const locations = await queryAll<any>(db, dataSql, ...dataBindings);

    return new Response(
      JSON.stringify({ locations, total, page, limit }),
      { headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};

// POST /api/canon/locations — Create location
export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const cors = corsHeaders(request);
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...cors } },
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

  const { name, description_md, fandom_tag_id, parent_location_id } = body || {};
  if (!name) {
    return new Response(
      JSON.stringify({ error: 'name is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const descriptionHtml = description_md ? markdownToHtml(description_md) : null;
  const baseSlug = slugify(name);
  const pseudId = auth.pseuds[0]?.id ?? null;

  try {
    const slug = await ensureUniqueSlug(db, baseSlug);

    const result = await run(
      db,
      `INSERT INTO locations (name, slug, description_md, description_html, fandom_tag_id, parent_location_id, created_by, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      name, slug, description_md ?? null, descriptionHtml,
      fandom_tag_id ? Number(fandom_tag_id) : null,
      parent_location_id ? Number(parent_location_id) : null,
      pseudId, pseudId,
    );

    const location = await queryFirst<any>(
      db,
      `SELECT l.*, p.name as parent_name, t.name as fandom_name
       FROM locations l
       LEFT JOIN locations p ON l.parent_location_id = p.id
       LEFT JOIN tags t ON l.fandom_tag_id = t.id
       WHERE l.id = ?1`,
      result.meta.last_row_id,
    );

    return new Response(
      JSON.stringify(location),
      { status: 201, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};
