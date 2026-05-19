import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth, checkApproved } from '@/v2/lib/auth';

export const config = { auth: 'required' as const };

/**
 * POST /api/admin/rebuild-fts — Rebuild the FTS5 search index from scratch.
 *
 * This is needed after adding FTS5 triggers for the first time, since any
 * works that existed before the triggers were created won't be in the index.
 *
 * Auth: required, admin+ only
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  if (!['founder', 'admin'].includes(auth.user.role)) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: admin access required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    // Clear the FTS index completely using the special delete-all command
    await d1.exec("INSERT INTO works_fts(works_fts, rowid, title, summary) VALUES ('delete-all', 0, '', '')");

    // Re-insert all existing works into the FTS index
    await d1.exec('INSERT INTO works_fts(rowid, title, summary) SELECT id, COALESCE(title, \'\'), COALESCE(summary, \'\') FROM works');

    // Count total works in the index
    const countResult = await d1.prepare('SELECT COUNT(*) as total FROM works').first();

    return new Response(
      JSON.stringify({
        message: 'FTS index rebuilt successfully',
        totalWorks: countResult?.total ?? 0,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('FTS rebuild error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to rebuild FTS index', details: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};