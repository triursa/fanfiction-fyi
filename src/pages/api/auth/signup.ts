export const prerender = false;

import { queryFirst, run } from '@/lib/db';
import { hashPassword, createSession, setSessionCookie } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { invite_code, email, password, display_name } = body || {};
  if (!invite_code || !email || !password || !display_name || password.length < 8 || password.length > 128) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const invite = await queryFirst<{ id: number; used_by: number | null }>(db, `SELECT id, used_by FROM invite_codes WHERE code = ?1`, invite_code);
  if (!invite) {
    return new Response(JSON.stringify({ error: 'Invalid invite code' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (invite.used_by !== null) {
    return new Response(JSON.stringify({ error: 'Invite code already used' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const existing = await queryFirst<{ id: number }>(db, `SELECT id FROM users WHERE email = ?1`, email);
  if (existing) {
    return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const passwordHash = await hashPassword(password);

  const userResult = await run(db, `INSERT INTO users (email, password_hash, invite_code, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now'))`, email, passwordHash, invite_code);
  const userId = userResult.meta.last_row_id;

  await run(db, `UPDATE invite_codes SET used_by = ?1, used_at = datetime('now') WHERE id = ?2`, userId, invite.id);

  const pseudResult = await run(db, `INSERT INTO pseuds (user_id, name, created_at) VALUES (?1, ?2, datetime('now'))`, userId, display_name);
  const pseudId = pseudResult.meta.last_row_id;

  const token = await createSession(db, userId);

  return new Response(JSON.stringify({ id: userId, email, pseud_id: pseudId }), {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': setSessionCookie(token) },
  });
};