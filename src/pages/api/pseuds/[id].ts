export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

/** GET /api/pseuds/[id] — single pseud (owner only) */
export const GET: APIRoute = async ({ request, locals, params }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const pseudId = parseInt(params.id ?? '', 10);
  if (isNaN(pseudId)) return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseud = await queryFirst<any>(db, `SELECT * FROM pseuds WHERE id = ?1 AND user_id = ?2`, pseudId, auth.user.id);
  if (!pseud) return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify(pseud), { headers: { 'Content-Type': 'application/json' } });
};

/** PUT /api/pseuds/[id] — update pseud name/description (owner only) */
export const PUT: APIRoute = async ({ request, locals, params }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const pseudId = parseInt(params.id ?? '', 10);
  if (isNaN(pseudId)) return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership
  const existing = await queryFirst<any>(db, `SELECT * FROM pseuds WHERE id = ?1 AND user_id = ?2`, pseudId, auth.user.id);
  if (!existing) return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, description, icon_key } = body || {};
  const newName = (typeof name === 'string' ? name.trim() : existing.name);
  const newDesc = (description !== undefined ? (typeof description === 'string' ? description : null) : existing.description);
  const newIconKey = (icon_key !== undefined ? (typeof icon_key === 'string' ? icon_key : null) : existing.icon_key);

  // Name validation
  if (!newName || newName.length === 0) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (newName.length > 100) {
    return new Response(JSON.stringify({ error: 'Name must be 100 characters or fewer' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check for duplicate name (excluding current pseud)
  if (newName !== existing.name) {
    const dup = await queryAll<any>(db, `SELECT id FROM pseuds WHERE user_id = ?1 AND name = ?2 AND id != ?3`, auth.user.id, newName, pseudId);
    if (dup.length > 0) {
      return new Response(JSON.stringify({ error: 'You already have a pseud with that name' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
  }

  await run(db, `UPDATE pseuds SET name = ?1, description = ?2, icon_key = ?3 WHERE id = ?4 AND user_id = ?5`, newName, newDesc, newIconKey, pseudId, auth.user.id);

  const updated = await queryFirst<any>(db, `SELECT * FROM pseuds WHERE id = ?1`, pseudId);
  return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
};

/** DELETE /api/pseuds/[id] — delete a pseud (owner only, with safety checks) */
export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const pseudId = parseInt(params.id ?? '', 10);
  if (isNaN(pseudId)) return new Response(JSON.stringify({ error: 'Invalid pseud ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Verify ownership
  const existing = await queryFirst<any>(db, `SELECT * FROM pseuds WHERE id = ?1 AND user_id = ?2`, pseudId, auth.user.id);
  if (!existing) return new Response(JSON.stringify({ error: 'Pseud not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Safety check: can't delete if pseud has creatorships (linked to works)
  const creatorships = await queryAll<any>(db, `SELECT id FROM creatorships WHERE pseud_id = ?1`, pseudId);
  if (creatorships.length > 0) {
    return new Response(
      JSON.stringify({ error: `Cannot delete pseud "${existing.name}" — it is credited on ${creatorships.length} work(s). Transfer or remove those credits first.` }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Safety check: can't delete last pseud
  const allPseuds = await queryAll<any>(db, `SELECT id FROM pseuds WHERE user_id = ?1`, auth.user.id);
  if (allPseuds.length <= 1) {
    return new Response(
      JSON.stringify({ error: 'You must have at least one pseud. Create a new one before deleting this one.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Delete related records first (comments, kudos, bookmarks, readings)
  await run(db, `DELETE FROM comments WHERE pseud_id = ?1`, pseudId);
  await run(db, `DELETE FROM kudos WHERE pseud_id = ?1`, pseudId);
  await run(db, `DELETE FROM bookmarks WHERE pseud_id = ?1`, pseudId);
  await run(db, `DELETE FROM readings WHERE pseud_id = ?1`, pseudId);

  // Clean up R2 icon if present
  if (existing.icon_key) {
    try {
      const bucket = locals.runtime.env.MEDIA as R2Bucket | undefined;
      if (bucket) await bucket.delete(existing.icon_key);
    } catch { /* non-critical */ }
  }

  // Delete the pseud itself
  await run(db, `DELETE FROM pseuds WHERE id = ?1 AND user_id = ?2`, pseudId, auth.user.id);

  return new Response(JSON.stringify({ success: true, deleted: pseudId }), { headers: { 'Content-Type': 'application/json' } });
};