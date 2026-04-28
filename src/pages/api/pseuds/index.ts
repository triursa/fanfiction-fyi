export const prerender = false;

import { queryAll, run } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const pseuds = await queryAll<any>(db, `
    SELECT p.*, COUNT(c.id) as work_count
    FROM pseuds p
    LEFT JOIN creatorships c ON c.pseud_id = p.id
    WHERE p.user_id = ?1
    GROUP BY p.id
    ORDER BY p.id
  `, auth.user.id);
  return new Response(JSON.stringify(pseuds), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, description } = body || {};
  if (!name) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Validate name length
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName || trimmedName.length > 100) {
    return new Response(JSON.stringify({ error: 'Name must be 1–100 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const existing = await queryAll<any>(db, `SELECT id FROM pseuds WHERE user_id = ?1 AND name = ?2`, auth.user.id, trimmedName);
  if (existing.length > 0) {
    return new Response(JSON.stringify({ error: 'You already have a pseud with that name' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const desc = (description !== undefined && description !== null) ? String(description) : null;
  const iconKey = (body.icon_key !== undefined && body.icon_key !== null) ? String(body.icon_key) : null;
  const result = await run(db, `INSERT INTO pseuds (user_id, name, description, icon_key, created_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))`, auth.user.id, trimmedName, desc, iconKey);
  const pseud = await queryAll<any>(db, `SELECT *, 0 as work_count FROM pseuds WHERE id = ?1`, result.meta.last_row_id);

  return new Response(JSON.stringify(pseud[0]), { status: 201, headers: { 'Content-Type': 'application/json' } });
};