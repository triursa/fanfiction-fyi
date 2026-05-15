/**
 * Admin Invite Codes API
 * GET  /api/admin/invite-codes — list invite codes (with creator info)
 * POST /api/admin/invite-codes — create invite code(s)
 * Auth: required, admin+ only
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { inviteCodes, users } from '../../../../lib/schema/index';
import { validateBody, createInviteCodeSchema } from '../../../../lib/validation';
import { eq, desc, sql, count } from 'drizzle-orm';

function requireAdmin(user: { role: string }): void {
  if (!['founder', 'admin'].includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  const segments = [];
  for (let s = 0; s < 3; s++) {
    let segment = '';
    for (let i = 0; i < 4; i++) {
      segment += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(segment);
  }
  return segments.join('-');
}

// ─── GET /api/admin/invite-codes ──────────────────────────────────────
export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireAdmin(auth.user);

  const db = getDb(d1);

  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const offset = (page - 1) * limit;

  // Fetch codes with creator info
  const codes = await db
    .select({
      id: inviteCodes.id,
      code: inviteCodes.code,
      createdById: inviteCodes.createdById,
      usedBy: inviteCodes.usedBy,
      createdAt: inviteCodes.createdAt,
      usedAt: inviteCodes.usedAt,
      creatorEmail: users.email,
    })
    .from(inviteCodes)
    .leftJoin(users, eq(inviteCodes.createdById, users.id))
    .orderBy(desc(inviteCodes.createdAt))
    .limit(limit)
    .offset(offset);

  // For used codes, resolve the usedBy user email
  const usedByIds = codes.filter(c => c.usedBy != null).map(c => c.usedBy as number);
  let usedByMap: Record<number, string> = {};
  if (usedByIds.length > 0) {
    const usedByUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(sql`${users.id} IN (${sql.join(usedByIds.map(id => sql`${id}`), sql`, `)})`);
    for (const u of usedByUsers) {
      usedByMap[u.id] = u.email;
    }
  }

  // Also get total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(inviteCodes);

  const data = codes.map(c => ({
    id: c.id,
    code: c.code,
    createdById: c.createdById,
    createdByEmail: c.creatorEmail || null,
    usedBy: c.usedBy,
    usedByEmail: c.usedBy ? usedByMap[c.usedBy] || null : null,
    createdAt: c.createdAt,
    usedAt: c.usedAt,
    status: c.usedBy ? 'used' : 'unused',
  }));

  return new Response(JSON.stringify({ data, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── POST /api/admin/invite-codes ─────────────────────────────────────
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireAdmin(auth.user);

  const db = getDb(d1);

  // Validate body
  const [data, error] = await validateBody(request, createInviteCodeSchema);
  if (error) return error;

  const count = data.count || 1;
  const codes: { id: number; code: string }[] = [];

  for (let i = 0; i < count; i++) {
    const code = generateCode();
    const [result] = await db
      .insert(inviteCodes)
      .values({
        code,
        createdById: auth.user.id,
      })
      .returning({ id: inviteCodes.id, code: inviteCodes.code });
    codes.push(result);
  }

  return new Response(JSON.stringify({ data: codes }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};