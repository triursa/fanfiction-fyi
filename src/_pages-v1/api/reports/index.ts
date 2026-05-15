export const prerender = false;

import type { APIRoute } from 'astro';
import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { contentReports, works, comments } from '@/lib/schema';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';
import { eq, and, gte, sql } from 'drizzle-orm';

const VALID_TARGET_TYPES = ['work', 'comment'] as const;
const VALID_REASONS = ['harassment', 'spam', 'copyright', 'graphic', 'other'] as const;

export const POST: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  // Auth required
  const auth = await requireAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: 5 reports per hour per user
  const rlKey = `report:${auth.user.id}`;
  const rl = await checkRateLimit(d1, rlKey, 'report');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rl.retryAfterSeconds),
      },
    });
  }

  // Parse body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { target_type, target_id, reason, details } = body;

  // Validate target_type
  if (!target_type || !VALID_TARGET_TYPES.includes(target_type)) {
    return new Response(JSON.stringify({ error: 'Invalid target_type. Must be "work" or "comment".' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate target_id
  if (!target_id || typeof target_id !== 'number' || !Number.isInteger(target_id)) {
    return new Response(JSON.stringify({ error: 'Invalid target_id. Must be an integer.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate reason
  if (!reason || !VALID_REASONS.includes(reason)) {
    return new Response(JSON.stringify({ error: 'Invalid reason. Must be one of: harassment, spam, copyright, graphic, other.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate target exists
  if (target_type === 'work') {
    const work = await db.select({ id: works.id }).from(works).where(eq(works.id, target_id)).get();
    if (!work) {
      return new Response(JSON.stringify({ error: 'Work not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else if (target_type === 'comment') {
    const comment = await db.select({ id: comments.id }).from(comments).where(eq(comments.id, target_id)).get();
    if (!comment) {
      return new Response(JSON.stringify({ error: 'Comment not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Check for duplicate report (same reporter, same target, still open)
  const existing = await db.select({ id: contentReports.id })
    .from(contentReports)
    .where(and(
      eq(contentReports.reporterId, auth.user.id),
      eq(contentReports.targetType, target_type),
      eq(contentReports.targetId, target_id),
      eq(contentReports.status, 'open'),
    ))
    .get();

  if (existing) {
    return new Response(JSON.stringify({ error: 'You have already reported this content and it is still under review.' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Record rate limit attempt
  await recordFailedAttempt(d1, rlKey, 'report');

  // Insert report
  const result = await db.insert(contentReports).values({
    reporterId: auth.user.id,
    targetType: target_type,
    targetId: target_id,
    reason,
    details: details || null,
  }).returning().get();

  // Return as snake_case
  const report = {
    id: result.id,
    reporter_id: result.reporterId,
    target_type: result.targetType,
    target_id: result.targetId,
    reason: result.reason,
    details: result.details,
    status: result.status,
    resolver_id: result.resolverId,
    resolution: result.resolution,
    created_at: result.createdAt,
    resolved_at: result.resolvedAt,
  };

  return new Response(JSON.stringify(report), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};