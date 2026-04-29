export const prerender = false;

import { queryAll } from '@/lib/db';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

// GET /api/canon/locations/[id]/history — Edit history for a location
export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const id = Number(params.id);
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Invalid location ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    const edits = await queryAll<any>(
      db,
      `SELECT le.*, p.name as pseud_name
       FROM location_edits le
       LEFT JOIN pseuds p ON le.pseud_id = p.id
       WHERE le.location_id = ?1
       ORDER BY le.created_at DESC`,
      id,
    );

    return new Response(
      JSON.stringify({ edits }),
      { headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};
