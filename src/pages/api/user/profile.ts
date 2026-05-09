export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '@/lib/auth';
import { getDrizzle } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';

const VALID_EMAIL_VISIBILITY = ['public', 'mutual', 'private'] as const;
const VALID_READING_FONT_SIZE = ['small', 'default', 'large', 'xlarge'] as const;
const VALID_READING_SKIN_OVERRIDE = ['default', 'typewriter', 'manuscript', 'terminal', 'parchment', 'author'] as const;

/**
 * PUT /api/user/profile — update authenticated user's profile fields
 * Accepts: { display_name?, bio?, email_visibility?, reading_font_size?, avatar_url? }
 * D1 eventual consistency: changes may take 500-800ms to be visible in subsequent reads
 */
export const PUT: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
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

  // Build update values dynamically — only update provided fields
  const updateValues: Record<string, any> = {};

  if ('display_name' in body) {
    updateValues.displayName = typeof body.display_name === 'string' ? body.display_name : null;
  }

  if ('bio' in body) {
    const bio = typeof body.bio === 'string' ? body.bio : '';
    updateValues.bio = bio.slice(0, 500);
  }

  if ('email_visibility' in body) {
    const vis = body.email_visibility as string;
    if (!VALID_EMAIL_VISIBILITY.includes(vis as any)) {
      return new Response(JSON.stringify({ error: 'Invalid email_visibility value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    updateValues.emailVisibility = vis;
  }

  if ('reading_font_size' in body) {
    const fs = body.reading_font_size as string;
    if (!VALID_READING_FONT_SIZE.includes(fs as any)) {
      return new Response(JSON.stringify({ error: 'Invalid reading_font_size value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    updateValues.readingFontSize = fs;
  }

  if ('mood_disabled' in body) {
    const md = body.mood_disabled;
    updateValues.moodDisabled = (md === true || md === 1) ? 1 : 0;
  }

  if ('reading_skin_override' in body) {
    const skin = body.reading_skin_override as string;
    if (!VALID_READING_SKIN_OVERRIDE.includes(skin as any)) {
      return new Response(JSON.stringify({ error: 'Invalid reading_skin_override value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    updateValues.readingSkinOverride = skin;
  }

  if ('avatar_url' in body) {
    updateValues.avatarUrl = typeof body.avatar_url === 'string' ? body.avatar_url : null;
  }

  if ('avatar_key' in body) {
    updateValues.avatarKey = typeof body.avatar_key === 'string' ? body.avatar_key : null;
  }

  if (Object.keys(updateValues).length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  updateValues.updatedAt = sql`datetime('now')`;

  const db = getDrizzle(d1);
  await db.update(users).set(updateValues).where(eq(users.id, auth.user.id));

  // Fetch updated user to return
  const updated = await db.select().from(users).where(eq(users.id, auth.user.id)).get();

  return new Response(
    JSON.stringify({
      user: {
        id: updated!.id,
        email: updated!.email,
        role: updated!.role,
        display_name: updated!.displayName,
        avatar_url: updated!.avatarUrl,
        avatar_key: updated!.avatarKey,
        bio: updated!.bio,
        email_visibility: updated!.emailVisibility,
        reading_font_size: updated!.readingFontSize,
        reading_skin_override: updated!.readingSkinOverride ?? 'author',
        mood_disabled: updated!.moodDisabled ?? 0,
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
};