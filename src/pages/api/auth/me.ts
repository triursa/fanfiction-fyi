import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getAuth } from '@/v2/lib/auth';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { getDb } from '@/v2/lib/db';
import { pseuds } from '@/v2/lib/schema/index';
import { eq } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

export const GET: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(d1, request);

  if (!auth) {
    return new Response(JSON.stringify({ user: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDb(d1);
  const userPseuds = await db.select().from(pseuds).where(eq(pseuds.userId, auth.user.id));

  return new Response(JSON.stringify({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      displayName: auth.user.displayName,
      role: auth.user.role,
      approved: auth.user.approved,
      theme: auth.user.theme,
      readingFontSize: auth.user.readingFontSize,
      readingSkinOverride: auth.user.readingSkinOverride,
      avatarKey: auth.user.avatarKey,
    },
    pseuds: userPseuds.map(p => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      iconKey: p.iconKey,
    })),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
