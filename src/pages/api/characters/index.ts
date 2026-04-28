export const prerender = false;

import { queryAll, queryFirst } from '@/lib/db';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const params = url.searchParams;

  const q = params.get('q') || '';
  const fandom = params.get('fandom') || '';
  const groupId = params.get('group_id') || '';
  const hasGroup = params.get('has_group') === 'true';
  const sort = params.get('sort') || 'name';
  const page = Math.max(Number(params.get('page') || 1), 1);
  const limit = Math.min(Number(params.get('limit') || 25), 100);
  const offset = (page - 1) * limit;

  // Count query
  let countSql = `
    SELECT COUNT(*) as total FROM characters c
    WHERE 1=1
  `;
  const countBindings: any[] = [];
  let ci = 1;

  if (q) { countSql += ` AND c.name LIKE '%' || $${ci++} || '%'`; countBindings.push(q); }
  if (fandom) { countSql += ` AND c.fandom = $${ci++}`; countBindings.push(fandom); }
  if (groupId) { countSql += ` AND c.group_id = $${ci++}`; countBindings.push(Number(groupId)); }
  if (hasGroup) { countSql += ` AND c.group_id IS NOT NULL`; }

  const countRow = await queryFirst<{ total: number }>(db, countSql, ...countBindings);
  const total = countRow?.total ?? 0;

  // Data query
  let dataSql = `
    SELECT c.*, 
      (SELECT COUNT(*) FROM character_appearances ca WHERE ca.character_id = c.id) as work_count,
      cg.name as group_name
    FROM characters c
    LEFT JOIN character_groups cg ON c.group_id = cg.id
    WHERE 1=1
  `;
  const dataBindings: any[] = [];
  let di = 1;

  if (q) { dataSql += ` AND c.name LIKE '%' || $${di++} || '%'`; dataBindings.push(q); }
  if (fandom) { dataSql += ` AND c.fandom = $${di++}`; dataBindings.push(fandom); }
  if (groupId) { dataSql += ` AND c.group_id = $${di++}`; dataBindings.push(Number(groupId)); }
  if (hasGroup) { dataSql += ` AND c.group_id IS NOT NULL`; }

  const validSorts: Record<string, string> = {
    name: 'c.name ASC',
    recent: 'c.created_at DESC',
    works: 'work_count DESC',
  };
  dataSql += ` ORDER BY ${validSorts[sort] || validSorts.name}`;
  dataSql += ` LIMIT $${di++} OFFSET $${di++}`;
  dataBindings.push(limit, offset);

  const characters = await queryAll<any>(db, dataSql, ...dataBindings);

  return new Response(JSON.stringify({ characters, total, page, limit }), {
    headers: { 'Content-Type': 'application/json', ...cors },
  });
};