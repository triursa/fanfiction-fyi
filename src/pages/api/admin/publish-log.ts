export const prerender = false;
import { getDrizzle } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { publishLog } from '@/lib/schema/publish-log';
import { eq, desc } from 'drizzle-orm';
import type { APIRoute } from 'astro';
import { UserRole } from '@/lib/types';

export const GET: APIRoute = async ({ request, locals, url }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireRole(d1, request, UserRole.Admin);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if ('forbidden' in auth) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  const db = getDrizzle(d1);
  const workId = url.searchParams.get('work_id');
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);

  let query = db.select().from(publishLog).orderBy(desc(publishLog.createdAt)).limit(limit);
  if (workId) {
    query = db.select().from(publishLog).where(eq(publishLog.workId, Number(workId))).orderBy(desc(publishLog.createdAt)).limit(limit);
  }

  const logs = await query;
  return new Response(JSON.stringify({ logs }), { headers: { 'Content-Type': 'application/json' } });
};