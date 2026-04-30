export const prerender = false;
import { queryAll } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import type { APIRoute } from 'astro';
import { UserRole } from '@/lib/types';

export const GET: APIRoute = async ({ request, locals, url }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireRole(db, request, UserRole.Admin);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if ('forbidden' in auth) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  
  const workId = url.searchParams.get('work_id');
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
  
  let query = `SELECT * FROM publish_log`;
  const params: any[] = [];
  if (workId) {
    query += ` WHERE work_id = ?1`;
    params.push(Number(workId));
  }
  query += ` ORDER BY created_at DESC LIMIT ${limit}`;
  
  const logs = await queryAll<any>(db, query, ...params);
  return new Response(JSON.stringify({ logs }), { headers: { 'Content-Type': 'application/json' } });
};