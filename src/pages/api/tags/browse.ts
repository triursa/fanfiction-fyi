export const prerender = false;

import { queryAll } from '@/lib/db';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const params = url.searchParams;
  const type = params.get('type') || '';
  const q = params.get('q') || '';

  const validTypes = ['rating', 'warning', 'category', 'fandom', 'character', 'relationship', 'freeform'];
  const hasType = type && validTypes.includes(type);

  const sql = `
    SELECT t.id, t.name, t.type, COUNT(tg.work_id) as work_count
    FROM tags t
    LEFT JOIN taggings tg ON t.id = tg.tag_id
    WHERE (?1 OR t.type = ?2)
      AND (?3 OR t.name LIKE '%' || ?4 || '%')
    GROUP BY t.id
    ORDER BY work_count DESC
    LIMIT 100
  `;

  // ?1 = no type filter (true when no type selected), ?2 = type value
  // ?3 = no search filter (true when no q), ?4 = search term
  const bindings = [
    !hasType,   // ?1: true = skip type filter
    type,       // ?2: type value
    !q,         // ?3: true = skip name filter
    q,          // ?4: search term
  ];

  const tags = await queryAll<{
    id: number;
    name: string;
    type: string;
    work_count: number;
  }>(db, sql, ...bindings);

  return new Response(JSON.stringify(tags), {
    headers: { 'Content-Type': 'application/json', ...cors },
  });
};