import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../lib/db';
import { requireAuth } from '../../../../lib/auth';
import { validateBody } from '../../../../lib/validation';
import { changePasswordSchema } from '../../../../lib/validation';
import { users } from '../../../../lib/schema/index';
import { eq } from 'drizzle-orm';
import { verifyPassword, hashPassword } from '../../../../lib/auth';

export const config = { auth: 'required' as const };

// POST /api/user/password — Change password
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);

  const [data, error] = await validateBody(request, changePasswordSchema);
  if (error) return error;

  // Verify current password
  const user = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.user.id)).get();
  const valid = await verifyPassword(data.currentPassword, user!.passwordHash);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Hash and update
  const newHash = await hashPassword(data.newPassword);
  await db.update(users).set({ passwordHash: newHash, updatedAt: new Date().toISOString() }).where(eq(users.id, auth.user.id));

  return new Response(JSON.stringify({ data: { changed: true } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
