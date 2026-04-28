export const prerender = false;

import { queryFirst, run, queryAll } from '@/lib/db';
import { createSession, setSessionCookie, getAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

/**
 * GET /api/auth/google/callback
 * Google OAuth callback — exchanges code for tokens, handles three flows:
 * 1. New-user signup
 * 2. Existing-user login
 * 3. Account linking (state starts with "link_")
 * D1 eventual consistency: changes may take 500-800ms to be visible in subsequent reads
 */
export const GET: APIRoute = async ({ url, locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const env = locals.runtime.env;
  const clientId = env.GOOGLE_CLIENT_ID as string;
  const clientSecret = env.GOOGLE_CLIENT_SECRET as string;

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    return Response.redirect(`${url.origin}/login?error=oauth_denied`, 302);
  }

  if (!code) {
    return Response.redirect(`${url.origin}/login?error=oauth_no_code`, 302);
  }

  // --- Link flow: when state starts with "link_", this is an account linking request ---
  if (state && state.startsWith('link_')) {
    const linkUserId = parseInt(state.slice(5), 10);
    if (isNaN(linkUserId)) {
      return Response.redirect(`${url.origin}/settings?error=invalid_link_state`, 302);
    }

    // Require auth for linking — verify session user matches the userId in state
    const auth = await getAuth(db, request);
    if (!auth || auth.user.id !== linkUserId) {
      return Response.redirect(`${url.origin}/settings?error=auth_required`, 302);
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
      console.error('Google token exchange failed (link flow):', await tokenRes.text());
      return Response.redirect(`${url.origin}/settings?error=oauth_token_failed`, 302);
    }

    const tokens = await tokenRes.json();

    // Decode ID token payload
    const idToken = tokens.id_token as string;
    const [_header, payloadB64, _sig] = idToken.split('.');
    const payload = JSON.parse(
      decodeURIComponent(
        Array.from(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )
    );

    const googleEmail = payload.email as string;
    const googleSub = payload.sub as string;
    const googleName = payload.name as string | undefined;
    const googlePicture = payload.picture as string | undefined;

    if (!googleEmail || !googleSub) {
      return Response.redirect(`${url.origin}/settings?error=oauth_no_email`, 302);
    }

    // Check if this Google email is already linked to a DIFFERENT user account
    const existingGoogleUser = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM users WHERE google_id = ?1 AND id != ?2`,
      googleSub,
      linkUserId
    );
    if (existingGoogleUser) {
      return Response.redirect(`${url.origin}/settings?error=google_already_linked`, 302);
    }

    // Also check if another user has the same Google email (less common but possible)
    const existingEmailUser = await queryFirst<{ id: number }>(
      db,
      `SELECT id FROM users WHERE email = ?1 AND google_id = ?2 AND id != ?3`,
      googleEmail,
      googleSub,
      linkUserId
    );
    if (existingEmailUser) {
      return Response.redirect(`${url.origin}/settings?error=google_already_linked`, 302);
    }

    // Link Google account to current user
    await run(
      db,
      `UPDATE users SET google_id = ?, avatar_url = ?, display_name = COALESCE(?, display_name), updated_at = datetime('now') WHERE id = ?`,
      googleSub,
      googlePicture ?? null,
      googleName ?? null,
      linkUserId
    );

    return Response.redirect(`${url.origin}/settings?linked=true`, 302);
  }

  // --- Standard flow: new-user signup or existing-user login ---

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

  // Decode ID token payload (base64) — we trust Google's token endpoint
  const idToken = tokens.id_token as string;
  const [_header, payloadB64, _sig] = idToken.split('.');
  const payload = JSON.parse(
    // Workers don't have atob in all contexts — manual base64url decode
    decodeURIComponent(
      Array.from(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
  );

  const googleEmail = payload.email as string;
  const googleSub = payload.sub as string;
  const googleName = payload.name as string | undefined;
  const googlePicture = payload.picture as string | undefined;

  if (!googleEmail) {
    return Response.redirect(`${url.origin}/login?error=oauth_no_email`, 302);
  }

  // Determine role — founder for specific email
  const FOUNDER_EMAIL = 'kaleb.bays@gmail.com';
  const role = googleEmail === FOUNDER_EMAIL ? 'founder' : 'user';

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