import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, validateQuery, createPseudSchema, paginationSchema } from '@/v2/lib/validation';
import { pseuds } from '@/v2/lib/schema/index';
import { eq, like, and, asc, count } from 'drizzle-orm';
import { z } from 'zod';

export const config = { auth: 'public' as const };

// GET /api/pseuds — List pseuds (with optional search and user filter)
export const GET: APIRoute = async ({ url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const params = validateQuery(url, paginationSchema.extend({
    q: z.string().optional(),
    userId: z.coerce.number().int().positive().optional(),
  }));

  const offset = (params.page - 1) * params.limit;

  const conditions = [];
  if (params.userId) {
    conditions.push(eq(pseuds.userId, params.userId));
  }
  if (params.q) {
    conditions.push(like(pseuds.name, `%${params.q}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [pseudList, [{ value: total }]] = await Promise.all([
    db.select().from(pseuds).where(whereClause).orderBy(asc(pseuds.name)).limit(params.limit).offset(offset),
    db.select({ value: count() }).from(pseuds).where(whereClause),
  ]);

  return new Response(JSON.stringify({ data: pseudList, total, page: params.page, limit: params.limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/pseuds — Create a new pseud
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const [data, error] = await validateBody(request, createPseudSchema);
  if (error) return error;

  // Check for duplicate name
  const existing = await db.select().from(pseuds).where(eq(pseuds.name, data.name)).get();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Pseud name already taken' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const newPseud = await db.insert(pseuds).values({
    userId: auth.user.id,
    name: data.name,
    description: data.description ?? null,
    themeColor: data.themeColor ?? null,
    isDefault: 0,
  }).returning();

  return new Response(JSON.stringify({ data: newPseud[0] }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};