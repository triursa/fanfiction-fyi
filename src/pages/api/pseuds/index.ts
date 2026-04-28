export const prerender = false;

import { queryAll, run } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const pseuds = await queryAll<any>(db, `SELECT * FROM pseuds WHERE user_id = ?1 ORDER BY id`, auth.user.id);
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

  const existing = await queryAll<any>(db, `SELECT id FROM pseuds WHERE user_id = ?1 AND name = ?2`, auth.user.id, name);
  if (existing.length > 0) {
    return new Response(JSON.stringify({ error: 'You already have a pseud with that name' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const result = await run(db, `INSERT INTO pseuds (user_id, name, description, created_at) VALUES (?1, ?2, ?3, datetime('now'))`, auth.user.id, name, description || null);
  const pseud = await queryAll<any>(db, `SELECT * FROM pseuds WHERE id = ?1`, result.meta.last_row_id);

  return new Response(JSON.stringify(pseud[0]), { status: 201, headers: { 'Content-Type': 'application/json' } });
};