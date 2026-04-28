export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth, hashPassword, verifyPassword } from '@/lib/auth';
import { run } from '@/lib/db';

/**
 * POST /api/user/password — change or set password for authenticated user
 * Accepts: { current_password, new_password }
 * If user has password_hash: verify current_password first
 * If user has NO password_hash (OAuth-only): current_password can be empty
 * D1 eventual consistency: changes may take 500-800ms to be visible in subsequent reads
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { current_password?: string; new_password?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { current_password = '', new_password } = body;

  if (!new_password || new_password.length < 8) {
    return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (new_password.length > 128) {
    return new Response(JSON.stringify({ error: 'Password must be 128 characters or fewer' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // If user has existing password, verify current_password
  if (auth.user.password_hash) {
    const valid = await verifyPassword(current_password, auth.user.password_hash);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  // If user has NO password_hash (OAuth-only), skip current_password check

  const hashed = await hashPassword(new_password);
  await run(db, `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, hashed, auth.user.id);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};