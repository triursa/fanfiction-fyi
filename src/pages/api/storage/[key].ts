import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';

export const config = { auth: 'public' as const };

/**
 * GET /api/storage/[key] — Serve images from R2 storage.
 *
 * The key is a path like "avatars/abc123.jpg" or "works/def456.png".
 * Returns the image with appropriate Content-Type, caching headers,
 * and CORS headers for cross-origin image loading.
 *
 * This is the public-facing CDN route that makes uploaded images accessible.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const key = params.key;

  if (!key) {
    return new Response('Missing key', { status: 400 });
  }

  // Prevent path traversal — only allow known prefixes
  const allowedPrefixes = ['avatars/', 'works/', 'pseuds/', 'collections/', 'canon/'];
  const hasAllowedPrefix = allowedPrefixes.some((prefix) => key.startsWith(prefix));
  if (!hasAllowedPrefix) {
    return new Response('Forbidden: invalid key prefix', { status: 403 });
  }

  // Prevent directory traversal attacks
  if (key.includes('..') || key.startsWith('/')) {
    return new Response('Forbidden: invalid key', { status: 403 });
  }

  const bucket = locals.runtime.env.MEDIA as R2Bucket;
  if (!bucket) {
    console.error('R2 MEDIA bucket not bound');
    return new Response('Storage not configured', { status: 500 });
  }

  const object = await bucket.get(key);

  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  // Determine content type from the key extension as fallback
  const ext = key.split('.').pop()?.toLowerCase();
  const contentTypeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
  };

  const contentType =
    object.httpMetadata?.contentType
    || contentTypeMap[ext || '']
    || 'application/octet-stream';

  // Cache publicly for 30 days (images are immutable — key contains UUID)
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=2592000, immutable');
  headers.set('ETag', object.etag);
  headers.set('Access-Control-Allow-Origin', '*');

  if (object.httpMetadata?.cacheControl) {
    headers.set('Cache-Control', object.httpMetadata.cacheControl);
  }

  return new Response(object.body, { status: 200, headers });
};