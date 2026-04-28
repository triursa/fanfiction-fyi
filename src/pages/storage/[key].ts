export const prerender = false;

import type { APIRoute } from 'astro';

/**
 * GET /storage/[key] — redirect to /api/storage/[key]
 * Backwards-compatible: character pages already use /storage/ URLs.
 */
export const GET: APIRoute = async ({ params }) => {
  if (!params.key) return new Response('Not found', { status: 404 });
  return new Response(null, {
    status: 301,
    headers: { Location: '/api/storage/' + params.key },
  });
};