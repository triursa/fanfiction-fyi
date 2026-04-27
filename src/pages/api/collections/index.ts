export const prerender = false;

import { queryAll } from '@/lib/db';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;

  const collections = await queryAll<any>(db,
    `SELECT c.id, c.name, c.description, c.privacy, COUNT(ci.id) as item_count, c.created_at
     FROM collections c
     LEFT JOIN collection_items ci ON c.id = ci.collection_id
     WHERE c.privacy IN ('public', 'unrevealed')
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT 50`
  );

  return new Response(JSON.stringify({ collections }), {
    headers: { 'Content-Type': 'application/json', ...cors }
  });
};