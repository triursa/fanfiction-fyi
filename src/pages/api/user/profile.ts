export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '@/lib/auth';
import { queryFirst, run } from '@/lib/db';

const VALID_EMAIL_VISIBILITY = ['public', 'mutual', 'private'] as const;
const VALID_READING_FONT_SIZE = ['small', 'default', 'large', 'xlarge'] as const;

/**
 * PUT /api/user/profile — update authenticated user's profile fields
 * Accepts: { display_name?, bio?, email_visibility?, reading_font_size?, avatar_url? }
 * D1 eventual consistency: changes may take 500-800ms to be visible in subsequent reads
 */
export const PUT: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build SET clauses dynamically — only update provided fields
  const sets: string[] = [];
  const values: unknown[] = [];

  if ('display_name' in body) {
    sets.push('display_name = ?');
    values.push(typeof body.display_name === 'string' ? body.display_name : null);
  }

  if ('bio' in body) {
    const bio = typeof body.bio === 'string' ? body.bio : '';
    sets.push('bio = ?');
    values.push(bio.slice(0, 500)); // Trim bio to 500 chars max
  }

  if ('email_visibility' in body) {
    const vis = body.email_visibility as string;
    if (!VALID_EMAIL_VISIBILITY.includes(vis as any)) {
      return new Response(JSON.stringify({ error: 'Invalid email_visibility value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    sets.push('email_visibility = ?');
    values.push(vis);
  }

  if ('reading_font_size' in body) {
    const fs = body.reading_font_size as string;
    if (!VALID_READING_FONT_SIZE.includes(fs as any)) {
      return new Response(JSON.stringify({ error: 'Invalid reading_font_size value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    sets.push('reading_font_size = ?');
    values.push(fs);
  }

  if ('avatar_url' in body) {
    sets.push('avatar_url = ?');
    values.push(typeof body.avatar_url === 'string' ? body.avatar_url : null);
  }

  if ('avatar_key' in body) {
    sets.push('avatar_key = ?');
    values.push(typeof body.avatar_key === 'string' ? body.avatar_key : null);
  }

  if (sets.length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  sets.push("updated_at = datetime('now')");
  values.push(auth.user.id);

  await run(db, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...values);

  // Fetch updated user to return
  const updated = await queryFirst<any>(db, `SELECT * FROM users WHERE id = ?`, auth.user.id);

  return new Response(
    JSON.stringify({
      user: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        display_name: updated.display_name,
        avatar_url: updated.avatar_url,
        avatar_key: updated.avatar_key,
        bio: updated.bio,
        email_visibility: updated.email_visibility,
        reading_font_size: updated.reading_font_size,
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
};