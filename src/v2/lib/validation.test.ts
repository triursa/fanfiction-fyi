/**
 * v2 validation.test.ts — Tests for Zod schemas and request validation helpers.
 *
 * Covers: validateBody, validateQuery, and key schemas with edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  validateBody,
  validateQuery,
  signupSchema,
  loginSchema,
  createWorkSchema,
  createChapterSchema,
  searchSchema,
  createCollectionSchema,
  createPseudSchema,
  createBookmarkSchema,
  createCommentSchema,
  changePasswordSchema,
  paginationSchema,
  updateProfileSchema,
  tagBrowseSchema,
} from './validation';
import { z } from 'zod';

// ─── validateBody ────────────────────────────────────────────────────

describe('validateBody', () => {
  const simpleSchema = z.object({ name: z.string(), age: z.number() });

  it('returns parsed data for valid JSON body', async () => {
    const req = new Request('https://fanfiction.fyi/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', age: 30 }),
    });
    const [data, error] = await validateBody(req, simpleSchema);
    expect(error).toBeNull();
    expect(data).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns 400 Response for invalid JSON body', async () => {
    const req = new Request('https://fanfiction.fyi/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json}',
    });
    const [data, error] = await validateBody(req, simpleSchema);
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Response);
    expect(error!.status).toBe(400);
    const body = await error!.json() as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns 422 Response with field details for Zod failure', async () => {
    const req = new Request('https://fanfiction.fyi/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 123, age: 'not-a-number' }),
    });
    const [data, error] = await validateBody(req, simpleSchema);
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Response);
    expect(error!.status).toBe(422);
    const body = await error!.json() as { error: string; fields: Array<{ field: string; message: string }> };
    expect(body.error).toBe('Validation failed');
    expect(body.fields.length).toBeGreaterThan(0);
    // Check that we get field-level details
    const fieldNames = body.fields.map((f) => f.field);
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('age');
  });

  it('returns 422 for missing required fields', async () => {
    const req = new Request('https://fanfiction.fyi/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const [data, error] = await validateBody(req, simpleSchema);
    expect(data).toBeNull();
    expect(error!.status).toBe(422);
  });

  it('returns null data and null error for empty object with optional schema', async () => {
    const optSchema = z.object({ name: z.string().optional() });
    const req = new Request('https://fanfiction.fyi/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const [data, error] = await validateBody(req, optSchema);
    expect(error).toBeNull();
    expect(data).toEqual({});
  });
});

// ─── validateQuery ───────────────────────────────────────────────────

describe('validateQuery', () => {
  it('parses valid query parameters', () => {
    const url = new URL('https://fanfiction.fyi/api/tags?page=2&limit=10');
    const schema = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    });
    const result = validateQuery(url, schema);
    expect(result).toEqual({ page: 2, limit: 10 });
  });

  it('applies defaults for missing params', () => {
    const url = new URL('https://fanfiction.fyi/api/tags');
    const schema = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    });
    const result = validateQuery(url, schema);
    expect(result).toEqual({ page: 1, limit: 20 });
  });

  it('throws on invalid query params (Zod error)', () => {
    const url = new URL('https://fanfiction.fyi/api/tags?page=-1');
    const schema = z.object({
      page: z.coerce.number().int().positive(),
    });
    expect(() => validateQuery(url, schema)).toThrow();
  });
});

// ─── signupSchema ────────────────────────────────────────────────────

describe('signupSchema', () => {
  it('accepts valid signup data', () => {
    const data = signupSchema.parse({
      email: 'user@example.com',
      password: 'longpassword',
      displayName: 'Writer',
      inviteCode: 'ABC123',
    });
    expect(data.email).toBe('user@example.com');
  });

  it('rejects invalid email', () => {
    const result = signupSchema.safeParse({
      email: 'not-an-email',
      password: 'longpassword',
      displayName: 'Writer',
      inviteCode: 'ABC123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailError = result.error.errors.find((e) => e.path[0] === 'email');
      expect(emailError).toBeDefined();
      expect(emailError!.message).toBe('Invalid email address');
    }
  });

  it('rejects password shorter than 8 characters', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'short',
      displayName: 'Writer',
      inviteCode: 'ABC123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const pwError = result.error.errors.find((e) => e.path[0] === 'password');
      expect(pwError).toBeDefined();
      expect(pwError!.message).toContain('8');
    }
  });

  it('rejects empty display name', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'longpassword',
      displayName: '',
      inviteCode: 'ABC123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects too-long display name (51 chars)', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'longpassword',
      displayName: 'A'.repeat(51),
      inviteCode: 'ABC123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing invite code', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'longpassword',
      displayName: 'Writer',
      inviteCode: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts display name at max length (50 chars)', () => {
    const result = signupSchema.safeParse({
      email: 'user@example.com',
      password: 'longpassword',
      displayName: 'A'.repeat(50),
      inviteCode: 'CODE',
    });
    expect(result.success).toBe(true);
  });
});

// ─── loginSchema ─────────────────────────────────────────────────────

describe('loginSchema', () => {
  it('accepts valid login data', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'anypassword',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({
      email: 'bad',
      password: 'anypassword',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts any non-empty password (length check is only min 1)', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'x',
    });
    expect(result.success).toBe(true);
  });
});

// ─── createWorkSchema ────────────────────────────────────────────────

describe('createWorkSchema', () => {
  const validWork = {
    title: 'My Great Fanfic',
    pseudId: 1,
  };

  it('accepts minimal valid work data with defaults', () => {
    const data = createWorkSchema.parse(validWork);
    expect(data.title).toBe('My Great Fanfic');
    expect(data.pseudId).toBe(1);
    expect(data.language).toBe('en');
    expect(data.workSkin).toBe('default');
    expect(data.tags).toEqual([]);
  });

  it('rejects empty title', () => {
    const result = createWorkSchema.safeParse({ ...validWork, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects title over 500 chars', () => {
    const result = createWorkSchema.safeParse({ ...validWork, title: 'T'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('accepts title at exactly 500 chars', () => {
    const result = createWorkSchema.safeParse({ ...validWork, title: 'T'.repeat(500) });
    expect(result.success).toBe(true);
  });

  it('rejects invalid language code (not 2 chars)', () => {
    const result = createWorkSchema.safeParse({ ...validWork, language: 'eng' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid workSkin', () => {
    const result = createWorkSchema.safeParse({ ...validWork, workSkin: 'neon' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive pseudId', () => {
    const result = createWorkSchema.safeParse({ ...validWork, pseudId: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts optional fields when provided', () => {
    const data = createWorkSchema.parse({
      ...validWork,
      summary: 'A great story',
      notes: 'Author note',
      endNotes: 'End note',
    });
    expect(data.summary).toBe('A great story');
  });

  it('rejects summary over 2000 chars', () => {
    const result = createWorkSchema.safeParse({ ...validWork, summary: 'S'.repeat(2001) });
    expect(result.success).toBe(false);
  });

  it('validates tags array', () => {
    const data = createWorkSchema.parse({
      ...validWork,
      tags: [{ name: 'Harry Potter', type: 'fandom' }],
    });
    expect(data.tags).toHaveLength(1);
  });

  it('rejects invalid tag type', () => {
    const result = createWorkSchema.safeParse({
      ...validWork,
      tags: [{ name: 'HP', type: 'invalid-type' }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── createChapterSchema ─────────────────────────────────────────────

describe('createChapterSchema', () => {
  it('uses default title "Chapter 1" when omitted', () => {
    const data = createChapterSchema.parse({});
    expect(data.title).toBe('Chapter 1');
  });

  it('accepts custom title', () => {
    const data = createChapterSchema.parse({ title: 'Prologue' });
    expect(data.title).toBe('Prologue');
  });

  it('rejects title over 500 chars', () => {
    const result = createChapterSchema.safeParse({ title: 'C'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('accepts optional contentMd', () => {
    const data = createChapterSchema.parse({ contentMd: '# Hello' });
    expect(data.contentMd).toBe('# Hello');
  });

  it('accepts mood string', () => {
    const data = createChapterSchema.parse({ mood: 'melancholy' });
    expect(data.mood).toBe('melancholy');
  });

  it('rejects mood over 100 chars', () => {
    const result = createChapterSchema.safeParse({ mood: 'M'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('accepts empty object (all fields optional with defaults)', () => {
    const data = createChapterSchema.parse({});
    expect(data.title).toBe('Chapter 1');
    expect(data.contentMd).toBeUndefined();
  });
});

// ─── searchSchema ────────────────────────────────────────────────────

describe('searchSchema', () => {
  it('requires query string q', () => {
    const result = searchSchema.safeParse({ q: '' });
    expect(result.success).toBe(false);
  });

  it('accepts valid search with defaults', () => {
    const data = searchSchema.parse({ q: 'drarry' });
    expect(data.q).toBe('drarry');
    expect(data.sort).toBe('updated');
    expect(data.page).toBe(1);
    expect(data.limit).toBe(20);
  });

  it('accepts all filter parameters', () => {
    const data = searchSchema.parse({
      q: 'drarry',
      fandom: 'Harry Potter',
      character: 'Draco Malfoy',
      relationship: 'Draco/Harry',
      rating: 'explicit',
      complete: true,
      sort: 'kudos',
      page: 2,
      limit: 50,
    });
    expect(data.fandom).toBe('Harry Potter');
    expect(data.complete).toBe(true);
    expect(data.sort).toBe('kudos');
  });

  it('rejects invalid sort value', () => {
    const result = searchSchema.safeParse({ q: 'test', sort: 'relevance' });
    expect(result.success).toBe(false);
  });

  it('rejects limit over 50', () => {
    const result = searchSchema.safeParse({ q: 'test', limit: 51 });
    expect(result.success).toBe(false);
  });

  it('coerces string booleans for complete', () => {
    // z.coerce.boolean() should handle "true" string
    const data = searchSchema.parse({ q: 'test', complete: 'true' });
    expect(data.complete).toBe(true);
  });

  it('coerces string numbers for page/limit', () => {
    const data = searchSchema.parse({ q: 'test', page: '3', limit: '10' });
    expect(data.page).toBe(3);
    expect(data.limit).toBe(10);
  });
});

// ─── createCollectionSchema ──────────────────────────────────────────

describe('createCollectionSchema', () => {
  it('accepts valid collection with slug name', () => {
    const data = createCollectionSchema.parse({
      name: 'my-collection',
      title: 'My Collection',
    });
    expect(data.name).toBe('my-collection');
    expect(data.privacy).toBe('open');
  });

  it('rejects name with uppercase letters', () => {
    const result = createCollectionSchema.safeParse({
      name: 'MyCollection',
      title: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name with spaces', () => {
    const result = createCollectionSchema.safeParse({
      name: 'my collection',
      title: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name with underscores (only hyphens allowed)', () => {
    const result = createCollectionSchema.safeParse({
      name: 'my_collection',
      title: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts name with numbers and hyphens', () => {
    const result = createCollectionSchema.safeParse({
      name: 'collection-2026-v2',
      title: 'Test',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid privacy value', () => {
    const result = createCollectionSchema.safeParse({
      name: 'test',
      title: 'Test',
      privacy: 'secret',
    });
    expect(result.success).toBe(false);
  });
});

// ─── createPseudSchema ───────────────────────────────────────────────

describe('createPseudSchema', () => {
  it('accepts valid pseud', () => {
    const data = createPseudSchema.parse({ name: 'MyPseud' });
    expect(data.name).toBe('MyPseud');
  });

  it('rejects empty name', () => {
    const result = createPseudSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 100 chars', () => {
    const result = createPseudSchema.safeParse({ name: 'N'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('accepts optional hex color', () => {
    const data = createPseudSchema.parse({ name: 'Pseud', themeColor: '#1A2B3C' });
    expect(data.themeColor).toBe('#1A2B3C');
  });

  it('rejects invalid hex color', () => {
    const result = createPseudSchema.safeParse({ name: 'Pseud', themeColor: 'red' });
    expect(result.success).toBe(false);
  });

  it('rejects 3-char hex shorthand', () => {
    const result = createPseudSchema.safeParse({ name: 'Pseud', themeColor: '#abc' });
    expect(result.success).toBe(false);
  });
});

// ─── createBookmarkSchema ────────────────────────────────────────────

describe('createBookmarkSchema', () => {
  it('defaults private to false', () => {
    const data = createBookmarkSchema.parse({});
    expect(data.private).toBe(false);
  });

  it('accepts private: true', () => {
    const data = createBookmarkSchema.parse({ private: true });
    expect(data.private).toBe(true);
  });

  it('accepts optional notes', () => {
    const data = createBookmarkSchema.parse({ notes: 'Great fic!' });
    expect(data.notes).toBe('Great fic!');
  });

  it('rejects notes over 2000 chars', () => {
    const result = createBookmarkSchema.safeParse({ notes: 'N'.repeat(2001) });
    expect(result.success).toBe(false);
  });
});

// ─── createCommentSchema ─────────────────────────────────────────────

describe('createCommentSchema', () => {
  it('accepts valid comment', () => {
    const data = createCommentSchema.parse({ content: 'Great chapter!' });
    expect(data.content).toBe('Great chapter!');
  });

  it('rejects empty content', () => {
    const result = createCommentSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects content over 10000 chars', () => {
    const result = createCommentSchema.safeParse({ content: 'C'.repeat(10001) });
    expect(result.success).toBe(false);
  });

  it('accepts optional parentId', () => {
    const data = createCommentSchema.parse({ content: 'Reply', parentId: 42 });
    expect(data.parentId).toBe(42);
  });
});

// ─── changePasswordSchema ───────────────────────────────────────────

describe('changePasswordSchema', () => {
  it('accepts valid passwords', () => {
    const data = changePasswordSchema.parse({
      currentPassword: 'oldpassword',
      newPassword: 'newpassword1',
    });
    expect(data.currentPassword).toBe('oldpassword');
    expect(data.newPassword).toBe('newpassword1');
  });

  it('rejects empty currentPassword', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'newpassword1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects new password under 8 chars', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'oldpassword',
      newPassword: 'short',
    });
    expect(result.success).toBe(false);
  });
});

// ─── paginationSchema ───────────────────────────────────────────────

describe('paginationSchema', () => {
  it('defaults to page=1, limit=20', () => {
    const data = paginationSchema.parse({});
    expect(data).toEqual({ page: 1, limit: 20 });
  });

  it('rejects limit over 100', () => {
    const result = paginationSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects page=0', () => {
    const result = paginationSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it('coerces string numbers', () => {
    const data = paginationSchema.parse({ page: '2', limit: '50' });
    expect(data).toEqual({ page: 2, limit: 50 });
  });
});

// ─── updateProfileSchema ────────────────────────────────────────────

describe('updateProfileSchema', () => {
  it('accepts empty object (all optional)', () => {
    const data = updateProfileSchema.parse({});
    expect(data).toEqual({});
  });

  it('validates emailVisibility enum', () => {
    const valid = updateProfileSchema.safeParse({ emailVisibility: 'mutual' });
    expect(valid.success).toBe(true);

    const invalid = updateProfileSchema.safeParse({ emailVisibility: 'everyone' });
    expect(invalid.success).toBe(false);
  });

  it('validates readingFontSize enum', () => {
    const valid = updateProfileSchema.safeParse({ readingFontSize: 'large' });
    expect(valid.success).toBe(true);

    const invalid = updateProfileSchema.safeParse({ readingFontSize: 'huge' });
    expect(invalid.success).toBe(false);
  });

  it('validates readingSkinOverride enum', () => {
    const valid = updateProfileSchema.safeParse({ readingSkinOverride: 'parchment' });
    expect(valid.success).toBe(true);

    const invalid = updateProfileSchema.safeParse({ readingSkinOverride: 'neon' });
    expect(invalid.success).toBe(false);
  });
});

// ─── tagBrowseSchema ────────────────────────────────────────────────

describe('tagBrowseSchema', () => {
  it('provides sensible defaults', () => {
    const data = tagBrowseSchema.parse({});
    expect(data).toEqual({ page: 1, limit: 50 });
  });

  it('accepts valid filter', () => {
    const data = tagBrowseSchema.parse({ type: 'fandom', q: 'harry' });
    expect(data.type).toBe('fandom');
    expect(data.q).toBe('harry');
  });

  it('rejects invalid tag type', () => {
    const result = tagBrowseSchema.safeParse({ type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects limit over 100', () => {
    const result = tagBrowseSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });
});