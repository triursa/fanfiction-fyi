/**
 * Zod validation layer for fanfiction.fyi v2.
 *
 * Provides reusable schemas for common types and helper functions
 * that parse request bodies / URL params against those schemas,
 * returning typed results or structured error responses.
 */

import { z, type ZodSchema, type ZodIssue } from 'zod';

// ─── Common schemas ─────────────────────────────────────────

export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Invalid email address')
  .max(254, 'Email too long');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long');

export const pseudNameSchema = z
  .string()
  .min(1, 'Pseud name is required')
  .max(64, 'Pseud name too long')
  .regex(/^[a-zA-Z0-9_ -]+$/, 'Pseud name may only contain letters, numbers, spaces, hyphens, and underscores');

export const tagSchema = z
  .string()
  .min(1, 'Tag cannot be empty')
  .max(128, 'Tag too long');

export const workTitleSchema = z
  .string()
  .min(1, 'Title is required')
  .max(255, 'Title too long');

export const chapterTitleSchema = z
  .string()
  .min(1, 'Chapter title is required')
  .max(255, 'Chapter title too long');

export const contentSchema = z
  .string()
  .min(1, 'Content cannot be empty')
  .max(500_000, 'Content exceeds maximum length');

export const summarySchema = z
  .string()
  .max(2000, 'Summary too long')
  .default('');

export const displayNameSchema = z
  .string()
  .min(1, 'Display name is required')
  .max(64, 'Display name too long');

export const bioSchema = z
  .string()
  .max(2000, 'Bio too long')
  .default('');

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('Invalid ID'),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// ─── Error response format ───────────────────────────────────

export interface ValidationError {
  error: string;
  details?: ZodIssue[];
}

function formatError(issues: ZodIssue[]): ValidationError {
  return {
    error: issues.map((i) => i.message).join('; '),
    details: issues,
  };
}

// ─── validateBody ───────────────────────────────────────────

/**
 * Parse a Request body as JSON and validate against a Zod schema.
 *
 * Returns `[data, null]` on success, or `[null, Response]` on failure.
 * The Response is a JSON response with `{ error, details? }`.
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<[T, null] | [null, Response]> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return [
      null,
      new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ];
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return [
      null,
      new Response(JSON.stringify(formatError(result.error.issues)), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ];
  }

  return [result.data, null];
}

// ─── validateParams ─────────────────────────────────────────

/**
 * Validate URL params (e.g., from Astro's params object) against a Zod schema.
 *
 * Returns `[data, null]` on success, or `[null, Response]` on failure.
 */
export function validateParams<T>(
  params: Record<string, string | undefined>,
  schema: ZodSchema<T>
): [T, null] | [null, Response] {
  const result = schema.safeParse(params);
  if (!result.success) {
    return [
      null,
      new Response(JSON.stringify(formatError(result.error.issues)), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ];
  }

  return [result.data, null];
}