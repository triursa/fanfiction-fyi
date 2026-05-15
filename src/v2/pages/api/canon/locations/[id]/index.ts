import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../lib/db';
import { requireAuth, checkApproved } from '../../../../lib/auth';
import { validateBody, updateLocationSchema } from '../../../../lib/validation';
import { locations, canonReferences, pseuds } from '../../../../lib/schema/index';
import { eq } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/canon/locations/[id] — Single location with references ──

export const GET: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const locationId = Number(params?.id);

  if (!locationId || Number.isNaN(locationId)) {
    return new Response(JSON.stringify({ error: 'Invalid location ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch location with pseud name
  const location = await db
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
    .where(eq(locations.id, locationId))
    .get();

  if (!location) {
    return new Response(JSON.stringify({ error: 'Location not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch canon references linked to this location
  const references = await db
    .select()
    .from(canonReferences)
    .where(eq(canonReferences.locationId, locationId));

  return new Response(JSON.stringify({ data: { ...location, references } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PUT /api/canon/locations/[id] — Update location (owner-only) ──

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const locationId = Number(params?.id);

  if (!locationId || Number.isNaN(locationId)) {
    return new Response(JSON.stringify({ error: 'Invalid location ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify location exists
  const existing = await db.select().from(locations).where(eq(locations.id, locationId)).get();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Location not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(existing.pseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the location owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate body
  const [data, error] = await validateBody(request, updateLocationSchema);
  if (error) return error;

  // Build update object
  const updates: Record<string, any> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.type !== undefined) updates.type = data.type;
  if (data.parentId !== undefined) updates.parentId = data.parentId;

  await db.update(locations).set(updates).where(eq(locations.id, locationId));

  // Fetch updated location
  const updated = await db.select().from(locations).where(eq(locations.id, locationId)).get();

  return new Response(JSON.stringify({ data: updated }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/canon/locations/[id] — Delete location (owner-only)

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const locationId = Number(params?.id);

  if (!locationId || Number.isNaN(locationId)) {
    return new Response(JSON.stringify({ error: 'Invalid location ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify location exists
  const existing = await db.select().from(locations).where(eq(locations.id, locationId)).get();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Location not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(existing.pseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the location owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete (cascade handles canon_references and location_edits)
  await db.delete(locations).where(eq(locations.id, locationId));

  return new Response(JSON.stringify({ data: { id: locationId, deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};