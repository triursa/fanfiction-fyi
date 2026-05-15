import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../lib/db';
import { requireAuth, checkApproved } from '../../../../lib/auth';
import { validateBody, addSeriesWorkSchema, removeSeriesWorkSchema, reorderSeriesWorksSchema } from '../../../../lib/validation';
import { series, serialWorks, pseuds, works } from '../../../../lib/schema/index';
import { eq, and, desc, sql, max } from 'drizzle-orm';

export const config = { auth: 'required' as const };

// ─── Helper: verify series ownership ─────────────────────────────────

async function verifySeriesOwnership(db: any, seriesId: number, userId: number): Promise<{ owned: boolean; seriesRow?: any }> {
  const seriesRow = await db.select().from(series).where(eq(series.id, seriesId)).get();
  if (!seriesRow) return { owned: false };

  const userPseuds = await db.select({ id: pseuds.id }).from(pseuds).where(eq(pseuds.userId, userId));
  const pseudIds = userPseuds.map((p: any) => p.id);

  return { owned: pseudIds.includes(seriesRow.creatorPseudId), seriesRow };
}

// ─── POST /api/series/[id]/works — Add work to series ──────────────

export const POST: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const seriesId = Number(params?.id);

  if (!seriesId || Number.isNaN(seriesId)) {
    return new Response(JSON.stringify({ error: 'Invalid series ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, addSeriesWorkSchema);
  if (error) return error;

  // Verify series exists and user owns it
  const { owned, seriesRow } = await verifySeriesOwnership(db, seriesId, auth.user.id);
  if (!seriesRow) {
    return new Response(JSON.stringify({ error: 'Series not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!owned) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the series owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the work exists and is published
  const work = await db
    .select({ id: works.id, draft: works.draft, publishedAt: works.publishedAt })
    .from(works)
    .where(eq(works.id, data.workId))
    .get();

  if (!work || work.draft || !work.publishedAt) {
    return new Response(JSON.stringify({ error: 'Work not found or not published' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for duplicate
  const existing = await db
    .select({ id: serialWorks.id })
    .from(serialWorks)
    .where(and(
      eq(serialWorks.seriesId, seriesId),
      eq(serialWorks.workId, data.workId),
    ))
    .get();

  if (existing) {
    return new Response(JSON.stringify({ error: 'Work already in series' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Determine position: use provided position or max(position)+1
  let position = data.position;
  if (position === undefined) {
    const maxResult = await db
      .select({ maxPos: max(serialWorks.position) })
      .from(serialWorks)
      .where(eq(serialWorks.seriesId, seriesId))
      .get();
    position = (maxResult?.maxPos ?? 0) + 1;
  }

  // Add the work to the series
  const [inserted] = await db
    .insert(serialWorks)
    .values({
      seriesId,
      workId: data.workId,
      position,
    })
    .returning();

  return new Response(JSON.stringify({
    data: {
      id: inserted.id,
      seriesId: inserted.seriesId,
      workId: inserted.workId,
      position: inserted.position,
    },
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/series/[id]/works — Remove work from series ───────

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const seriesId = Number(params?.id);

  if (!seriesId || Number.isNaN(seriesId)) {
    return new Response(JSON.stringify({ error: 'Invalid series ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, removeSeriesWorkSchema);
  if (error) return error;

  // Verify series exists and user owns it
  const { owned, seriesRow } = await verifySeriesOwnership(db, seriesId, auth.user.id);
  if (!seriesRow) {
    return new Response(JSON.stringify({ error: 'Series not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!owned) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the series owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete the serialWorks entry
  const result = await db
    .delete(serialWorks)
    .where(and(
      eq(serialWorks.seriesId, seriesId),
      eq(serialWorks.workId, data.workId),
    ));

  return new Response(JSON.stringify({ data: { seriesId, workId: data.workId, removed: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PATCH /api/series/[id]/works — Reorder works in series ────────

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const seriesId = Number(params?.id);

  if (!seriesId || Number.isNaN(seriesId)) {
    return new Response(JSON.stringify({ error: 'Invalid series ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth + approved
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Validate body
  const [data, error] = await validateBody(request, reorderSeriesWorksSchema);
  if (error) return error;

  // Verify series exists and user owns it
  const { owned, seriesRow } = await verifySeriesOwnership(db, seriesId, auth.user.id);
  if (!seriesRow) {
    return new Response(JSON.stringify({ error: 'Series not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!owned) {
    return new Response(JSON.stringify({ error: 'Forbidden: not the series owner' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate that all workIds exist in this series
  const workIds = data.positions.map(p => p.workId);
  const existingEntries = await db
    .select({ workId: serialWorks.workId })
    .from(serialWorks)
    .where(eq(serialWorks.seriesId, seriesId));

  const existingWorkIds = new Set(existingEntries.map((e: any) => e.workId));
  for (const workId of workIds) {
    if (!existingWorkIds.has(workId)) {
      return new Response(JSON.stringify({ error: `Work ${workId} is not in this series` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Sort the provided positions by position value, then re-index to contiguous starting from 1
  const sorted = [...data.positions].sort((a, b) => a.position - b.position);

  // Update positions to contiguous values starting from 1
  for (let i = 0; i < sorted.length; i++) {
    await db
      .update(serialWorks)
      .set({ position: i + 1 })
      .where(and(
        eq(serialWorks.seriesId, seriesId),
        eq(serialWorks.workId, sorted[i].workId),
      ));
  }

  // Re-index any works NOT in the positions list — assign them positions after the explicitly-ordered ones
  const remainingEntries = existingEntries.filter((e: any) => !workIds.includes(e.workId));
  // These keep their existing relative order, appended after the explicitly positioned ones
  // Start position after the explicitly ordered ones
  let nextPos = sorted.length + 1;
  for (const entry of remainingEntries) {
    await db
      .update(serialWorks)
      .set({ position: nextPos })
      .where(and(
        eq(serialWorks.seriesId, seriesId),
        eq(serialWorks.workId, entry.workId),
      ));
    nextPos++;
  }

  return new Response(JSON.stringify({ data: { seriesId, reordered: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};