import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { deleteSession, clearSessionCookie, getSessionToken } from '@/v2/lib/auth';

export const config = { auth: 'required' as const };

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const token = getSessionToken(request);
  if (token) {
    await deleteSession(d1, token);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
  });
};
