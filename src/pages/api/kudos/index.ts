import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved, getAuth } from '@/v2/lib/auth';
import { kudos, pseuds, works, creatorships } from '@/v2/lib/schema/index';
import { eq, count } from 'drizzle-orm';
import { notify } from '@/v2/lib/notify';

export const config = { auth: 'optional' as const };

// GET /api/kudos?workId=X — Get kudos count for a work
export const GET: APIRoute = async ({ url, locals }) => {
  const workId = Number(url.searchParams.get('workId'));
  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'workId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const [{ value: total }] = await db.select({ value: count() }).from(kudos).where(eq(kudos.workId, workId));

  return new Response(JSON.stringify({ data: { kudos: total } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/kudos — Toggle kudos (give or remove)
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const body = await request.json() as { workId: number };
  const workId = body.workId;
  if (!workId || isNaN(workId)) {
    return new Response(JSON.stringify({ error: 'workId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const defaultPseud = await db.select().from(pseuds).where(eq(pseuds.userId, auth.user.id)).get();

  // Check if already given
  const existing = await db.select().from(kudos)
    .where(eq(kudos.workId, workId) /* AND pseud */).get();

  if (existing) {
    await db.delete(kudos).where(eq(kudos.id, existing.id));
    return new Response(JSON.stringify({ data: { kudosGiven: false } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  await db.insert(kudos).values({ workId, pseudId: defaultPseud!.id });

  // Notify work owner of new kudos
  try {
    const work = await db.select().from(works).where(eq(works.id, workId)).get();
    if (work) {
      const creatorLinks = await db.select({ pseudId: creatorships.pseudId })
        .from(creatorships)
        .where(eq(creatorships.workId, workId));
      for (const link of creatorLinks) {
        const pseud = await db.select({ userId: pseuds.userId })
          .from(pseuds)
          .where(eq(pseuds.id, link.pseudId))
          .get();
        if (pseud && pseud.userId !== auth.user.id) {
          await notify(d1, pseud.userId, {
            type: 'kudos',
            title: 'New kudos on your work',
            body: `Someone left kudos on "${work.title}"`,
            link: `/works/${workId}`,
          });
        }
      }
    }
  } catch { /* notification failure should not break kudos creation */ }

  return new Response(JSON.stringify({ data: { kudosGiven: true } }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
};
