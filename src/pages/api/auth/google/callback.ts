export const prerender = false;

import { queryFirst, run, queryAll } from '@/lib/db';
import { createSession, setSessionCookie, getAuth } from '@/lib/auth';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { APIRoute } from 'astro';

// Module-level JWKS — cached and reused across requests to avoid per-request setup cost
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

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
  const founderEmail = (env.FOUNDER_EMAIL as string | undefined)?.trim() || undefined;

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
    // State format: link_{userId} or link_{userId}_{nonce}
    const stateParts = state.slice(5).split('_');
    const linkUserId = parseInt(stateParts[0], 10);
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

    // Verify ID token signature using Google's public JWKS (prevents token forgery)
    let linkPayload: any;
    try {
      const { payload: verified } = await jwtVerify(tokens.id_token as string, GOOGLE_JWKS, {
        issuer: ['accounts.google.com', 'https://accounts.google.com'],
        audience: clientId,
      });
      linkPayload = verified;
    } catch (e) {
      console.error('Google ID token verification failed (link flow):', e);
      return Response.redirect(`${url.origin}/settings?error=oauth_token_failed`, 302);
    }

    const googleEmail = linkPayload.email as string;
    const googleSub = linkPayload.sub as string;
    const googleName = linkPayload.name as string | undefined;
    const googlePicture = linkPayload.picture as string | undefined;

    if (!googleEmail || !googleSub || !linkPayload.email_verified) {
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

  // Verify ID token signature using Google's public JWKS (prevents token forgery)
  let payload: any;
  try {
    const { payload: verified } = await jwtVerify(tokens.id_token as string, GOOGLE_JWKS, {
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

  if (!googleEmail || !payload.email_verified) {
    return Response.redirect(`${url.origin}/login?error=oauth_no_email`, 302);
  }

  // Determine role — founder for specific email (configurable via FOUNDER_EMAIL env var)
  const isFounder = googleEmail === founderEmail;
  const role = isFounder ? 'founder' : 'user';

  // Upsert user — also fetch approved/banned status for login gating
  const existingUser = await queryFirst<{ id: number; role: string; approved: number; banned: number }>(
    db,
    `SELECT id, role, approved, banned FROM users WHERE email = ?1`,
    googleEmail
  );

  let userId: number;
  let redirectPath: string;

  if (existingUser) {
    userId = existingUser.id;

    // Banned users cannot log in
    if (existingUser.banned) {
      return Response.redirect(`${url.origin}/login?error=banned`, 302);
    }

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

    // Unapproved users go to pending-approval page
    redirectPath = existingUser.approved ? '/' : '/pending-approval';
  } else {
    // Create new OAuth user — new users require approval (approved = 0)
    // Exception: founder is auto-approved
    const approved = isFounder ? 1 : 0;
    const result = await run(
      db,
      `INSERT INTO users (email, role, google_id, avatar_url, display_name, approved, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'))`,
      googleEmail, role, googleSub, googlePicture ?? null, googleName ?? null, approved
    );
    userId = result.meta.last_row_id;

    // Create default pseud from Google name or email local part
    const pseudName = googleName || googleEmail.split('@')[0];
    await run(
      db,
      `INSERT INTO pseuds (user_id, name, created_at) VALUES (?1, ?2, datetime('now'))`,
      userId, pseudName
    );

    // New users go to pending-approval unless they're the founder
    redirectPath = isFounder ? '/' : '/pending-approval';
  }

  // Create session
  const token = await createSession(db, userId);

  // Redirect to appropriate page with session cookie
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectPath,
      'Set-Cookie': setSessionCookie(token),
    },
  });
};