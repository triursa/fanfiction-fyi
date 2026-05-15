export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import { eq, and, sql } from 'drizzle-orm';
import { locations } from '@/lib/schema';

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

// GET /api/canon/locations — Browse/search locations
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;

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
    const countRow = await d1.prepare(`SELECT COUNT(*) as total FROM ${fromClause} ${whereClause}`).bind(...bindings).first<{ total: number }>();
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

    const { results: locs } = await d1.prepare(dataSql).bind(...dataBindings).all<any>();

    return new Response(
      JSON.stringify({ locations: locs, total, page, limit }),
      { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } },
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

    await db.insert(locations).values({
      name,
      slug,
      descriptionMd: description_md ?? null,
      descriptionHtml,
      fandomTagId: fandom_tag_id ? Number(fandom_tag_id) : null,
      parentLocationId: parent_location_id ? Number(parent_location_id) : null,
      createdBy: pseudId,
      updatedBy: pseudId,
    });

    // Retrieve the created location using raw D1 for self-join
    const { results: [created] } = await d1.prepare(
      `SELECT l.*, p.name as parent_name, t.name as fandom_name
       FROM locations l
       LEFT JOIN locations p ON l.parent_location_id = p.id
       LEFT JOIN tags t ON l.fandom_tag_id = t.id
       WHERE l.slug = ?1`
    ).bind(slug).all<any>();

    return new Response(
      JSON.stringify(created),
      { status: 201, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};