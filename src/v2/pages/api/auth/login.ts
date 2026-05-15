import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../lib/db';
import { verifyPassword, createSession, sessionCookie, getAuth } from '../../../lib/auth';
import { users } from '../../../lib/schema/index';
import { z } from 'zod';
import { validateBody } from '../../../lib/validation';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const config = { auth: 'public' as const };

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Validate request body
  const [data, error] = await validateBody(request, loginSchema);
  if (error) return error;

  // Find user by email
  const user = await db.select().from(users).where(eq(users.email, data.email)).get();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify password
  const valid = await verifyPassword(data.password, user.passwordHash);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // Check if banned
  if (user.banned) {
    return new Response(JSON.stringify({ error: 'Account suspended' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Create session
  const token = await createSession(d1, user.id);

  return new Response(JSON.stringify({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      approved: user.approved,
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token),
    },
  });
};
