export const prerender = false;

import { run } from '@/lib/db';
import type { APIRoute } from 'astro';

/**
 * Client-side debug log endpoint.
 * Receives navigator.sendBeacon() payloads from the draft workspace
 * and writes them to D1 publish_log for server-side inspection.
 * 
 * No auth required — beacon requests don't carry cookies reliably.
 * The data is just action/detail pairs for debugging.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  
  let body: any;
  try {
    const text = await request.text();
    body = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ ok: false }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  try {
    // Extract work_id from URL if present
    const urlMatch = (body.url || '').match(/\/works\/(\d+)/);
    const workId = urlMatch ? Number(urlMatch[1]) : 0;

    await db.prepare(
      `INSERT INTO publish_log (work_id, step, status, request_summary, created_at)
       VALUES (?1, ?2, 'attempt', ?3, CURRENT_TIMESTAMP)`
    ).bind(
      workId,
      `client_${body.action || 'unknown'}`,
      JSON.stringify({ detail: body.detail, ts: body.ts }).slice(0, 500)
    ).run();
  } catch (e: any) {
    console.error('[client-log] D1 write failed:', e?.message);
  }

  return new Response(JSON.stringify({ ok: true }), { 
    headers: { 'Content-Type': 'application/json' } 
  });
};