import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../lib/db';
import { requireAuth, checkApproved } from '../../../lib/auth';
import { validateBody, validateQuery, createTagSchema, tagBrowseSchema } from '../../../lib/validation';
import { tags } from '../../../lib/schema/index';
import { eq, and, like, count, sql } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/tags — List/browse tags ──────────────────────────────

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Parse and validate query params
  const query = validateQuery(url, tagBrowseSchema);

  // Build conditions
  const conditions = [];
  if (query.type) {
    conditions.push(eq(tags.type, query.type));
  }
  if (query.q) {
    conditions.push(like(tags.name, `${query.q}%`));
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
    .orderBy(tags.name)
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);

  return new Response(JSON.stringify({
    data: tagRows,
    total,
    page: query.page,
    limit: query.limit,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/tags — Create a tag ─────────────────────────────────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

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