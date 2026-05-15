import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, validateQuery, createLoreEntrySchema, browseLoreSchema } from '@/v2/lib/validation';
import { loreEntries, pseuds } from '@/v2/lib/schema/index';
import { eq, and, desc, count, sql } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/canon/lore — Browse lore entries (paginated) ────────

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const query = validateQuery(url, browseLoreSchema);
  const { page, limit, category } = query;
  const offset = (page - 1) * limit;

  // Build where conditions
  let whereConditions;
  if (category) {
    whereConditions = eq(loreEntries.category, category);
  }

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(loreEntries)
    .where(whereConditions);

  // Fetch entries with pseud name
  const entries = await db
    .select({
      id: loreEntries.id,
      title: loreEntries.title,
      content: loreEntries.content,
      category: loreEntries.category,
      workId: loreEntries.workId,
      pseudId: loreEntries.pseudId,
      createdAt: loreEntries.createdAt,
      updatedAt: loreEntries.updatedAt,
      pseudName: pseuds.name,
    })
    .from(loreEntries)
    .innerJoin(pseuds, eq(loreEntries.pseudId, pseuds.id))
    .where(whereConditions)
    .orderBy(desc(loreEntries.createdAt))
    .limit(limit)
    .offset(offset);

  return new Response(JSON.stringify({ data: entries, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/canon/lore — Create a lore entry ────────────────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, createLoreEntrySchema);
  if (error) return error;

  // Verify the pseud belongs to this user
  const pseud = await db
    .select()
    .from(pseuds)
    .where(and(eq(pseuds.id, data.pseudId), eq(pseuds.userId, auth.user.id)))
    .get();

  if (!pseud) {
    return new Response(JSON.stringify({ error: 'Pseud not found or does not belong to you' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create lore entry
  const [inserted] = await db
    .insert(loreEntries)
    .values({
      title: data.title,
      content: data.content,
      category: data.category,
      workId: data.workId ?? null,
      pseudId: data.pseudId,
    })
    .returning();

  return new Response(JSON.stringify({ data: inserted }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};