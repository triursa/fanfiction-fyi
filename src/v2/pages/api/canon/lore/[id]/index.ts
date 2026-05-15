import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../lib/db';
import { requireAuth, checkApproved } from '../../../../lib/auth';
import { validateBody, updateLoreEntrySchema } from '../../../../lib/validation';
import { loreEntries, canonReferences, pseuds } from '../../../../lib/schema/index';
import { eq, and } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/canon/lore/[id] — Single lore entry with references ──

export const GET: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const entryId = Number(params?.id);

  if (!entryId || Number.isNaN(entryId)) {
    return new Response(JSON.stringify({ error: 'Invalid lore entry ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch lore entry with pseud name
  const entry = await db
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
    .where(eq(loreEntries.id, entryId))
    .get();

  if (!entry) {
    return new Response(JSON.stringify({ error: 'Lore entry not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch canon references linked to this entry
  const references = await db
    .select()
    .from(canonReferences)
    .where(eq(canonReferences.loreEntryId, entryId));

  return new Response(JSON.stringify({ data: { ...entry, references } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PUT /api/canon/lore/[id] — Update lore entry (owner-only) ────

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const entryId = Number(params?.id);

  if (!entryId || Number.isNaN(entryId)) {
    return new Response(JSON.stringify({ error: 'Invalid lore entry ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify entry exists
  const existing = await db.select().from(loreEntries).where(eq(loreEntries.id, entryId)).get();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Lore entry not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership — pseud must belong to this user
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(existing.pseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the lore entry owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate body
  const [data, error] = await validateBody(request, updateLoreEntrySchema);
  if (error) return error;

  // Build update object
  const updates: Record<string, any> = { updatedAt: Math.floor(Date.now() / 1000) };
  if (data.title !== undefined) updates.title = data.title;
  if (data.content !== undefined) updates.content = data.content;
  if (data.category !== undefined) updates.category = data.category;
  if (data.workId !== undefined) updates.workId = data.workId;

  await db.update(loreEntries).set(updates).where(eq(loreEntries.id, entryId));

  // Fetch updated entry
  const updated = await db.select().from(loreEntries).where(eq(loreEntries.id, entryId)).get();

  return new Response(JSON.stringify({ data: updated }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/canon/lore/[id] — Delete lore entry (owner-only) ─

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const entryId = Number(params?.id);

  if (!entryId || Number.isNaN(entryId)) {
    return new Response(JSON.stringify({ error: 'Invalid lore entry ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify entry exists
  const existing = await db.select().from(loreEntries).where(eq(loreEntries.id, entryId)).get();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Lore entry not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership
  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);

  if (!pseudIds.includes(existing.pseudId)) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the lore entry owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete (cascade handles canon_references and lore_edits)
  await db.delete(loreEntries).where(eq(loreEntries.id, entryId));

  return new Response(JSON.stringify({ data: { id: entryId, deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};