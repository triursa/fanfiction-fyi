export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

// GET /api/characters/groups — List all character groups
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const q = url.searchParams.get('q') || '';

  let sql = `
    SELECT cg.*, COUNT(c.id) as character_count
    FROM character_groups cg
    LEFT JOIN characters c ON c.group_id = cg.id
    WHERE 1=1
  `;
  const bindings: any[] = [];
  if (q) {
    sql += ` AND cg.name LIKE '%' || ?1 || '%'`;
    bindings.push(q);
  }
  sql += ` GROUP BY cg.id ORDER BY cg.name`;

  const groups = await queryAll<any>(db, sql, ...bindings);
  return new Response(JSON.stringify(groups), { headers: { 'Content-Type': 'application/json', ...cors } });
};

// POST /api/characters/groups — Create a group
export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, description } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const result = await run(db, `INSERT INTO character_groups (name, description) VALUES (?1, ?2)`, name.trim(), description || null);
    const group = await queryFirst<any>(db, `SELECT * FROM character_groups WHERE id = ?1`, result.meta.last_row_id);
    return new Response(JSON.stringify(group), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Group already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};