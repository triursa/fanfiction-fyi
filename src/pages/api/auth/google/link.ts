export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '@/lib/auth';
import { queryFirst, run } from '@/lib/db';

/**
 * POST /api/auth/google/link — initiate Google account linking
 * Requires auth. Returns Google OAuth URL with state=link_{userId}
 * D1 eventual consistency: changes may take 500-800ms to be visible in subsequent reads
 */
export const POST: APIRoute = async ({ locals, request, url }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if already linked
  if (auth.user.google_id) {
    return new Response(JSON.stringify({ error: 'Already linked' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const env = locals.runtime.env;
  const clientId = env.GOOGLE_CLIENT_ID as string;
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'Google OAuth not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`;
  // Generate a random nonce to make the state parameter unguessable,
  // preventing CSRF attacks where an attacker crafts a link with a
  // predictable state=link_{userId} value.
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const state = `link_${auth.user.id}_${nonce}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  return new Response(JSON.stringify({ url: oauthUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * DELETE /api/auth/google/link — unlink Google account
 * Requires auth. User must have a password set before unlinking.
 * D1 eventual consistency: changes may take 500-800ms to be visible in subsequent reads
 */
export const DELETE: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Must have a password set before unlinking Google
  if (!auth.user.password_hash) {
    return new Response(JSON.stringify({ error: 'Must have a password set before unlinking Google' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await run(db, `UPDATE users SET google_id = NULL, avatar_url = NULL, updated_at = datetime('now') WHERE id = ?`, auth.user.id);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};