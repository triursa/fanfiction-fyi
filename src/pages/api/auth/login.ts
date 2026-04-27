export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const user = await queryFirst<any>(db, `SELECT * FROM users WHERE email = ?1`, email);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const token = await createSession(db, user.id);

  const pseuds = await queryAll<any>(db, `SELECT * FROM pseuds WHERE user_id = ?1`, user.id);

  return new Response(JSON.stringify({ user: { id: user.id, email: user.email, role: user.role }, pseuds }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': setSessionCookie(token) },
  });
};