import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth } from '@/v2/lib/auth';
import { validateBody } from '@/v2/lib/validation';
import { updateProfileSchema } from '@/v2/lib/validation';
import { users } from '@/v2/lib/schema/index';
import { eq } from 'drizzle-orm';

export const config = { auth: 'required' as const };

// GET /api/user/profile — Get current user profile
export const GET: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  const user = await db.select({
    id: users.id, email: users.email, displayName: users.displayName,
    bio: users.bio, role: users.role, approved: users.approved,
    emailVisibility: users.emailVisibility, theme: users.theme,
    readingFontSize: users.readingFontSize, readingSkinOverride: users.readingSkinOverride,
    avatarKey: users.avatarKey, createdAt: users.createdAt,
  }).from(users).where(eq(users.id, auth.user.id)).get();

  return new Response(JSON.stringify({ data: user }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

// PUT /api/user/profile — Update profile
export const PUT: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  const [data, error] = await validateBody(request, updateProfileSchema);
  if (error) return error;

  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.displayName !== undefined) updates.displayName = data.displayName;
  if (data.bio !== undefined) updates.bio = data.bio;
  if (data.emailVisibility !== undefined) updates.emailVisibility = data.emailVisibility;
  if (data.theme !== undefined) updates.theme = data.theme;
  if (data.readingFontSize !== undefined) updates.readingFontSize = data.readingFontSize;
  if (data.readingSkinOverride !== undefined) updates.readingSkinOverride = data.readingSkinOverride;

  const updated = await db.update(users).set(updates).where(eq(users.id, auth.user.id)).returning();

  return new Response(JSON.stringify({ data: {
    id: updated[0].id, displayName: updated[0].displayName, bio: updated[0].bio,
    emailVisibility: updated[0].emailVisibility, theme: updated[0].theme,
    readingFontSize: updated[0].readingFontSize, readingSkinOverride: updated[0].readingSkinOverride,
  }}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
