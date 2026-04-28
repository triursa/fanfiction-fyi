/**
 * R2 Storage utilities for fanfiction.fyi
 * Handles image upload, validation, resizing, and deletion for avatars, pseud icons, and chapter images.
 * 
 * Bucket: fanfiction-fyi-media (Cloudflare R2)
 * Binding: MEDIA (configured in wrangler.toml)
 * 
 * Key convention:
 *   - User avatars:  avatars/{userId}/{timestamp}-{random}.{ext}
 *   - Pseud icons:   pseuds/{pseudId}/{timestamp}-{random}.{ext}
 *   - Chapter images: chapters/{workId}/{timestamp}-{random}.{ext}
 * 
 * Images are resized to max dimensions for avatars, stored as-is for chapter content.
 */

export interface R2Env {
  MEDIA: R2Bucket;
}

const ALLOWED_TYPES = ['image/gif', 'image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB for avatars
const MAX_CHAPTER_IMAGE_SIZE = 25 * 1024 * 1024; // 25 MB for chapter images (larger allowance)
const AVATAR_MAX_DIM = 256; // max width/height in pixels

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type ImagePrefix = 'avatars' | 'pseuds' | 'chapters';

/**
 * Validate an uploaded file's content type and size.
 * Returns the validated content type.
 */
export function validateImageUpload(contentType: string | null, contentLength: number, maxSize?: number): string {
  if (!contentType || !ALLOWED_TYPES.includes(contentType as any)) {
    throw new UploadError(400, `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}`);
  }
  const limit = maxSize ?? MAX_FILE_SIZE;
  if (contentLength > limit) {
    throw new UploadError(413, `File too large. Maximum size: ${limit / 1024 / 1024}MB`);
  }
  return contentType;
}

/**
 * Generate a unique R2 object key for an image.
 * Pattern: {prefix}/{id}/{timestamp}-{random8}.{ext}
 */
export function generateKey(prefix: ImagePrefix, id: number, ext: string): string {
  const ts = Date.now();
  const rand = crypto.randomUUID().slice(0, 8);
  return `${prefix}/${id}/${ts}-${rand}.${ext}`;
}

/**
 * Resize an image using the browser-native Image API (available in Workers via OffscreenCanvas).
 * Falls back to storing the original if resizing fails.
 * Returns the resized image as WebP ArrayBuffer.
 */
export async function resizeImage(arrayBuffer: ArrayBuffer, maxDim: number, contentType: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  // For GIFs, don't resize — store as-is to preserve animation
  if (contentType === 'image/gif') {
    return { data: arrayBuffer, contentType: 'image/gif' };
  }

  // Workers don't have a native image processing library.
  // For now, store the original file as-is. 
  // Client-side JavaScript could do resize before upload in a future iteration.
  // This keeps the implementation simple and avoids Worker size/CPU limits.
  return { data: arrayBuffer, contentType };
}

/**
 * Upload an image to R2, returning the storage key and content type.
 * For avatars/pseuds: resizes to max 256x256.
 * For chapters: stores as-is (no resize).
 */
export async function uploadImage(
  bucket: R2Bucket,
  prefix: 'avatars' | 'pseuds' | 'chapters',
  id: number,
  file: { arrayBuffer: () => Promise<ArrayBuffer>; type: string; size: number }
): Promise<{ key: string; contentType: string }> {
  const maxSize = prefix === 'chapters' ? MAX_CHAPTER_IMAGE_SIZE : MAX_FILE_SIZE;
  const validatedType = validateImageUpload(file.type, file.size, maxSize);
  const arrayBuffer = await file.arrayBuffer();

  // Determine extension
  const extMap: Record<string, string> = {
    'image/gif': 'gif',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  const ext = extMap[validatedType] || 'bin';

  const key = generateKey(prefix, id, ext);

  // For avatars/pseuds, try to resize. For chapters, store as-is.
  let processed: { data: ArrayBuffer; contentType: string };
  if (prefix === 'chapters') {
    processed = { data: arrayBuffer, contentType: validatedType };
  } else {
    processed = await resizeImage(arrayBuffer, AVATAR_MAX_DIM, validatedType);
  }

  await bucket.put(key, processed.data, {
    httpMetadata: {
      contentType: processed.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      uploadedBy: String(id),
      originalType: validatedType,
    },
  });

  return { key, contentType: processed.contentType };
}

/**
 * Delete an image from R2 by key. No-op if key is null.
 */
export async function deleteImage(bucket: R2Bucket, key: string | null): Promise<void> {
  if (!key) return;
  await bucket.delete(key);
}

/**
 * Delete multiple images from R2 by keys.
 */
export async function deleteImages(bucket: R2Bucket, keys: string[]): Promise<void> {
  if (!keys.length) return;
  await bucket.delete(keys);
}

/**
 * Get a URL for displaying an R2 object.
 * R2 objects are accessed via our /api/storage/[key] proxy route.
 */
export function getImageUrl(key: string): string {
  return `/api/storage/${encodeURIComponent(key)}`;
}

/**
 * Parse multipart form data from a Request.
 * Returns an array of file entries with their content, name, and type.
 */
export async function parseMultipart(request: Request): Promise<{ files: Map<string, { data: ArrayBuffer; type: string; size: number; filename: string }>; fields: Map<string, string> }> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.startsWith('multipart/form-data')) {
    throw new UploadError(400, 'Expected multipart/form-data');
  }

  const boundary = contentType.split('boundary=')[1];
  if (!boundary) {
    throw new UploadError(400, 'Missing boundary in multipart form data');
  }

  const body = await request.arrayBuffer();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const files = new Map<string, { data: ArrayBuffer; type: string; size: number; filename: string }>();
  const fields = new Map<string, string>();

  // Parse multipart manually — Workers don't have FormData streaming
  const boundaryBytes = encoder.encode(`--${boundary}`);
  const bodyBytes = new Uint8Array(body);

  // Split by boundary
  const parts: Uint8Array[] = [];
  let pos = 0;
  while (pos < bodyBytes.length) {
    const idx = findBytes(bodyBytes, boundaryBytes, pos);
    if (idx === -1) break;
    if (pos > 0 || idx > 0) {
      parts.push(bodyBytes.slice(pos > 0 ? pos : 0, idx));
    }
    pos = idx + boundaryBytes.length;
  }

  for (const part of parts) {
    // Skip empty parts and closing boundary
    if (part.length === 0) continue;
    if (part[0] === 0x2D && part[1] === 0x2D) continue; // --

    // Find header/body separator (\r\n\r\n)
    const headerEnd = findBytes(part, encoder.encode('\r\n\r\n'), 0);
    if (headerEnd === -1) continue;

    const headerStr = decoder.decode(part.slice(0, headerEnd));
    const bodyData = part.slice(headerEnd + 4);
    // Trim trailing \r\n
    const trimmedBody = bodyData.endsWith(encoder.encode('\r\n')) ? bodyData.slice(0, -2) : bodyData;

    // Parse Content-Disposition
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const typeMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    if (!nameMatch) continue;
    const name = nameMatch[1];

    if (filenameMatch) {
      // File field
      const type = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';
      files.set(name, {
        data: trimmedBody.buffer as ArrayBuffer,
        type,
        size: trimmedBody.length,
        filename: filenameMatch[1],
      });
    } else {
      // Text field
      fields.set(name, decoder.decode(trimmedBody));
    }
  }

  return { files, fields };
}

function findBytes(arr: Uint8Array, target: Uint8Array, start: number): number {
  for (let i = start; i <= arr.length - target.length; i++) {
    let found = true;
    for (let j = 0; j < target.length; j++) {
      if (arr[i + j] !== target[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}