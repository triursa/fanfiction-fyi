/**
 * Admin Users API
 * GET  /api/admin/users — list users (pagination, role/approval filters)
 * PATCH /api/admin/users — update user (approve, ban, suspend, change role)
 * Auth: required, admin+ only
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth } from '@/v2/lib/auth';
import { getDb } from '@/v2/lib/db';
import { users, inviteCodes } from '@/v2/lib/schema/index';
import { updateUserRoleSchema, suspendUserSchema, validateBody } from '@/v2/lib/validation';
import { logAudit } from '@/v2/lib/audit';
import { eq, and, sql, desc, count } from 'drizzle-orm';

// ─── Admin role check ──────────────────────────────────────────────
function requireAdmin(user: { role: string }): void {
  if (!['founder', 'admin'].includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── GET /api/admin/users ────────────────────────────────────────────
export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireAdmin(auth.user);

  const db = getDb(d1);

  // Query params
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const offset = (page - 1) * limit;
  const roleFilter = url.searchParams.get('role') || '';
  const approvedFilter = url.searchParams.get('approved');
  const bannedFilter = url.searchParams.get('banned');
  const search = url.searchParams.get('search') || '';

  // Build conditions
  const conditions = [];
  if (roleFilter && ['founder', 'admin', 'mod', 'user'].includes(roleFilter)) {
    conditions.push(eq(users.role, roleFilter));
  }
  if (approvedFilter === '0') {
    conditions.push(eq(users.approved, 0));
  } else if (approvedFilter === '1') {
    conditions.push(eq(users.approved, 1));
  }
  if (bannedFilter === '1') {
    conditions.push(eq(users.banned, 1));
  }
  if (search) {
    conditions.push(sql`(${users.email} LIKE ${'%' + search + '%'} OR ${users.displayName} LIKE ${'%' + search + '%'})`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(whereClause);

  // Fetch users (exclude passwordHash)
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      approved: users.approved,
      banned: users.banned,
      suspendedUntil: users.suspendedUntil,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  return new Response(JSON.stringify({ data: userRows, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PATCH /api/admin/users ──────────────────────────────────────────
export const PATCH: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireAdmin(auth.user);

  const db = getDb(d1);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = body.userId;
  if (!userId || typeof userId !== 'number') {
    return new Response(JSON.stringify({ error: 'userId is required' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch the target user
  const targetUser = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!targetUser) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Prevent demoting founders unless actor is founder
  if (targetUser.role === 'founder' && auth.user.role !== 'founder') {
    return new Response(JSON.stringify({ error: 'Cannot modify founder accounts' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Prevent self-demotion
  if (targetUser.id === auth.user.id && body.role && body.role !== auth.user.role) {
    return new Response(JSON.stringify({ error: 'Cannot change your own role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const updateData: Record<string, any> = { updatedAt: new Date().toISOString() };

  // Handle action
  const action = body.action;
  if (action === 'approve') {
    updateData.approved = 1;
  } else if (action === 'ban') {
    updateData.banned = 1;
  } else if (action === 'unban') {
    updateData.banned = 0;
  } else if (action === 'suspend') {
    // Validate suspend payload
    const [suspendData, suspendError] = await validateBody(
      new Request(request.url, { method: 'POST', body: JSON.stringify(body), headers: request.headers }),
      suspendUserSchema,
    );
    // We already parsed body, manually validate
    if (body.until) {
      updateData.suspendedUntil = body.until;
    } else {
      // Default 7-day suspension
      const d = new Date();
      d.setDate(d.getDate() + 7);
      updateData.suspendedUntil = d.toISOString();
    }
    updateData.banned = 0; // Unsuspend if currently banned
    await logAudit(d1, auth.user.id, 'user.suspend', 'user', userId, {
      suspendedUntil: updateData.suspendedUntil,
    });
  } else if (action === 'unsuspend') {
    updateData.suspendedUntil = null;
    await logAudit(d1, auth.user.id, 'user.unsuspend', 'user', userId, {});
  } else if (action === 'changeRole') {
    const [roleData, roleError] = [body, null];
    if (!['founder', 'admin', 'mod', 'user'].includes(body.role)) {
      return new Response(JSON.stringify({ error: 'Invalid role' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Only founders can assign founder/admin roles
    if (['founder', 'admin'].includes(body.role) && auth.user.role !== 'founder') {
      return new Response(JSON.stringify({ error: 'Only founders can assign this role' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    updateData.role = body.role;
    await logAudit(d1, auth.user.id, 'user.role_change', 'user', userId, {
      oldRole: targetUser.role,
      newRole: body.role,
    });
  } else {
    return new Response(JSON.stringify({ error: 'Invalid action. Use: approve, ban, unban, suspend, unsuspend, changeRole' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await db.update(users).set(updateData).where(eq(users.id, userId));

  // Return updated user (excluding password)
  const updated = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    role: users.role,
    approved: users.approved,
    banned: users.banned,
    suspendedUntil: users.suspendedUntil,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
  }).from(users).where(eq(users.id, userId)).get();

  return new Response(JSON.stringify({ data: updated }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};