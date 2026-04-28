export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '@/lib/auth';
import { queryFirst, run } from '@/lib/db';
import { uploadImage, deleteImage, parseMultipart, UploadError } from '@/lib/storage';

/**
 * POST /api/upload — upload an image for user avatar or pseud icon
 * 
 * Accepts multipart/form-data with:
 *   - file: the image file (gif/png/jpg/webp, max 5MB)
 *   - type: "avatar" | "pseud"
 *   - id: (for pseud type) the pseud ID
 * 
 * Returns: { key: string, url: string }
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const bucket = locals.runtime.env.MEDIA as R2Bucket;
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let files: Map<string, { data: ArrayBuffer; type: string; size: number; filename: string }>;
  let fields: Map<string, string>;

  try {
    const parsed = await parseMultipart(request);
    files = parsed.files;
    fields = parsed.fields;
  } catch (e: any) {
    const status = e instanceof UploadError ? e.status : 400;
    return new Response(JSON.stringify({ error: e.message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = files.get('file');
  if (!file) {
    return new Response(JSON.stringify({ error: 'No file provided. Use "file" field name.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const type = fields.get('type');
  if (!type || (type !== 'avatar' && type !== 'pseud')) {
    return new Response(JSON.stringify({ error: 'Invalid type. Must be "avatar" or "pseud".' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (type === 'avatar') {
      // Upload user avatar
      // Get old avatar_key to clean up
      const user = await queryFirst<any>(db, 'SELECT avatar_key FROM users WHERE id = ?', auth.user.id);
      const oldKey = user?.avatar_key;

      const result = await uploadImage(bucket, 'avatars', auth.user.id, {
        arrayBuffer: async () => file.data,
        type: file.type,
        size: file.size,
      });

      // Update DB
      await run(db, "UPDATE users SET avatar_key = ?, updated_at = datetime('now') WHERE id = ?", result.key, auth.user.id);

      // Clean up old avatar from R2 (async, don't block response)
      if (oldKey) {
        // Use waitUntil pattern would be ideal, but for simplicity delete inline
        await deleteImage(bucket, oldKey).catch(() => {});
      }

      return new Response(JSON.stringify({ key: result.key, url: `/api/storage/${result.key}` }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (type === 'pseud') {
      const pseudIdStr = fields.get('id');
      if (!pseudIdStr) {
        return new Response(JSON.stringify({ error: 'Pseud ID required for pseud uploads.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const pseudId = parseInt(pseudIdStr, 10);
      if (isNaN(pseudId)) {
        return new Response(JSON.stringify({ error: 'Invalid pseud ID.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Verify pseud ownership
      const pseud = await queryFirst<any>(db, 'SELECT icon_key FROM pseuds WHERE id = ? AND user_id = ?', pseudId, auth.user.id);
      if (!pseud) {
        return new Response(JSON.stringify({ error: 'Pseud not found or not yours.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const oldKey = pseud.icon_key;
      const result = await uploadImage(bucket, 'pseuds', pseudId, {
        arrayBuffer: async () => file.data,
        type: file.type,
        size: file.size,
      });

      // Update DB
      await run(db, 'UPDATE pseuds SET icon_key = ? WHERE id = ? AND user_id = ?', result.key, pseudId, auth.user.id);

      // Clean up old icon
      if (oldKey) {
        await deleteImage(bucket, oldKey).catch(() => {});
      }

      return new Response(JSON.stringify({ key: result.key, url: `/api/storage/${result.key}` }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid upload type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    const status = e instanceof UploadError ? e.status : 500;
    return new Response(JSON.stringify({ error: e.message || 'Upload failed' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * DELETE /api/upload — remove an avatar/icon
 * Body: { type: "avatar" | "pseud", id?: number }
 */
export const DELETE: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const bucket = locals.runtime.env.MEDIA as R2Bucket;
  const auth = await requireAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { type, id: pseudId } = body || {};

  if (type === 'avatar') {
    const user = await queryFirst<any>(db, 'SELECT avatar_key FROM users WHERE id = ?', auth.user.id);
    if (user?.avatar_key) {
      await deleteImage(bucket, user.avatar_key);
      await run(db, "UPDATE users SET avatar_key = NULL, updated_at = datetime('now') WHERE id = ?", auth.user.id);
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (type === 'pseud') {
    if (!pseudId) {
      return new Response(JSON.stringify({ error: 'Pseud ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const pseud = await queryFirst<any>(db, 'SELECT icon_key FROM pseuds WHERE id = ? AND user_id = ?', pseudId, auth.user.id);
    if (!pseud) {
      return new Response(JSON.stringify({ error: 'Pseud not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (pseud.icon_key) {
      await deleteImage(bucket, pseud.icon_key);
      await run(db, 'UPDATE pseuds SET icon_key = NULL WHERE id = ? AND user_id = ?', pseudId, auth.user.id);
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Invalid type. Must be "avatar" or "pseud".' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};