/**
 * v2 Storage helpers — R2 upload/delete for avatars, work images, etc.
 *
 * R2 bucket binding is `MEDIA` (defined in wrangler.toml).
 * Keys are prefixed by type: avatars/, works/, pseuds/
 */

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];

interface UploadResult {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

/**
 * Upload an image to R2.
 * @param bucket R2 bucket binding
 * @param prefix Key prefix (e.g., 'avatars', 'works', 'pseuds')
 * @param file File object from the request
 * @returns Upload result with key and URL
 */
export async function uploadImage(
  bucket: R2Bucket,
  prefix: string,
  file: File,
): Promise<UploadResult> {
  // Validate content type
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Response(
      JSON.stringify({ error: 'Invalid file type', allowed: ALLOWED_IMAGE_TYPES }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validate size
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Response(
      JSON.stringify({ error: 'File too large', maxSize: `${MAX_IMAGE_SIZE / 1024 / 1024}MB` }),
      { status: 413, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Generate unique key
  const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
  const id = crypto.randomUUID().replace(/-/g, '');
  const key = `${prefix}/${id}.${ext}`;

  // Upload to R2
  const arrayBuffer = await file.arrayBuffer();
  await bucket.put(key, arrayBuffer, {
    httpMetadata: { contentType: file.type },
  });

  return {
    key,
    url: `/api/storage/${key}`,
    contentType: file.type,
    size: file.size,
  };
}

/**
 * Delete an object from R2 by key.
 */
export async function deleteImage(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/**
 * Get an object from R2 by key.
 */
export async function getImage(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return await bucket.get(key);
}