export const prerender = false;

import type { APIRoute } from 'astro';
import { getDrizzle } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { UserRole } from '@/lib/types';

const VALID_STATUSES = ['open', 'resolved', 'dismissed', 'all'] as const;

export const GET: APIRoute = async ({ locals, request, url }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  // Mod+ required
  const auth = await requireRole(d1, request, UserRole.Mod);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if ('forbidden' in auth) {
    return new Response(JSON.stringify({ error: 'Insufficient role' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse status filter (default: open)
  const statusParam = url.searchParams.get('status') || 'open';
  if (!VALID_STATUSES.includes(statusParam as any)) {
    return new Response(JSON.stringify({ error: 'Invalid status filter. Use: open, resolved, dismissed, all.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build query with D1 raw SQL for JOIN with users table
  let whereClause = '';
  if (statusParam !== 'all') {
    whereClause = `WHERE cr.status = '${statusParam}'`;
  }

  const { results } = await d1.prepare(`
    SELECT
      cr.id,
      cr.reporter_id,
      cr.target_type,
      cr.target_id,
      cr.reason,
      cr.details,
      cr.status,
      cr.resolver_id,
      cr.resolution,
      cr.created_at,
      cr.resolved_at,
      u.email as reporter_email
    FROM content_reports cr
    JOIN users u ON u.id = cr.reporter_id
    ${whereClause}
    ORDER BY cr.created_at DESC
  `).all<{
    id: number;
    reporter_id: number;
    target_type: string;
    target_id: number;
    reason: string;
    details: string | null;
    status: string;
    resolver_id: number | null;
    resolution: string | null;
    created_at: string;
    resolved_at: string | null;
    reporter_email: string;
  }>();

  return new Response(JSON.stringify({ reports: results ?? [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
};