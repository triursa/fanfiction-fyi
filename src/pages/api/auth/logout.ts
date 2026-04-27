export const prerender = false;

import { run } from '@/lib/db';
import { getAuth, deleteSession, clearSessionCookie } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (auth) {
    const cookie = request.headers.get('cookie') ?? '';
    const token = cookie.match(/session=([a-f0-9]+)/)?.[1];
    if (token) await deleteSession(db, token);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() },
  });
};