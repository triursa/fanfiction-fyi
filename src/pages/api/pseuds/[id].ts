import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth } from '@/v2/lib/auth';
import { validateBody } from '@/v2/lib/validation';
import { updatePseudSchema } from '@/v2/lib/validation';
import { pseuds, creatorships, works } from '@/v2/lib/schema/index';
import { eq, and } from 'drizzle-orm';

export const config = { auth: 'public' as const };

// GET /api/pseuds/:id — Public pseud profile
export const GET: APIRoute = async ({ params, locals }) => {
  const pseudId = Number(params.id);
  if (!pseudId || isNaN(pseudId)) {
    return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  const pseud = await db.select().from(pseuds).where(eq(pseuds.id, pseudId)).get();
  if (!pseud) {
    return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Get works by this pseud
  const pseudWorks = await db.select({ id: works.id, title: works.title, summary: works.summary, wordCount: works.wordCount, complete: works.complete, draft: works.draft, publishedAt: works.publishedAt, updatedAt: works.updatedAt })
  .from(creatorships)
  .innerJoin(works, eq(creatorships.workId, works.id))
  .where(and(eq(creatorships.pseudId, pseudId), eq(works.draft, 0)))
  .orderBy(works.updatedAt);

  return new Response(JSON.stringify({
    data: {
      ...pseud,
      works: pseudWorks,
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// PUT /api/pseuds/:id — Update pseud (owner only)
export const PUT: APIRoute = async ({ params, request, locals }) => {
  const pseudId = Number(params.id);
  if (!pseudId || isNaN(pseudId)) {
    return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  // Verify ownership
  const pseud = await db.select().from(pseuds).where(eq(pseuds.id, pseudId)).get();
  if (!pseud || pseud.userId !== auth.user.id) {
    return new Response(JSON.stringify({ error: 'Not your pseud' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const [data, error] = await validateBody(request, updatePseudSchema);
  if (error) return error;

  const updates: Record<string, any> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.themeColor !== undefined) updates.themeColor = data.themeColor;

  // Handle isDefault toggle
  if (data.isDefault !== undefined && data.isDefault === 1) {
    // Unset all other defaults for this user first
    await db.update(pseuds)
      .set({ isDefault: 0 })
      .where(and(eq(pseuds.userId, auth.user.id), eq(pseuds.isDefault, 1)));
    updates.isDefault = 1;
  }

  // Check name uniqueness if changing
  if (updates.name && updates.name !== pseud.name) {
    const existing = await db.select().from(pseuds).where(eq(pseuds.name, updates.name)).get();
    if (existing) {
      return new Response(JSON.stringify({ error: 'Pseud name already taken' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const updated = await db.update(pseuds).set(updates).where(eq(pseuds.id, pseudId)).returning();
  return new Response(JSON.stringify({ data: updated[0] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// DELETE /api/pseuds/:id — Delete pseud (owner only, cannot delete default)
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const pseudId = Number(params.id);
  if (!pseudId || isNaN(pseudId)) {
    return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  // Verify ownership
  const pseud = await db.select().from(pseuds).where(eq(pseuds.id, pseudId)).get();
  if (!pseud || pseud.userId !== auth.user.id) {
    return new Response(JSON.stringify({ error: 'Not your pseud' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Cannot delete default pseud
  if (pseud.isDefault === 1) {
    return new Response(JSON.stringify({ error: 'Cannot delete your default alias. Set another alias as default first.' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  }

  // Delete creatorships for this pseud first
  await db.delete(creatorships).where(eq(creatorships.pseudId, pseudId));

  // Delete the pseud
  await db.delete(pseuds).where(eq(pseuds.id, pseudId));

  return new Response(JSON.stringify({ data: { deleted: pseudId } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};