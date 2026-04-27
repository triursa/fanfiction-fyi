export const prerender = false;

import { queryAll, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const params = url.searchParams;
  const type = params.get('type');
  const name = params.get('name');
  const limit = Math.min(Number(params.get('limit') || 25), 100);

  let sql = 'SELECT * FROM tags WHERE 1=1';
  const bindings: any[] = [];

  if (type) {
    sql += ' AND type = ?';
    bindings.push(type);
  }
  if (name) {
    sql += ' AND name LIKE ?';
    bindings.push(`%${name}%`);
  }
  sql += ' ORDER BY name LIMIT ?';
  bindings.push(limit);

  const tags = await queryAll<any>(db, sql, ...bindings);
  return new Response(JSON.stringify(tags), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);

  if (auth.user.role !== 'admin' && auth.user.role !== 'mod') {
    return new Response(JSON.stringify({ error: 'Forbidden: admin or mod role required' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, type } = body || {};
  if (!name || !type) {
    return new Response(JSON.stringify({ error: 'Name and type are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const validTypes = ['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'];
  if (!validTypes.includes(type)) {
    return new Response(JSON.stringify({ error: `Invalid tag type. Must be one of: ${validTypes.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const result = await run(db, `INSERT INTO tags (name, type) VALUES (?1, ?2)`, name, type);
    const tag = await queryAll<any>(db, `SELECT * FROM tags WHERE id = ?1`, result.meta.last_row_id);
    return new Response(JSON.stringify(tag[0]), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Tag already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};