export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '@/lib/auth';
import { THEMES } from '@/styles/themes';

/** GET /api/user/theme — returns current user's theme */
export const GET: APIRoute = async ({ locals, request }) => {
  const auth = await requireAuth(locals.runtime.env.DB, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 });

  const db = locals.runtime.env.DB;
  const user = await db.prepare('SELECT theme FROM users WHERE id = ?').bind(auth.user.id).first();
  return new Response(JSON.stringify({ theme: user?.theme ?? 'obsidian' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** PUT /api/user/theme — sets user's theme preference */
export const PUT: APIRoute = async ({ locals, request }) => {
  const auth = await requireAuth(locals.runtime.env.DB, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 });

  try {
    const body = await request.json();
    const theme = body.theme as string;

    if (!theme || !(theme in THEMES)) {
      return new Response(JSON.stringify({ error: 'Invalid theme name' }), { status: 400 });
    }

    const db = locals.runtime.env.DB;
    await db.prepare('UPDATE users SET theme = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(theme, auth.user.id).run();

    return new Response(JSON.stringify({ theme }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }
};