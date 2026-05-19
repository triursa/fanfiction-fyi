import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { hashPassword, createSession, sessionCookie, validateInviteCode, markInviteCodeUsed } from '@/v2/lib/auth';
import { users, pseuds } from '@/v2/lib/schema/index';
import { z } from 'zod';
import { validateBody } from '@/v2/lib/validation';
import { notify } from '@/v2/lib/notify';

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(50).optional(),
  inviteCode: z.string().min(1, 'Invite code is required'),
});

export const config = { auth: 'public' as const };

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Validate request body
  const [data, error] = await validateBody(request, signupSchema);
  if (error) return error;

  // Check invite code
  const inviteResult = await validateInviteCode(d1, data.inviteCode);
  if (!inviteResult.valid) {
    return new Response(JSON.stringify({ error: inviteResult.error }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check if email already exists
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).get();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  // Hash password and create user (unapproved by default — requires admin approval)
  const passwordHash = await hashPassword(data.password);
  const result = await db.insert(users).values({
    email: data.email,
    passwordHash,
    displayName: data.displayName || data.email.split('@')[0],
    approved: 0,
  }).returning({ id: users.id });

  const userId = result[0].id;

  // Mark invite code as used
  await markInviteCodeUsed(d1, data.inviteCode, userId);

  // Create default pseud
  await db.insert(pseuds).values({
    userId,
    name: data.displayName || data.email.split('@')[0],
    isDefault: 1,
  });

  // Notify admins of new signup (pending approval)
  try {
    const admins = await db.select().from(users).where(eq(users.role, 'admin'));
    for (const admin of admins) {
      await notify(d1, admin.id, {
        type: 'user.signup',
        title: 'New signup awaiting approval',
        body: `${data.displayName || data.email.split('@')[0]} (${data.email}) just registered and is awaiting approval.`,
        link: `/admin/users?approved=0`,
      });
    }
    const founders = await db.select().from(users).where(eq(users.role, 'founder'));
    for (const founder of founders) {
      if (!admins.find((a) => a.id === founder.id)) {
        await notify(d1, founder.id, {
          type: 'user.signup',
          title: 'New signup awaiting approval',
          body: `${data.displayName || data.email.split('@')[0]} (${data.email}) just registered and is awaiting approval.`,
          link: `/admin/users?approved=0`,
        });
      }
    }
  } catch { /* notification failure should not break signup */ }

  // Create session (even for unapproved users, so they can reach /pending-approval)
  const token = await createSession(d1, userId);

  return new Response(JSON.stringify({ success: true, userId, approved: 0 }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(token),
    },
  });
};