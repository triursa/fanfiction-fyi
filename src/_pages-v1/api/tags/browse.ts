export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import { sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const drz = getDrizzle(locals.runtime.env.DB as D1Database);
  const params = url.searchParams;
  const type = params.get('type') || '';
  const q = params.get('q') || '';

  const validTypes = ['rating', 'warning', 'category', 'fandom', 'character', 'relationship', 'freeform'];
  const hasType = type && validTypes.includes(type);

  // Complex JOIN + GROUP BY with conditional boolean filtering — use sql template
  const tags = await drz.all<{
    id: number;
    name: string;
    type: string;
    work_count: number;
  }>(sql`
    SELECT t.id, t.name, t.type, COUNT(tg.work_id) as work_count
    FROM tags t
    LEFT JOIN taggings tg ON t.id = tg.tag_id
    WHERE (${!hasType} OR t.type = ${type})
      AND (${!q} OR t.name LIKE '%' || ${q} || '%')
    GROUP BY t.id
    ORDER BY work_count DESC
    LIMIT 100
  `);

  return new Response(JSON.stringify(tags), {
    headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') },
  });
};