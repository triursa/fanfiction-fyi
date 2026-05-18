import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { users, passwordResets } from '@/v2/lib/schema/index';
import { z } from 'zod';
import { validateBody } from '@/v2/lib/validation';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const config = { auth: 'public' as const };

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Validate request body
  const [data, error] = await validateBody(request, forgotPasswordSchema);
  if (error) return error;

  // Always return success even if email not found (security best practice)
  const user = await db.select().from(users).where(eq(users.email, data.email)).get();
  if (!user) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate secure token using Web Crypto API (Cloudflare Workers compatible)
  const tokenBuffer = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(tokenBuffer).map(b => b.toString(16).padStart(2, '0')).join('');

  // Set expiry to 1 hour from now
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // Insert reset token
  await db.insert(passwordResets).values({
    userId: user.id,
    token,
    expiresAt,
  });

  // TODO: Send email with reset link. For now, log the reset URL.
  // In production, this should use a Cloudflare-compatible email service (e.g. Workers Send Email, Mailgun, Resend).
  const resetUrl = `https://fanfiction.fyi/reset-password?token=${token}`;
  console.log(`[PASSWORD RESET] Reset URL for ${data.email}: ${resetUrl}`);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};