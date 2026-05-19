import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { chapters } from '@/v2/lib/schema/index';
import { isNull, isNotNull, sql } from 'drizzle-orm';
import { renderMarkdown } from '@/v2/lib/markdown';

export const config = { auth: 'required' as const };

/**
 * POST /api/admin/backfill-content-html
 *
 * Backfill contentHtml from contentMd for all chapters where contentHtml is NULL.
 * Works in batches to avoid D1 timeout limits.
 *
 * Query params:
 *   ?batchSize=50  — Number of chapters to process per request (default: 50)
 *   ?dryRun=true    — Return count of chapters to be updated without making changes
 */
export const POST: APIRoute = async ({ url, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Verify admin
  const auth = await requireAuth(d1, request);
  if (auth.user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const batchSize = Math.min(Math.max(Number(url.searchParams.get('batchSize')) || 50, 1), 200);
  const dryRun = url.searchParams.get('dryRun') === 'true';

  // Find chapters with contentMd but no contentHtml
  const chaptersToUpdate = await db
    .select({
      id: chapters.id,
      contentMd: chapters.contentMd,
    })
    .from(chapters)
    .where(sql`${chapters.contentMd} IS NOT NULL AND ${chapters.contentHtml} IS NULL`)
    .limit(batchSize);

  if (dryRun) {
    return new Response(JSON.stringify({
      message: 'Dry run — no changes made',
      chaptersToUpdate: chaptersToUpdate.length,
      totalQueued: chaptersToUpdate.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let updated = 0;
  let errors = 0;

  for (const chapter of chaptersToUpdate) {
    try {
      const contentHtml = renderMarkdown(chapter.contentMd!);
      await db
        .update(chapters)
        .set({ contentHtml })
        .where(sql`${chapters.id} = ${chapter.id}`);
      updated++;
    } catch (err) {
      console.error(`Failed to backfill chapter ${chapter.id}:`, err);
      errors++;
    }
  }

  // Count remaining chapters that still need backfill
  const remaining = await db
    .select({ count: sql<number>`count(*)` })
    .from(chapters)
    .where(sql`${chapters.contentMd} IS NOT NULL AND ${chapters.contentHtml} IS NULL`);

  return new Response(JSON.stringify({
    message: 'Backfill complete',
    updated,
    errors,
    remaining: remaining[0]?.count ?? 0,
    batchSize,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};