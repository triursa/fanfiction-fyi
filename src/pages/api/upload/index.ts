import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth, checkApproved } from '@/v2/lib/auth';
import { uploadImage, deleteImage } from '@/v2/lib/storage';

export const config = { auth: 'required' as const };

/**
 * POST /api/upload — Upload an image to R2 storage.
 *
 * Accepts multipart/form-data with a `file` field.
 * Query params:
 *   ?prefix=works  — Key prefix (avatars|works|pseuds|collections|canon), default: works
 *
 * Returns: { data: { key, url, contentType, size } }
 */
export const POST: APIRoute = async ({ request, url, locals }) => {
  const prefix = url.searchParams.get('prefix') || 'works';
  const allowedPrefixes = ['avatars', 'works', 'pseuds', 'collections', 'canon'];
  if (!allowedPrefixes.includes(prefix)) {
    return new Response(
      JSON.stringify({ error: 'Invalid prefix', allowed: allowedPrefixes }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const bucket = locals.runtime.env.MEDIA as R2Bucket;
  if (!bucket) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return new Response(
      JSON.stringify({ error: 'No file provided. Use multipart/form-data with a "file" field.' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const result = await uploadImage(bucket, prefix, file);
    return new Response(
      JSON.stringify({ data: result }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    // uploadImage throws Response for validation errors
    if (err instanceof Response) return err;
    console.error('Upload error:', err);
    return new Response(
      JSON.stringify({ error: 'Upload failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};

/**
 * DELETE /api/upload — Delete an image from R2 storage.
 *
 * Body: { key: string } — The R2 key to delete.
 * Only the owner or an admin can delete an image.
 */
export const DELETE: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  checkApproved(auth);

  const bucket = locals.runtime.env.MEDIA as R2Bucket;
  if (!bucket) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!body.key) {
    return new Response(
      JSON.stringify({ error: 'Missing key' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Prevent deleting arbitrary keys — same prefix allowlist
  const allowedPrefixes = ['avatars/', 'works/', 'pseuds/', 'collections/', 'canon/'];
  const hasAllowedPrefix = allowedPrefixes.some((p) => body.key!.startsWith(p));
  if (!hasAllowedPrefix || body.key!.includes('..') || body.key!.startsWith('/')) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: invalid key' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    await deleteImage(bucket, body.key);
    return new Response(
      JSON.stringify({ data: { deleted: true } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Delete error:', err);
    return new Response(
      JSON.stringify({ error: 'Delete failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};