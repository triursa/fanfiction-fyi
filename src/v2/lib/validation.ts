/**
 * v2 Validation — Zod schemas for API request validation.
 *
 * Usage:
 *   const [data, error] = await validateBody(request, schema);
 *   if (error) return error; // 422 with field-level details
 */

import { z } from 'zod';

// ─── Auth ────────────────────────────────────────────────────────

export const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1, 'Display name is required').max(50, 'Display name too long'),
  inviteCode: z.string().min(1, 'Invite code is required'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// ─── Works ────────────────────────────────────────────────────────

export const createWorkSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title too long'),
  summary: z.string().max(2000, 'Summary too long').optional(),
  notes: z.string().max(10000, 'Notes too long').optional(),
  endNotes: z.string().max(10000, 'End notes too long').optional(),
  language: z.string().length(2, 'Language must be a 2-letter code').default('en'),
  workSkin: z.enum(['default', 'typewriter', 'manuscript', 'terminal', 'parchment']).default('default'),
  pseudId: z.number().int().positive('Pseud ID is required'),
  tags: z.array(z.object({
    id: z.number().int().positive().optional(),
    name: z.string().min(1).max(200),
    type: z.enum(['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category']),
  })).default([]),
});

export const updateWorkSchema = createWorkSchema.partial().extend({
  complete: z.boolean().optional(),
  draft: z.boolean().optional(),
});

// ─── Chapters ────────────────────────────────────────────────────

export const createChapterSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500).default('Chapter 1'),
  contentMd: z.string().optional(),
  contentHtml: z.string().optional(),
  mood: z.string().max(100).optional(),
  versionNote: z.string().max(500, 'Version note too long').optional(),
});

export const updateChapterSchema = createChapterSchema.partial().extend({
  draft: z.boolean().optional(),
});

export const reorderChaptersSchema = z.object({
  chapterIds: z.array(z.number().int().positive()).min(1, 'Must provide at least one chapter ID'),
});

// ─── Tags ─────────────────────────────────────────────────────────

export const createTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(200, 'Tag name too long'),
  type: z.enum(['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category']),
  description: z.string().max(2000, 'Description too long').optional(),
  canonical: z.boolean().default(false),
});

export const tagBrowseSchema = z.object({
  type: z.enum(['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category']).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

// ─── Pseuds ───────────────────────────────────────────────────────

export const createPseudSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().max(2000).optional(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color').optional(),
});

export const updatePseudSchema = createPseudSchema.partial().extend({
  isDefault: z.number().int().min(0).max(1).optional(),
});

// ─── Comments ─────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(10000, 'Comment too long'),
  workId: z.number().int().positive(),
  chapterId: z.number().int().positive().optional(),
  parentId: z.number().int().positive().optional(),
});

// ─── Bookmarks ────────────────────────────────────────────────────

export const createBookmarkSchema = z.object({
  workId: z.number().int().positive(),
  notes: z.string().max(2000).optional(),
  private: z.boolean().default(false),
});

// ─── Kudos ────────────────────────────────────────────────────────

// Kudos is a toggle — no body needed beyond identifying the work (in URL).

// ─── Search ───────────────────────────────────────────────────────

export const searchSchema = z.object({
  q: z.string().min(1, 'Search query is required'),
  fandom: z.string().optional(),
  character: z.string().optional(),
  relationship: z.string().optional(),
  rating: z.string().optional(),
  warning: z.string().optional(),
  category: z.string().optional(),
  complete: z.coerce.boolean().optional(),
  sort: z.enum(['updated', 'published', 'words', 'kudos', 'comments']).default('updated'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

// ─── Collections ──────────────────────────────────────────────────

export const createCollectionSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug: lowercase, numbers, hyphens only'),
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(5000).optional(),
  privacy: z.enum(['open', 'moderated', 'closed', 'private', 'public', 'unrevealed']).default('open'),
  pseudId: z.number().int().positive('Pseud ID is required'),
});

export const updateCollectionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  privacy: z.enum(['open', 'moderated', 'closed', 'private', 'public', 'unrevealed']).optional(),
});

export const addCollectionItemSchema = z.object({
  collectionId: z.number().int().positive('Collection ID is required'),
  workId: z.number().int().positive('Work ID is required'),
});

export const removeCollectionItemSchema = z.object({
  collectionId: z.number().int().positive('Collection ID is required'),
  workId: z.number().int().positive('Work ID is required'),
});

export const browseCollectionsSchema = z.object({
  privacy: z.enum(['open', 'moderated', 'closed', 'private', 'public', 'unrevealed']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ─── Series ────────────────────────────────────────────────────────

export const createSeriesSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(5000).optional(),
  pseudId: z.number().int().positive('Pseud ID is required'),
});

export const updateSeriesSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500).optional(),
  description: z.string().max(5000).optional(),
  complete: z.boolean().optional(),
});

export const browseSeriesSchema = z.object({
  complete: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const addSeriesWorkSchema = z.object({
  workId: z.number().int().positive('Work ID is required'),
  position: z.number().int().positive().optional(),
});

export const removeSeriesWorkSchema = z.object({
  workId: z.number().int().positive('Work ID is required'),
});

export const reorderSeriesWorksSchema = z.object({
  positions: z.array(z.object({
    workId: z.number().int().positive('Work ID is required'),
    position: z.number().int().positive('Position is required'),
  })).min(1, 'Must provide at least one position entry'),
});

// ─── Pagination ────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ─── User Profile ─────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(2000).optional(),
  emailVisibility: z.enum(['public', 'mutual', 'private']).optional(),
  theme: z.string().optional(),
  readingFontSize: z.enum(['small', 'default', 'large', 'xlarge']).optional(),
  readingSkinOverride: z.enum(['author', 'default', 'typewriter', 'manuscript', 'terminal', 'parchment']).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// ─── Reports ────────────────────────────────────────────────────────

export const createReportSchema = z.object({
  targetType: z.enum(['work', 'comment'], 'Target type must be "work" or "comment"'),
  targetId: z.number().int().positive('Target ID must be a positive integer'),
  reason: z.enum(['harassment', 'spam', 'copyright', 'graphic', 'other'], 'Invalid report reason'),
  details: z.string().max(5000, 'Details too long (max 5000 chars)').optional(),
});

// ─── Admin ────────────────────────────────────────────────────────

export const createInviteCodeSchema = z.object({
  count: z.number().int().positive().max(50).default(1),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(['founder', 'admin', 'mod', 'user']),
});

export const suspendUserSchema = z.object({
  until: z.string().datetime('Must be an ISO date').optional(),
  reason: z.string().max(1000).optional(),
});

export const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution: z.string().max(5000).optional(),
});

// ─── Canon ────────────────────────────────────────────────────────

export const createLoreEntrySchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  content: z.string().min(1, 'Content is required'),
  category: z.string().min(1, 'Category is required'),
  workId: z.number().int().positive().optional(),
  pseudId: z.number().int().positive(),
});

export const updateLoreEntrySchema = createLoreEntrySchema.partial();

export const browseLoreSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  category: z.string().optional(),
  workId: z.coerce.number().int().positive().optional(),
});

export const createLocationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long'),
  description: z.string().optional(),
  type: z.enum(['city', 'country', 'region', 'continent', 'other']),
  parentId: z.number().int().positive().optional(),
  pseudId: z.number().int().positive(),
});

export const updateLocationSchema = createLocationSchema.partial();

export const browseLocationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  type: z.enum(['city', 'country', 'region', 'continent', 'other']).optional(),
});

// ─── Characters & Groups ──────────────────────────────────────────

export const createCharacterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long'),
  description: z.string().max(5000, 'Description too long').optional(),
  groupId: z.number().int().positive().optional(),
  pseudId: z.number().int().positive('Pseud ID is required'),
});

export const updateCharacterSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  groupId: z.number().int().positive().nullable().optional(),
});

export const browseCharactersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  groupId: z.coerce.number().int().positive().optional(),
});

export const createCharacterGroupSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long'),
  description: z.string().max(5000, 'Description too long').optional(),
  pseudId: z.number().int().positive('Pseud ID is required'),
});

export const updateCharacterGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
});

export const browseCharacterGroupsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createAppearanceSchema = z.object({
  characterId: z.number().int().positive('Character ID is required'),
  workId: z.number().int().positive('Work ID is required'),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'minor', 'other']).default('supporting'),
  notes: z.string().max(2000).optional(),
});

export const removeAppearanceSchema = z.object({
  characterId: z.number().int().positive('Character ID is required'),
  workId: z.number().int().positive('Work ID is required'),
});

// ─── Helper ───────────────────────────────────────────────────────

type ValidationSuccess<T> = [T, null];
type ValidationError = [null, Response];

export async function validateBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<ValidationSuccess<z.infer<T>> | ValidationError> {
  try {
    const body = await request.json();
    const data = schema.parse(body);
    return [data, null];
  } catch (err) {
    if (err instanceof z.ZodError) {
      const fields = err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return [
        null,
        new Response(JSON.stringify({ error: 'Validation failed', fields }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }),
      ];
    }
    return [
      null,
      new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ];
  }
}

export function validateQuery<T extends z.ZodType>(
  url: URL,
  schema: T,
): z.infer<T> {
  const params = Object.fromEntries(url.searchParams.entries());
  return schema.parse(params);
}