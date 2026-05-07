export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import type { LoreCategory } from '@/lib/types';
import { eq, and, sql } from 'drizzle-orm';
import { loreEntries, tags } from '@/lib/schema';

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

// GET /api/canon/lore — Browse/search lore entries
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  const rawQ = url.searchParams.get('q')?.trim() || '';
  const fandomTagId = url.searchParams.get('fandom_tag_id') || '';
  const category = url.searchParams.get('category') || '';
  const page = Math.max(Number(url.searchParams.get('page') || 1), 1);
  const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);
  const offset = (page - 1) * limit;

  try {
    const sanitizedQ = rawQ ? sanitizeFts(rawQ) : '';

    // Build the query using raw SQL for FTS5 + JOINs
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

    // Count — use raw D1 for FTS5 queries
    const countRow = await d1.prepare(`SELECT COUNT(*) as total FROM ${fromClause} ${whereClause}`).bind(...bindings).first<{ total: number }>();
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

    const { results: entries } = await d1.prepare(dataSql).bind(...dataBindings).all<any>();

    return new Response(
      JSON.stringify({ entries, total, page, limit }),
      { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } },
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

    await db.insert(loreEntries).values({
      title,
      slug,
      bodyMd: body_md,
      bodyHtml,
      category: entryCategory,
      fandomTagId: fandom_tag_id ? Number(fandom_tag_id) : null,
      createdBy: pseudId,
      updatedBy: pseudId,
    });

    // Get the last inserted ID
    const entry = await db.select()
      .from(loreEntries)
      .leftJoin(tags, eq(loreEntries.fandomTagId, tags.id))
      .where(eq(loreEntries.slug, slug))
      .get();

    if (!entry) {
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve created entry' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Format to match old API shape (snake_case + fandom_name)
    const result = {
      ...entry.lore_entries,
      fandom_name: entry.tags?.name ?? null,
    };

    return new Response(
      JSON.stringify(result),
      { status: 201, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};