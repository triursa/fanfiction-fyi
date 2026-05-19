import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../../../../../../../lib/db';
import { requireAuth, checkApproved } from '../../../../../../../lib/auth';
import { chapters, chapterVersions, creatorships, pseuds } from '../../../../../../../lib/schema/index';
import { eq, and, desc, sql } from 'drizzle-orm';

export const config = { auth: 'public' as const };

// GET /api/works/:id/chapters/:chapterId/versions — List versions or get a specific version
export const GET: APIRoute = async ({ params, url, locals, request }) => {
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId || isNaN(workId) || isNaN(chapterId)) {
    return new Response(JSON.stringify({ error: 'Invalid IDs' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);

  // Verify chapter belongs to work
  const chapter = await db.select().from(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId))).get();
  if (!chapter) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // If ?id=X is specified, return a single version with full content
  const versionIdParam = url.searchParams.get('id');
  if (versionIdParam) {
    const versionId = Number(versionIdParam);
    if (!versionId || isNaN(versionId)) {
      return new Response(JSON.stringify({ error: 'Invalid version ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const version = await db.select().from(chapterVersions)
      .where(and(eq(chapterVersions.id, versionId), eq(chapterVersions.chapterId, chapterId)))
      .get();

    if (!version) {
      return new Response(JSON.stringify({ error: 'Version not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const wordCount = version.contentMd ? version.contentMd.split(/\s+/).filter(Boolean).length : 0;

    return new Response(JSON.stringify({
      data: {
        id: version.id,
        version: version.version,
        contentMd: version.contentMd,
        contentHtml: version.contentHtml,
        note: version.note,
        createdAt: version.createdAt,
        wordCount,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // List all versions (lightweight — no full content)
  const versions = await db.select({
    id: chapterVersions.id,
    version: chapterVersions.version,
    note: chapterVersions.note,
    contentMd: chapterVersions.contentMd,
    createdAt: chapterVersions.createdAt,
  }).from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.version));

  const list = versions.map(v => {
    const wordCount = v.contentMd ? v.contentMd.split(/\s+/).filter(Boolean).length : 0;
    return {
      id: v.id,
      version: v.version,
      note: v.note,
      createdAt: v.createdAt,
      wordCount,
    };
  });

  return new Response(JSON.stringify({ data: list }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/works/:id/chapters/:chapterId/versions — Restore a specific version
export const POST: APIRoute = async ({ params, request, locals }) => {
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId || isNaN(workId) || isNaN(chapterId)) {
    return new Response(JSON.stringify({ error: 'Invalid IDs' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify authorship
  const userPseuds = await db.select().from(pseuds).where(eq(pseuds.userId, auth.user.id));
  const pseudIds = userPseuds.map(p => p.id);
  const isAuthor = pseudIds.length > 0 && await db.select().from(creatorships)
    .where(and(eq(creatorships.workId, workId)))
    .then(rows => rows.some(c => pseudIds.includes(c.pseudId)));

  if (!isAuthor) {
    return new Response(JSON.stringify({ error: 'Not an author of this work' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Parse body
  let body: { versionId?: number };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const versionId = body.versionId;
  if (!versionId || typeof versionId !== 'number') {
    return new Response(JSON.stringify({ error: 'versionId is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Get the current chapter content
  const currentChapter = await db.select().from(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId))).get();
  if (!currentChapter) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Get the version to restore
  const versionToRestore = await db.select().from(chapterVersions)
    .where(and(eq(chapterVersions.id, versionId), eq(chapterVersions.chapterId, chapterId)))
    .get();
  if (!versionToRestore) {
    return new Response(JSON.stringify({ error: 'Version not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Save current content as a new version before restoring
  const maxVersionRow = await db.select({ maxVer: sql<number>`COALESCE(MAX(${chapterVersions.version}), 0)` })
    .from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .get();
  const nextVersion = (maxVersionRow?.maxVer ?? 0) + 1;

  await db.insert(chapterVersions).values({
    chapterId,
    version: nextVersion,
    contentMd: currentChapter.contentMd,
    contentHtml: currentChapter.contentHtml,
    note: `Auto-saved before restoring version ${versionToRestore.version}`,
  });

  // Restore the version's content back to the chapter
  const wordCount = versionToRestore.contentMd ? versionToRestore.contentMd.split(/\s+/).filter(Boolean).length : 0;
  const updated = await db.update(chapters).set({
    contentMd: versionToRestore.contentMd,
    contentHtml: versionToRestore.contentHtml,
    wordCount,
    updatedAt: new Date().toISOString(),
  }).where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId))).returning();

  if (!updated.length) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    data: updated[0],
    restoredFrom: { id: versionToRestore.id, version: versionToRestore.version },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};