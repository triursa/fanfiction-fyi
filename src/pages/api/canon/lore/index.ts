export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import type { LoreCategory } from '@/lib/types';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

const VALID_CATEGORIES: LoreCategory[] = [
  'general', 'magic', 'history', 'organization', 'concept',
  'item', 'event', 'culture', 'species',
];

function sanitizeFts(q: string): string {
  return q
    .replace(/["()*+^:-]/g, '')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')
    .trim();
}

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

// GET /api/canon/lore — Browse/search lore entries
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;

  const rawQ = url.searchParams.get('q')?.trim() || '';
  const fandomTagId = url.searchParams.get('fandom_tag_id') || '';
  const category = url.searchParams.get('category') || '';
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
      fromClause = `lore_entries_fts f JOIN lore_entries le ON f.rowid = le.id`;
      conditions.push(`lore_entries_fts MATCH ?${idx++}`);
      bindings.push(sanitizedQ);
    } else {
      fromClause = `lore_entries le`;
    }

    if (fandomTagId) {
      conditions.push(`le.fandom_tag_id = ?${idx++}`);
      bindings.push(Number(fandomTagId));
    }

    if (category && VALID_CATEGORIES.includes(category as LoreCategory)) {
      conditions.push(`le.category = ?${idx++}`);
      bindings.push(category);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countSql = `SELECT COUNT(*) as total FROM ${fromClause} ${whereClause}`;
    const countRow = await queryFirst<{ total: number }>(db, countSql, ...bindings);
    const total = countRow?.total ?? 0;

    // Data
    const dataSql = `
      SELECT le.*, t.name as fandom_name
      FROM ${fromClause}
      LEFT JOIN tags t ON le.fandom_tag_id = t.id
      ${whereClause}
      ORDER BY le.updated_at DESC
      LIMIT ?${idx++} OFFSET ?${idx++}
    `;
    const dataBindings = [...bindings, limit, offset];

    const entries = await queryAll<any>(db, dataSql, ...dataBindings);

    return new Response(
      JSON.stringify({ entries, total, page, limit }),
      { headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};

// POST /api/canon/lore — Create lore entry
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

  const { title, body_md, category, fandom_tag_id } = body || {};
  if (!title) {
    return new Response(
      JSON.stringify({ error: 'title is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
  if (!body_md) {
    return new Response(
      JSON.stringify({ error: 'body_md is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const entryCategory: LoreCategory =
    category && VALID_CATEGORIES.includes(category) ? category : 'general';
  const bodyHtml = markdownToHtml(body_md);
  const baseSlug = slugify(title);
  const pseudId = auth.pseuds[0]?.id ?? null;

  try {
    const slug = await ensureUniqueSlug(db, baseSlug);

    const result = await run(
      db,
      `INSERT INTO lore_entries (title, slug, body_md, body_html, category, fandom_tag_id, created_by, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      title, slug, body_md, bodyHtml, entryCategory,
      fandom_tag_id ? Number(fandom_tag_id) : null,
      pseudId, pseudId,
    );

    const entry = await queryFirst<any>(
      db,
      `SELECT le.*, t.name as fandom_name
       FROM lore_entries le
       LEFT JOIN tags t ON le.fandom_tag_id = t.id
       WHERE le.id = ?1`,
      result.meta.last_row_id,
    );

    return new Response(
      JSON.stringify(entry),
      { status: 201, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};
