/**
 * Admin Tags API
 * GET  /api/admin/tags — list tags (pagination, type/search filters)
 * POST /api/admin/tags — create a new tag
 * Auth: required, founder/admin only
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth } from '@/v2/lib/auth';
import { getDb } from '@/v2/lib/db';
import { tags } from '@/v2/lib/schema/index';
import { validateBody, createTagSchema } from '@/v2/lib/validation';
import { eq, and, like, count, sql, desc } from 'drizzle-orm';

// ─── Admin role check ──────────────────────────────────────────────
function requireAdmin(user: { role: string }): void {
  if (!['founder', 'admin'].includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

const TAG_TYPES = ['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'] as const;

// ─── GET /api/admin/tags ────────────────────────────────────────────
export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireAdmin(auth.user);

  const db = getDb(d1);

  // Query params
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const offset = (page - 1) * limit;
  const typeFilter = url.searchParams.get('type') || '';
  const search = url.searchParams.get('search') || '';

  // Build conditions
  const conditions = [];
  if (typeFilter && TAG_TYPES.includes(typeFilter as any)) {
    conditions.push(eq(tags.type, typeFilter));
  }
  if (search) {
    conditions.push(like(tags.name, `%${search}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(tags)
    .where(whereClause);

  // Fetch tags
  const tagRows = await db
    .select()
    .from(tags)
    .where(whereClause)
    .orderBy(desc(tags.createdAt))
    .limit(limit)
    .offset(offset);

  return new Response(JSON.stringify({ data: tagRows, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/admin/tags ───────────────────────────────────────────
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireAdmin(auth.user);

  const db = getDb(d1);

  // Validate body
  const [data, error] = await validateBody(request, createTagSchema);
  if (error) return error;

  // Check for uniqueness (tags have a unique name constraint)
  const existing = await db
    .select()
    .from(tags)
    .where(eq(tags.name, data.name))
    .get();

  if (existing) {
    // If the tag already exists with the same type, return it
    if (existing.type === data.type) {
      return new Response(JSON.stringify({ data: existing }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Name taken by a different tag type
    return new Response(JSON.stringify({
      error: `Tag name "${data.name}" already exists as a ${existing.type} tag`,
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create the tag
  const [newTag] = await db
    .insert(tags)
    .values({
      name: data.name,
      type: data.type,
      description: data.description ?? null,
      canonical: data.canonical ? 1 : 0,
    })
    .returning();

  return new Response(JSON.stringify({ data: newTag }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};