export const prerender = false;

import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

// GET /api/canon/lore/[id]/history — Edit history for a lore entry
export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const id = Number(params.id);
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'Invalid lore ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  try {
    // JOIN with pseuds — use raw SQL for simplicity since we need pseud_name
    const { results: edits } = await d1.prepare(
      `SELECT le.*, p.name as pseud_name
       FROM lore_edits le
       LEFT JOIN pseuds p ON le.pseud_id = p.id
       WHERE le.lore_entry_id = ?1
       ORDER BY le.created_at DESC`
    ).bind(id).all<any>();

    return new Response(
      JSON.stringify({ edits }),
      { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};