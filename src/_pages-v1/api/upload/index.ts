export const prerender = false;

import type { APIRoute } from 'astro';
import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { users, pseuds, creatorships, chapters } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray } from 'drizzle-orm';
import { uploadImage, deleteImage, deleteImages, parseMultipart, UploadError } from '@/lib/storage';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';

/**
 * POST /api/upload — upload an image for user avatar, pseud icon, or chapter content
 * 
 * Accepts multipart/form-data with:
 *   - file: the image file (gif/png/jpg/webp)
 *   - type: "avatar" | "pseud" | "chapter" | "banner"
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
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const bucket = locals.runtime.env.MEDIA as R2Bucket;
  const auth = await requireAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Auth required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: 5 per 5min per user ID
  const rlKey = `user:${auth.user.id}`;
  const rl = await checkRateLimit(d1, rlKey, 'upload');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds) },
    });
  }
  await recordFailedAttempt(d1, rlKey, 'upload');

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
        const userPseudIds = auth.pseuds.map(p => p.id);
        const creatorship = await db
          .select()
          .from(creatorships)
          .where(and(eq(creatorships.workId, workId), inArray(creatorships.pseudId, userPseudIds)))
          .get();
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
          const chapter = await db.select({ images: chapters.images }).from(chapters).where(eq(chapters.id, chapterId)).get();
          if (chapter) {
            const images: string[] = chapter.images ? JSON.parse(chapter.images) : [];
            images.push(result.key);
            await db.update(chapters).set({ images: JSON.stringify(images) }).where(eq(chapters.id, chapterId));
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
      const user = await db.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, auth.user.id)).get();
      const oldKey = user?.avatarKey;

      const result = await uploadImage(bucket, 'avatars', auth.user.id, {
        arrayBuffer: async () => file.data,
        type: file.type,
        size: file.size,
      });

      // Update DB
      await db.update(users).set({ avatarKey: result.key, updatedAt: sql`datetime('now')` }).where(eq(users.id, auth.user.id));

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
      const pseud = await db.select({ iconKey: pseuds.iconKey }).from(pseuds).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id))).get();
      if (!pseud) {
        return new Response(JSON.stringify({ error: 'Pseud not found or not yours.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const oldKey = pseud.iconKey;
      const result = await uploadImage(bucket, 'pseuds', pseudId, {
        arrayBuffer: async () => file.data,
        type: file.type,
        size: file.size,
      });

      // Update DB
      await db.update(pseuds).set({ iconKey: result.key }).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id)));

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
      const pseud = await db.select({ bannerKey: pseuds.bannerKey }).from(pseuds).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id))).get();
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
      if (pseud.bannerKey) {
        await deleteImage(bucket, pseud.bannerKey).catch(() => {});
      }

      // Update DB
      await db.update(pseuds).set({ bannerKey: result.key }).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id)));

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
 * Body: { type: "avatar" | "pseud" | "chapter" | "banner", id?: number, key?: string }
 * 
 * For chapter type: { type: "chapter", key: "chapters/{workId}/..." } 
 * Removes from R2 and removes from the chapter's images array if chapterId provided.
 */
export const DELETE: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const bucket = locals.runtime.env.MEDIA as R2Bucket;
  const auth = await requireAuth(d1, request);
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
    const user = await db.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, auth.user.id)).get();
    if (user?.avatarKey) {
      await deleteImage(bucket, user.avatarKey);
      await db.update(users).set({ avatarKey: null, updatedAt: sql`datetime('now')` }).where(eq(users.id, auth.user.id));
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
    const pseud = await db.select({ iconKey: pseuds.iconKey, bannerKey: pseuds.bannerKey }).from(pseuds).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id))).get();
    if (!pseud) {
      return new Response(JSON.stringify({ error: 'Pseud not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (pseud.iconKey) {
      await deleteImage(bucket, pseud.iconKey);
      await db.update(pseuds).set({ iconKey: null }).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id)));
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
    const pseud = await db.select({ bannerKey: pseuds.bannerKey }).from(pseuds).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id))).get();
    if (!pseud) {
      return new Response(JSON.stringify({ error: 'Pseud not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (pseud.bannerKey) {
      await deleteImage(bucket, pseud.bannerKey);
      await db.update(pseuds).set({ bannerKey: null }).where(and(eq(pseuds.id, pseudId), eq(pseuds.userId, auth.user.id)));
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
    const userPseudIds = auth.pseuds.map(p => p.id);
    const creatorship = await db
      .select()
      .from(creatorships)
      .where(and(eq(creatorships.workId, workId), inArray(creatorships.pseudId, userPseudIds)))
      .get();
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
      const chapter = await db.select({ images: chapters.images }).from(chapters).where(eq(chapters.id, chapterId)).get();
      if (chapter?.images) {
        const images: string[] = JSON.parse(chapter.images);
        const filtered = images.filter((k: string) => k !== key);
        await db.update(chapters).set({ images: JSON.stringify(filtered) }).where(eq(chapters.id, chapterId));
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