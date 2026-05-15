export const prerender = false;

import { getAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

/**
 * GET /api/auth/me — return full authenticated user profile
 * D1 eventual consistency: changes may take 500-800ms to be visible in subsequent reads
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { user, pseuds } = auth;

  return new Response(JSON.stringify({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      approved: user.approved,
      banned: user.banned,
      google_linked: !!user.google_id,
      avatar_url: user.avatar_url ?? null,
      avatar_key: (user as any).avatar_key ?? null,
      display_name: user.display_name ?? null,
      bio: user.bio ?? '',
      email_visibility: user.email_visibility ?? 'private',
      reading_font_size: user.reading_font_size ?? 'default',
      mood_disabled: (user as any).mood_disabled ?? 0,
      has_password: !!user.password_hash,
    },
    pseuds,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
};