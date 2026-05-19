import type { APIRoute } from 'astro';
import { eq, and, isNull } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { hashPassword } from '@/v2/lib/auth';
import { users, passwordResets } from '@/v2/lib/schema/index';
import { z } from 'zod';
import { validateBody } from '@/v2/lib/validation';

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const config = { auth: 'public' as const };

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Validate request body
  const [data, error] = await validateBody(request, resetPasswordSchema);
  if (error) return error;

  // Look up the reset token
  const resetRecord = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.token, data.token))
    .get();

  if (!resetRecord) {
    return new Response(JSON.stringify({ error: 'Invalid or expired reset token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if token has already been used
  if (resetRecord.usedAt) {
    return new Response(JSON.stringify({ error: 'This reset link has already been used' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if token has expired
  if (new Date(resetRecord.expiresAt) < new Date()) {
    return new Response(JSON.stringify({ error: 'Reset token has expired. Please request a new one.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Hash the new password
  const passwordHash = await hashPassword(data.password);

  // Update user's password
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date().toISOString() })
    .where(eq(users.id, resetRecord.userId));

  // Mark this token as used
  await db
    .update(passwordResets)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(passwordResets.id, resetRecord.id));

  // Delete all other reset tokens for this user
  await db
    .delete(passwordResets)
    .where(
      and(
        eq(passwordResets.userId, resetRecord.userId),
        // Only delete tokens that are not this one (already marked used above)
        // Use isNull(usedAt) to find unused ones, but this one was just marked used
        // So delete all unused ones belonging to this user
        isNull(passwordResets.usedAt),
      ),
    );

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};