export const prerender = false;

import type { APIRoute } from 'astro';

/**
 * GET /api/auth/google
 * Initiates Google OAuth flow — redirects user to Google consent screen.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const env = locals.runtime.env;
  const clientId = env.GOOGLE_CLIENT_ID as string;

  if (!clientId) {
    return new Response(JSON.stringify({ error: 'Google OAuth not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
};
