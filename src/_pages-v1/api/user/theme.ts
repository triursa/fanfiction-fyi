export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '@/lib/auth';
import { getDrizzle } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { THEMES } from '@/styles/themes';

/** GET /api/user/theme — returns current user's theme */
export const GET: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 });

  const db = getDrizzle(d1);
  const user = await db.select({ theme: users.theme }).from(users).where(eq(users.id, auth.user.id)).get();
  return new Response(JSON.stringify({ theme: user?.theme ?? 'obsidian' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

/** PUT /api/user/theme — sets user's theme preference */
export const PUT: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Auth required' }), { status: 401 });

  try {
    const body = await request.json();
    const theme = body.theme as string;

    if (!theme || !(theme in THEMES)) {
      return new Response(JSON.stringify({ error: 'Invalid theme name' }), { status: 400 });
    }

    const db = getDrizzle(d1);
    await db.update(users).set({
      theme,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(users.id, auth.user.id));

    return new Response(JSON.stringify({ theme }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }
};