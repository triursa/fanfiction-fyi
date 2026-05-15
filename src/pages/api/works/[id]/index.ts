import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { getAuth, requireAuth, checkApproved } from '@/v2/lib/auth';
import { validateBody, validateQuery, updateWorkSchema } from '@/v2/lib/validation';
import { works, chapters, tags, taggings, creatorships, pseuds, kudos } from '@/v2/lib/schema/index';
import { eq, and, count, sql } from 'drizzle-orm';

export const config = { auth: 'optional' as const };

// ─── GET /api/works/[id] — Single work detail ──────────────────────

export const GET: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const workId = Number(params?.id);

  if (!workId || Number.isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const work = await db.select().from(works).where(eq(works.id, workId)).get();

  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Draft works are only visible to their authors
  if (work.draft) {
    const auth = await getAuth(d1, request);
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Work not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Check if the authenticated user is an author of this work
    const creatorship = await db
      .select()
      .from(creatorships)
      .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
      .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
      .get();

    if (!creatorship) {
      return new Response(JSON.stringify({ error: 'Work not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Fetch authors
  const authorRows = await db
    .select({
      pseudId: pseuds.id,
      name: pseuds.name,
      role: creatorships.role,
      userId: pseuds.userId,
    })
    .from(creatorships)
    .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
    .where(eq(creatorships.workId, workId));

  // Fetch tags
  const tagRows = await db
    .select({
      id: tags.id,
      name: tags.name,
      type: tags.type,
    })
    .from(taggings)
    .innerJoin(tags, eq(taggings.tagId, tags.id))
    .where(eq(taggings.workId, workId));

  // Fetch chapter count
  const [{ chapterCount }] = await db
    .select({ chapterCount: count() })
    .from(chapters)
    .where(eq(chapters.workId, workId));

  // Fetch kudos count
  const [{ kudosCount }] = await db
    .select({ kudosCount: count() })
    .from(kudos)
    .where(eq(kudos.workId, workId));

  return new Response(JSON.stringify({
    data: {
      ...work,
      authors: authorRows.map(a => ({ pseudId: a.pseudId, name: a.name, role: a.role })),
      tags: tagRows,
      chapterCount,
      kudosCount,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── PUT /api/works/[id] — Update work ────────────────────────────

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const workId = Number(params?.id);

  if (!workId || Number.isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify work exists
  const work = await db.select().from(works).where(eq(works.id, workId)).get();
  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify user is an author via creatorships
  const creatorship = await db
    .select()
    .from(creatorships)
    .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
    .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
    .get();

  if (!creatorship) {
    return new Response(JSON.stringify({ error: 'You are not an author of this work' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate body
  const [data, error] = await validateBody(request, updateWorkSchema);
  if (error) return error;

  // Build update object — only include fields that are present
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.summary !== undefined) updates.summary = data.summary;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.endNotes !== undefined) updates.endNotes = data.endNotes;
  if (data.language !== undefined) updates.language = data.language;
  if (data.workSkin !== undefined) updates.workSkin = data.workSkin;
  if (data.complete !== undefined) updates.complete = data.complete ? 1 : 0;
  if (data.draft !== undefined) {
    updates.draft = data.draft ? 1 : 0;
    // When publishing for the first time, set publishedAt
    if (!data.draft && work.draft && !work.publishedAt) {
      updates.publishedAt = new Date().toISOString();
    }
  }

  // Update the work
  await db.update(works).set(updates).where(eq(works.id, workId));

  // Handle tag updates if tags array is provided
  if (data.tags && Array.isArray(data.tags)) {
    // Resolve tags
    const resolvedTags: { id: number; type: string; name: string }[] = [];
    for (const tagInput of data.tags) {
      if (tagInput.id) {
        const existing = await db.select().from(tags).where(eq(tags.id, tagInput.id)).get();
        if (existing) {
          resolvedTags.push({ id: existing.id, type: existing.type, name: existing.name });
        }
      } else {
        const existing = await db
          .select()
          .from(tags)
          .where(and(eq(tags.name, tagInput.name), eq(tags.type, tagInput.type)))
          .get();
        if (existing) {
          resolvedTags.push({ id: existing.id, type: existing.type, name: existing.name });
        } else {
          const [created] = await db
            .insert(tags)
            .values({ name: tagInput.name, type: tagInput.type })
            .returning({ id: tags.id, type: tags.type, name: tags.name });
          resolvedTags.push(created);
        }
      }
    }

    // Remove existing taggings and insert new ones
    await db.delete(taggings).where(eq(taggings.workId, workId));
    if (resolvedTags.length > 0) {
      await db.insert(taggings).values(
        resolvedTags.map(tag => ({ tagId: tag.id, workId }))
      );
    }
  }

  // Fetch updated work
  const updatedWork = await db.select().from(works).where(eq(works.id, workId)).get();

  // Fetch current authors (may have changed if pseudId was updated)
  const authorRows = await db
    .select({ pseudId: pseuds.id, name: pseuds.name, role: creatorships.role })
    .from(creatorships)
    .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
    .where(eq(creatorships.workId, workId));

  // Fetch current tags
  const tagRows = await db
    .select({ id: tags.id, name: tags.name, type: tags.type })
    .from(taggings)
    .innerJoin(tags, eq(taggings.tagId, tags.id))
    .where(eq(taggings.workId, workId));

  return new Response(JSON.stringify({
    data: {
      ...updatedWork,
      authors: authorRows,
      tags: tagRows,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/works/[id] — Soft-delete (set draft=1) ─────────────

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const workId = Number(params?.id);

  if (!workId || Number.isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'Invalid work ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require auth
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  // Verify work exists
  const work = await db.select().from(works).where(eq(works.id, workId)).get();
  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify user is an author
  const creatorship = await db
    .select()
    .from(creatorships)
    .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
    .where(and(eq(creatorships.workId, workId), eq(pseuds.userId, auth.user.id)))
    .get();

  if (!creatorship) {
    return new Response(JSON.stringify({ error: 'You are not an author of this work' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Soft-delete: set draft=1
  await db
    .update(works)
    .set({ draft: 1, updatedAt: new Date().toISOString() })
    .where(eq(works.id, workId));

  return new Response(JSON.stringify({ data: { id: workId, deleted: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};