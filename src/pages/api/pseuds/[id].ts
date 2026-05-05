export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { pseuds, creatorships, comments, kudos, bookmarks, readings } from '@/lib/schema';
import { requireAuth } from '@/lib/auth';
import { eq, and, ne, inArray, sql, count } from 'drizzle-orm';
import type { APIRoute } from 'astro';

/** GET /api/pseuds/[id] — single pseud (owner only) */
export const GET: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const pseudId = parseInt(params.id ?? '', 10);
  if (isNaN(pseudId)) return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseud = await drz.select().from(pseuds)
    .where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!pseud) return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Convert camelCase to snake_case for API compatibility
  const pseudResult = {
    id: pseud.id,
    user_id: pseud.userId,
    name: pseud.name,
    description: pseud.description,
    icon_key: pseud.iconKey,
    theme_color: pseud.themeColor,
    is_default: pseud.isDefault,
    created_at: pseud.createdAt,
    pinned_work_ids: pseud.pinnedWorkIds,
    banner_key: pseud.bannerKey,
  };

  return new Response(JSON.stringify(pseudResult), { headers: { 'Content-Type': 'application/json' } });
};

/** PUT /api/pseuds/[id] — update pseud (owner only) */
export const PUT: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const pseudId = parseInt(params.id ?? '', 10);
  if (isNaN(pseudId)) return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership
  const existing = await drz.select().from(pseuds)
    .where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!existing) return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, description, icon_key, pinned_work_ids, banner_key, theme_color, is_default } = body || {};
  const newName = (typeof name === 'string' ? name.trim() : existing.name);
  const newDesc = (description !== undefined ? (typeof description === 'string' ? description : null) : existing.description);
  const newIconKey = (icon_key !== undefined ? (typeof icon_key === 'string' ? icon_key : null) : existing.iconKey);

  // Pinned work IDs validation: must be array of max 6 integers
  let newPinnedWorkIds = existing.pinnedWorkIds || '[]';
  if (pinned_work_ids !== undefined) {
    if (!Array.isArray(pinned_work_ids)) {
      return new Response(JSON.stringify({ error: 'pinned_work_ids must be an array' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (pinned_work_ids.length > 6) {
      return new Response(JSON.stringify({ error: 'Maximum 6 pinned works' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // Validate all are integers
    const validIds = pinned_work_ids.filter((id: any) => Number.isInteger(id) && id > 0);
    // Validate the pseud owns these works
    if (validIds.length > 0) {
      const ownedWorks = await drz.select({ workId: creatorships.workId })
        .from(creatorships)
        .where(and(eq(creatorships.pseudId, pseudId), inArray(creatorships.workId, validIds)));
      const ownedSet = new Set(ownedWorks.map((w: any) => w.workId));
      const filtered = validIds.filter((id: number) => ownedSet.has(id));
      newPinnedWorkIds = JSON.stringify(filtered);
    } else {
      newPinnedWorkIds = '[]';
    }
  }

  // Banner key validation
  const newBannerKey = (banner_key !== undefined ? (typeof banner_key === 'string' ? banner_key : null) : existing.bannerKey);

  // Theme color validation (hex color)
  let newThemeColor = existing.themeColor;
  if (theme_color !== undefined) {
    if (theme_color !== null && !/^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/.test(String(theme_color))) {
      return new Response(JSON.stringify({ error: 'Invalid theme color format' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    newThemeColor = theme_color === null ? null : String(theme_color);
  }

  // Name validation
  if (!newName || newName.length === 0) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (newName.length > 100) {
    return new Response(JSON.stringify({ error: 'Name must be 100 characters or fewer' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check for duplicate name (excluding current pseud)
  if (newName !== existing.name) {
    const dup = await drz.select({ id: pseuds.id })
      .from(pseuds)
      .where(and(eq(pseuds.userId, auth.user.id), eq(pseuds.name, newName), ne(pseuds.id, pseudId)));
    if (dup.length > 0) {
      return new Response(JSON.stringify({ error: 'You already have a pseud with that name' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Handle is_default atomically: if promoting this pseud to default, clear all others too
  if (is_default === 1) {
    // Clear default on all other pseuds for this user
    await drz.update(pseuds)
      .set({ isDefault: 0 })
      .where(and(eq(pseuds.userId, auth.user.id), ne(pseuds.id, pseudId)));
  }

  // Update the pseud itself
  await drz.update(pseuds)
    .set({
      name: newName,
      description: newDesc,
      iconKey: newIconKey,
      pinnedWorkIds: newPinnedWorkIds,
      bannerKey: newBannerKey,
      themeColor: newThemeColor,
      isDefault: is_default === 1 ? 1 : existing.isDefault,
    })
    .where(eq(pseuds.id, pseudId));

  const updated = await drz.select().from(pseuds).where(eq(pseuds.id, pseudId)).get();

  // Convert camelCase to snake_case for API compatibility
  const pseudResult = updated ? {
    id: updated.id,
    user_id: updated.userId,
    name: updated.name,
    description: updated.description,
    icon_key: updated.iconKey,
    theme_color: updated.themeColor,
    is_default: updated.isDefault,
    created_at: updated.createdAt,
    pinned_work_ids: updated.pinnedWorkIds,
    banner_key: updated.bannerKey,
  } : null;

  return new Response(JSON.stringify(pseudResult), { headers: { 'Content-Type': 'application/json' } });
};

/** DELETE /api/pseuds/[id] — delete a pseud (owner only, with safety checks) */
export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const pseudId = parseInt(params.id ?? '', 10);
  if (isNaN(pseudId)) return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership
  const existing = await drz.select().from(pseuds)
    .where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id)))
    .get();
  if (!existing) return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Safety check: can't delete if pseud has creatorships (linked to works)
  const creatorshipRows = await drz.select({ id: creatorships.id })
    .from(creatorships)
    .where(eq(creatorships.pseudId, pseudId));
  if (creatorshipRows.length > 0) {
    return new Response(
      JSON.stringify({ error: `Cannot delete pseud "${existing.name}" — it is credited on ${creatorshipRows.length} work(s). Transfer or remove those credits first.` }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Safety check: can't delete last pseud
  const allPseudsRows = await drz.select({ id: pseuds.id })
    .from(pseuds)
    .where(eq(pseuds.userId, auth.user.id));
  if (allPseudsRows.length <= 1) {
    return new Response(
      JSON.stringify({ error: 'You must have at least one pseud. Create a new one before deleting this one.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // If deleting the default pseud, first clear its flag then promote the next one
  if (existing.isDefault === 1) {
    await drz.update(pseuds).set({ isDefault: 0 }).where(eq(pseuds.id, pseudId));
    const remaining = allPseudsRows.filter((p: any) => p.id !== pseudId);
    if (remaining.length > 0) {
      await drz.update(pseuds).set({ isDefault: 1 }).where(eq(pseuds.id, remaining[0].id));
    }
  }

  // Delete related records first (comments, kudos, bookmarks, readings)
  await drz.delete(comments).where(eq(comments.pseudId, pseudId));
  await drz.delete(kudos).where(eq(kudos.pseudId, pseudId));
  await drz.delete(bookmarks).where(eq(bookmarks.pseudId, pseudId));
  await drz.delete(readings).where(eq(readings.pseudId, pseudId));

  // Clean up R2 icon + banner if present
  try {
    const bucket = locals.runtime.env.MEDIA as R2Bucket | undefined;
    if (bucket) {
      if (existing.iconKey) await bucket.delete(existing.iconKey);
      if (existing.bannerKey) await bucket.delete(existing.bannerKey);
    }
  } catch { /* non-critical */ }

  // Delete the pseud itself
  await drz.delete(pseuds).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id)));

  return new Response(JSON.stringify({ success: true, deleted: pseudId }), { headers: { 'Content-Type': 'application/json' } });
};