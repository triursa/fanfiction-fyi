export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth, deleteSession, clearSessionCookie } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(d1, request);
  if (auth) {
    const cookie = request.headers.get('cookie') ?? '';
    const token = cookie.match(/session=([a-f0-9]+)/)?.[1];
    if (token) await deleteSession(d1, token);
  }
  return new Response(null, {
    status: 303,
    headers: {
      'Location': '/',
      'Set-Cookie': clearSessionCookie(),
    },
  });
};