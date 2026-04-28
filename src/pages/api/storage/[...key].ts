export const prerender = false;

import type { APIRoute } from 'astro';

/**
 * GET /api/storage/[...key] — proxy R2 object reads
 * Serves uploaded images (avatars, pseud icons, chapter images) from R2 with proper caching.
 * Key format: 
 *   avatars/{userId}/{timestamp}-{random}.{ext}
 *   pseuds/{pseudId}/{timestamp}-{random}.{ext}
 *   chapters/{workId}/{timestamp}-{random}.{ext}
 * Uses rest params to handle keys that contain slashes.
 */
export const GET: APIRoute = async ({ locals, params }) => {
  const bucket = locals.runtime.env.MEDIA as R2Bucket;
  // params.key is an array for rest params [...key]
  const key = Array.isArray(params.key) ? params.key.join('/') : params.key;

  if (!key) {
    return new Response('Not found', { status: 404 });
  }

  // Security: only allow known prefixes
  if (!key.startsWith('avatars/') && !key.startsWith('pseuds/') && !key.startsWith('chapters/')) {
    return new Response('Forbidden', { status: 403 });
  }

  // Security: prevent path traversal
  if (key.includes('..')) {
    return new Response('Forbidden', { status: 403 });
  }

  const object = await bucket.get(key);

  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(object.body, { headers });
};