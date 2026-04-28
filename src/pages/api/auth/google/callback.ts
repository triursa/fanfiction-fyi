export const prerender = false;

import { queryFirst, run, queryAll } from '@/lib/db';
import { createSession, setSessionCookie } from '@/lib/auth';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { APIRoute } from 'astro';

/**
 * GET /api/auth/google/callback
 * Google OAuth callback — exchanges code for tokens, verifies ID token, upserts user, creates session.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const env = locals.runtime.env;
  const clientId = env.GOOGLE_CLIENT_ID as string;
  const clientSecret = env.GOOGLE_CLIENT_SECRET as string;
  const founderEmail = (env.FOUNDER_EMAIL as string) || 'kaleb.bays@gmail.com';

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return Response.redirect(`${url.origin}/login?error=oauth_denied`, 302);
  }

  if (!code) {
    return Response.redirect(`${url.origin}/login?error=oauth_no_code`, 302);
  }

  // Exchange code for tokens
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    console.error('Google token exchange failed:', await tokenRes.text());
    return Response.redirect(`${url.origin}/login?error=oauth_token_failed`, 302);
  }

  const tokens = await tokenRes.json();

  // Verify ID token signature using Google's public JWKS (prevents token forgery)
  let payload: any;
  try {
    const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    const { payload: verified } = await jwtVerify(tokens.id_token as string, jwks, {
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
      audience: clientId,
    });
    payload = verified;
  } catch (e) {
    console.error('Google ID token verification failed:', e);
    return Response.redirect(`${url.origin}/login?error=oauth_token_failed`, 302);
  }

  const googleEmail = payload.email as string;
  const googleSub = payload.sub as string;
  const googleName = payload.name as string | undefined;
  const googlePicture = payload.picture as string | undefined;

  if (!googleEmail) {
    return Response.redirect(`${url.origin}/login?error=oauth_no_email`, 302);
  }

  // Determine role — founder for specific email (configurable via FOUNDER_EMAIL env var)
  const role = googleEmail === founderEmail ? 'founder' : 'user';

  // Upsert user
  const existingUser = await queryFirst<{ id: number; role: string }>(
    db,
    `SELECT id, role FROM users WHERE email = ?1`,
    googleEmail
  );

  let userId: number;

  if (existingUser) {
    userId = existingUser.id;
    // Update Google fields on existing user (but never downgrade role)
    await run(
      db,
      `UPDATE users SET google_id = ?1, avatar_url = ?2, display_name = COALESCE(?3, display_name), updated_at = datetime('now')
       WHERE id = ?4 AND (google_id IS NULL OR google_id != ?1)`,
      googleSub, googlePicture ?? null, googleName ?? null, userId
    );
    // Elevate to founder if applicable (never downgrade)
    if (role === 'founder' && existingUser.role !== 'founder') {
      await run(db, `UPDATE users SET role = 'founder', updated_at = datetime('now') WHERE id = ?1`, userId);
    }
  } else {
    // Create new OAuth user (no password, no invite code needed for Google signup)
    const result = await run(
      db,
      `INSERT INTO users (email, role, google_id, avatar_url, display_name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))`,
      googleEmail, role, googleSub, googlePicture ?? null, googleName ?? null
    );
    userId = result.meta.last_row_id;

    // Create default pseud from Google name or email local part
    const pseudName = googleName || googleEmail.split('@')[0];
    await run(
      db,
      `INSERT INTO pseuds (user_id, name, created_at) VALUES (?1, ?2, datetime('now'))`,
      userId, pseudName
    );
  }

  // Create session
  const token = await createSession(db, userId);

  // Redirect to home with session cookie
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': setSessionCookie(token),
    },
  });
};