export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAuth } from '@/lib/auth';
import { queryFirst, run } from '@/lib/db';
import { uploadImage, deleteImage, deleteImages, parseMultipart, UploadError } from '@/lib/storage';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';

/**
 * POST /api/upload — upload an image for user avatar, pseud icon, or chapter content
 * 
 * Accepts multipart/form-data with:
 *   - file: the image file (gif/png/jpg/webp)
 *   - type: "avatar" | "pseud" | "chapter"
 *   - id: (for pseud/chapter type) the pseud ID or work ID
 *   - chapterId: (for chapter type) the chapter ID (for tracking images on the chapter)
 * 
 * For chapter images:
 *   - type=chapter, id={workId}, chapterId={chapterId} optional for tracking
 *   - Max file size: 25MB (vs 5MB for avatars)
 *   - Images are stored under chapters/{workId}/ prefix in R2
 *   - Returns: { key, url } — url can be embedded in markdown as ![alt](url)
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

  // Rate limit: 5 per 5min per user ID
  const rlKey = `user:${auth.user.id}`;
  const rl = await checkRateLimit(db, rlKey, 'upload');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }
  await recordFailedAttempt(db, rlKey, 'upload');

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
  if (!type || (type !== 'avatar' && type !== 'pseud' && type !== 'chapter' && type !== 'banner')) {
    return new Response(JSON.stringify({ error: 'Invalid type. Must be "avatar", "pseud", "chapter", or "banner".' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (type === 'chapter') {
      const workIdStr = fields.get('id');
      if (!workIdStr) {
        return new Response(JSON.stringify({ error: 'Work ID required for chapter uploads. Use "id" field.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const workId = parseInt(workIdStr, 10);
      if (isNaN(workId) || workId < 0) {
        return new Response(JSON.stringify({ error: 'Invalid work ID.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // For workId=0 (new work drafts), skip ownership check — no work exists yet
      // For workId>0, verify the user owns this work
      if (workId > 0) {
        const creatorship = await queryFirst<any>(db, 
          'SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)', 
          workId, auth.user.id
        );
        if (!creatorship) {
          return new Response(JSON.stringify({ error: 'You do not have permission to upload images for this work.' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      const result = await uploadImage(bucket, 'chapters', workId, {
        arrayBuffer: async () => file.data,
        type: file.type,
        size: file.size,
      });

      // If chapterId is provided, track this image on the chapter row
      const chapterIdStr = fields.get('chapterId');
      if (chapterIdStr) {
        const chapterId = parseInt(chapterIdStr, 10);
        if (!isNaN(chapterId)) {
          const chapter = await queryFirst<any>(db, 'SELECT images FROM chapters WHERE id = ?1', chapterId);
          if (chapter) {
            const images: string[] = chapter.images ? JSON.parse(chapter.images) : [];
            images.push(result.key);
            await run(db, "UPDATE chapters SET images = ? WHERE id = ?", JSON.stringify(images), chapterId);
          }
        }
      }

      const url = `/api/storage/${result.key}`;
      return new Response(JSON.stringify({ key: result.key, url }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (type === 'avatar') {
      // Upload user avatar
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

    if (type === 'banner') {
      const pseudIdStr = fields.get('id');
      if (!pseudIdStr) {
        return new Response(JSON.stringify({ error: 'Pseud ID required for banner uploads.' }), {
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
      const pseud = await queryFirst<any>(db, 'SELECT banner_key FROM pseuds WHERE id = ? AND user_id = ?', pseudId, auth.user.id);
      if (!pseud) {
        return new Response(JSON.stringify({ error: 'Pseud not found or not yours.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Upload banner — stored under pseuds/ prefix (same bucket, different convention)
      // Banners are wider images, 5MB limit is fine
      const result = await uploadImage(bucket, 'pseuds', pseudId, {
        arrayBuffer: async () => file.data,
        type: file.type,
        size: file.size,
      });

      // Clean up old banner
      if (pseud.banner_key) {
        await deleteImage(bucket, pseud.banner_key).catch(() => {});
      }

      // Update DB
      await run(db, 'UPDATE pseuds SET banner_key = ? WHERE id = ? AND user_id = ?', result.key, pseudId, auth.user.id);

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
 * DELETE /api/upload — remove an avatar/icon/chapter image
 * Body: { type: "avatar" | "pseud" | "chapter", id?: number, key?: string }
 * 
 * For chapter type: { type: "chapter", key: "chapters/{workId}/..." } 
 * Removes from R2 and removes from the chapter's images array if chapterId provided.
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

  const { type, id: pseudId, key, chapterId } = body || {};

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
    const pseud = await queryFirst<any>(db, 'SELECT icon_key, banner_key FROM pseuds WHERE id = ? AND user_id = ?', pseudId, auth.user.id);
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

  if (type === 'banner') {
    if (!pseudId) {
      return new Response(JSON.stringify({ error: 'Pseud ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const pseud = await queryFirst<any>(db, 'SELECT banner_key FROM pseuds WHERE id = ? AND user_id = ?', pseudId, auth.user.id);
    if (!pseud) {
      return new Response(JSON.stringify({ error: 'Pseud not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (pseud.banner_key) {
      await deleteImage(bucket, pseud.banner_key);
      await run(db, 'UPDATE pseuds SET banner_key = NULL WHERE id = ? AND user_id = ?', pseudId, auth.user.id);
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (type === 'chapter') {
    if (!key) {
      return new Response(JSON.stringify({ error: 'Image key required for chapter image deletion.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Security: verify key starts with expected prefix and user owns the work
    if (!key.startsWith('chapters/')) {
      return new Response(JSON.stringify({ error: 'Invalid key for chapter image.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (key.includes('..')) {
      return new Response(JSON.stringify({ error: 'Invalid key.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Extract workId from key (format: chapters/{workId}/{timestamp}-{random}.{ext})
    const parts = key.split('/');
    const workId = parseInt(parts[1], 10);
    if (isNaN(workId)) {
      return new Response(JSON.stringify({ error: 'Invalid work ID in key.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify ownership
    const creatorship = await queryFirst<any>(db, 
      'SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)', 
      workId, auth.user.id
    );
    if (!creatorship) {
      return new Response(JSON.stringify({ error: 'You do not have permission to delete images for this work.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Delete from R2
    await deleteImage(bucket, key);

    // Remove from chapter's images array if chapterId provided
    if (chapterId) {
      const chapter = await queryFirst<any>(db, 'SELECT images FROM chapters WHERE id = ?', chapterId);
      if (chapter?.images) {
        const images: string[] = JSON.parse(chapter.images);
        const filtered = images.filter((k: string) => k !== key);
        await run(db, "UPDATE chapters SET images = ? WHERE id = ?", JSON.stringify(filtered), chapterId);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Invalid type. Must be "avatar", "pseud", "banner", or "chapter".' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};