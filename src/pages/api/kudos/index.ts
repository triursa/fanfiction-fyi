export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { work_id } = body || {};
  if (!work_id) return new Response(JSON.stringify({ error: 'work_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseudId = (body?.pseud_id && auth.pseuds.some((p: any) => p.id === Number(body.pseud_id))) ? Number(body.pseud_id) : auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  try {
    await run(db, `INSERT INTO kudos (work_id, pseud_id, created_at) VALUES (?1, ?2, datetime('now'))`, work_id, pseudId);
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Already gave kudos' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};