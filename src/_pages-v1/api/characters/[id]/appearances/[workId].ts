export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { characterAppearances } from '@/lib/schema';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

// DELETE /api/characters/[id]/appearances/[workId] — Remove character from a work
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const id = Number(params.id);
  const workId = Number(params.workId);
  if (!id || !workId) return new Response(JSON.stringify({ error: 'Invalid IDs' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const existing = await drz
    .select()
    .from(characterAppearances)
    .where(and(eq(characterAppearances.characterId, id), eq(characterAppearances.workId, workId)))
    .get();
  if (!existing) return new Response(JSON.stringify({ error: 'Appearance not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Permission: the person who added it, or admin/mod
  const isAdder = existing.addedBy && auth.pseuds.some(p => p.id === existing.addedBy);
  const isPrivileged = ['admin', 'mod', 'founder'].includes(auth.user.role);
  if (!isAdder && !isPrivileged) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await drz.delete(characterAppearances).where(and(eq(characterAppearances.characterId, id), eq(characterAppearances.workId, workId)));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};