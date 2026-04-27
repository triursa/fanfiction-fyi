export const prerender = false;

import { getAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ user: { id: auth.user.id, email: auth.user.email, role: auth.user.role }, pseuds: auth.pseuds }), {
    headers: { 'Content-Type': 'application/json' },
  });
};