import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../lib/db';
import { requireAuth, checkApproved } from '../../../../lib/auth';
import { validateBody, validateQuery, createPseudSchema, paginationSchema } from '../../../../lib/validation';
import { pseuds } from '../../../../lib/schema/index';
import { eq, like, or, asc, count } from 'drizzle-orm';

export const config = { auth: 'public' as const };

// GET /api/pseuds — List pseuds (with optional search)
export const GET: APIRoute = async ({ url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const params = validateQuery(url, paginationSchema.extend({ q: z.string().optional() }));
  const offset = (params.page - 1) * params.limit;

  let query = db.select().from(pseuds).orderBy(asc(pseuds.name)).limit(params.limit).offset(offset);
  
  if (params.q) {
    query = db.select().from(pseuds).where(like(pseuds.name, `%${params.q}%`)).orderBy(asc(pseuds.name)).limit(params.limit).offset(offset);
  }

  const pseudList = await query;
  const [{ value: total }] = await db.select({ value: count() }).from(pseuds);

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
