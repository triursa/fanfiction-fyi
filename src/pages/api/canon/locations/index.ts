import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, validateQuery, createLocationSchema, browseLocationSchema } from '@/v2/lib/validation';
import { locations, pseuds } from '@/v2/lib/schema/index';
import { eq, desc, count } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/canon/locations — Browse locations ───────────────

export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const query = validateQuery(url, browseLocationSchema);
  const { page, limit, type } = query;
  const offset = (page - 1) * limit;

  // Build where conditions
  let whereConditions;
  if (type) {
    whereConditions = eq(locations.type, type);
  }

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(locations)
    .where(whereConditions);

  // Fetch locations with pseud name
  const locationRows = await db
    .select({
      id: locations.id,
      name: locations.name,
      description: locations.description,
      type: locations.type,
      parentId: locations.parentId,
      pseudId: locations.pseudId,
      createdAt: locations.createdAt,
      updatedAt: locations.updatedAt,
      pseudName: pseuds.name,
    })
    .from(locations)
    .innerJoin(pseuds, eq(locations.pseudId, pseuds.id))
    .where(whereConditions)
    .orderBy(desc(locations.createdAt))
    .limit(limit)
    .offset(offset);

  return new Response(JSON.stringify({ data: locationRows, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/canon/locations — Create a location ────────────

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, createLocationSchema);
  if (error) return error;

  // Verify the pseud belongs to this user
  const pseud = await db
    .select()
    .from(pseuds)
    .where(eq(pseuds.id, data.pseudId))
    .get();

  if (!pseud || pseud.userId !== auth.user.id) {
    return new Response(JSON.stringify({ error: 'Pseud not found or does not belong to you' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate parentId if provided
  if (data.parentId) {
    const parent = await db.select({ id: locations.id }).from(locations).where(eq(locations.id, data.parentId)).get();
    if (!parent) {
      return new Response(JSON.stringify({ error: 'Parent location not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Create location
  const [inserted] = await db
    .insert(locations)
    .values({
      name: data.name,
      description: data.description ?? '',
      type: data.type,
      parentId: data.parentId ?? null,
      pseudId: data.pseudId,
    })
    .returning();

  return new Response(JSON.stringify({ data: inserted }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};