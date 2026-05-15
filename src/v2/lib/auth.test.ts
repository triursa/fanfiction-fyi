/**
 * v2 auth.test.ts — Unit tests for auth helpers (pure functions only, no D1).
 *
 * Tests password hashing, cookie helpers, and checkApproved — all functions
 * that don't require a database. Session/invite-code functions depend on D1
 * and are tested in integration suites separately.
 */

import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  getSessionToken,
  sessionCookie,
  clearSessionCookie,
  checkApproved,
  SESSION_COOKIE_NAME,
  SESSION_DAYS,
} from './auth';
import type { AuthResult } from './auth';

// ─── Password Hashing ────────────────────────────────────────────────

describe('hashPassword', () => {
  it('produces a salt:hash formatted string', async () => {
    const stored = await hashPassword('hunter2');
    const parts = stored.split(':');
    expect(parts).toHaveLength(2);
    // Salt is 16 bytes = 32 hex chars
    expect(parts[0]).toHaveLength(32);
    // SHA-256 hash is 32 bytes = 64 hex chars
    expect(parts[1]).toHaveLength(64);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique salts for the same password', async () => {
    const a = await hashPassword('samepw');
    const b = await hashPassword('samepw');
    // Extremely unlikely to collide
    expect(a).not.toBe(b);
  });
});

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const stored = await hashPassword('correcthorsebatterystaple');
    const result = await verifyPassword('correcthorsebatterystaple', stored);
    expect(result).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const stored = await hashPassword('correcthorsebatterystaple');
    const result = await verifyPassword('wrongpassword', stored);
    expect(result).toBe(false);
  });

  it('returns false for malformed stored hash (no colon)', async () => {
    const result = await verifyPassword('anything', 'nocolonhere');
    expect(result).toBe(false);
  });

  it('returns false for empty stored hash', async () => {
    const result = await verifyPassword('anything', '');
    expect(result).toBe(false);
  });

  it('returns false for stored hash with only a colon', async () => {
    const result = await verifyPassword('anything', ':');
    expect(result).toBe(false);
  });

  it('handles roundtrip: hash → verify → true', async () => {
    const password = 'P@ssw0rd!2026';
    const stored = await hashPassword(password);
    expect(await verifyPassword(password, stored)).toBe(true);
  });
});

// ─── Cookie Helpers ──────────────────────────────────────────────────

describe('getSessionToken', () => {
  // happy-dom's Request doesn't properly expose 'cookie' header due to Fetch spec restrictions.
  // We test the regex logic directly by constructing Request objects that set the header
  // via the internal mechanism that Astro's runtime uses.
  function makeRequest(cookieValue: string | null): Request {
    const req = new Request('https://fanfiction.fyi/');
    if (cookieValue !== null) {
      // Force-set the cookie header (Fetch spec hides it, but server-side code reads it)
      req.headers.set('cookie', cookieValue);
    }
    return req;
  }

  it('extracts session token from cookie header', () => {
    const req = makeRequest('ffy_session=abc123; other=value');
    expect(getSessionToken(req)).toBe('abc123');
  });

  it('extracts token when session cookie is the only cookie', () => {
    const req = makeRequest('ffy_session=deadbeef');
    expect(getSessionToken(req)).toBe('deadbeef');
  });

  it('extracts token when session cookie is at end without trailing semicolon', () => {
    const req = makeRequest('first=1; ffy_session=tokenval');
    expect(getSessionToken(req)).toBe('tokenval');
  });

  it('returns null when no cookie header is present', () => {
    const req = makeRequest(null);
    expect(getSessionToken(req)).toBeNull();
  });

  it('returns null when cookie header has no session cookie', () => {
    const req = new Request('https://fanfiction.fyi/', {
      headers: { cookie: 'other=thing' },
    });
    expect(getSessionToken(req)).toBeNull();
  });

  it('returns null for empty cookie header', () => {
    const req = new Request('https://fanfiction.fyi/', {
      headers: { cookie: '' },
    });
    expect(getSessionToken(req)).toBeNull();
  });
});

describe('sessionCookie', () => {
  it('produces correctly formatted Set-Cookie value', () => {
    const result = sessionCookie('mytoken123');
    expect(result).toBe(
      'ffy_session=mytoken123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000',
    );
  });

  it('uses SESSION_DAYS * 86400 as default Max-Age', () => {
    const result = sessionCookie('tok');
    const maxAge = SESSION_DAYS * 24 * 60 * 60;
    expect(result).toContain(`Max-Age=${maxAge}`);
  });

  it('accepts custom maxAge', () => {
    const result = sessionCookie('tok', 3600);
    expect(result).toContain('Max-Age=3600');
  });

  it('includes all security directives', () => {
    const result = sessionCookie('tok');
    expect(result).toContain('HttpOnly');
    expect(result).toContain('Secure');
    expect(result).toContain('SameSite=Lax');
  });

  it('includes the cookie name from SESSION_COOKIE_NAME', () => {
    const result = sessionCookie('tok');
    expect(result).toContain(`${SESSION_COOKIE_NAME}=`);
  });
});

describe('clearSessionCookie', () => {
  it('produces a cookie that clears the session', () => {
    const result = clearSessionCookie();
    expect(result).toContain('ffy_session=');
    expect(result).toContain('Max-Age=0');
  });

  it('includes HttpOnly, Secure, SameSite in clear cookie', () => {
    const result = clearSessionCookie();
    expect(result).toContain('HttpOnly');
    expect(result).toContain('Secure');
    expect(result).toContain('SameSite=Lax');
  });

  it('has Path=/', () => {
    const result = clearSessionCookie();
    expect(result).toContain('Path=/');
  });
});

// ─── checkApproved ───────────────────────────────────────────────────

function makeAuth(overrides: Partial<{
  banned: number;
  approved: number;
  suspendedUntil: string | null;
}> = {}): AuthResult {
  return {
    user: {
      id: 1,
      email: 'test@fanfiction.fyi',
      passwordHash: 'salt:hash',
      displayName: 'Test User',
      role: 'user',
      approved: 1,
      banned: 0,
      suspendedUntil: null,
      createdAt: '2026-01-01T00:00:00Z',
      emailVisibility: 'private',
      theme: 'obsidian',
      readingFontSize: 'default',
      readingSkinOverride: null,
      ...overrides,
    } as unknown as AuthResult['user'],
    session: {
      id: 1,
      userId: 1,
      token: 'abc',
      expiresAt: '2026-12-31T00:00:00Z',
    } as unknown as AuthResult['session'],
  };
}

describe('checkApproved', () => {
  it('returns auth for an approved, non-banned, non-suspended user', () => {
    const auth = makeAuth({ approved: 1, banned: 0, suspendedUntil: null });
    expect(checkApproved(auth)).toBe(auth);
  });

  it('throws 403 for a banned user', async () => {
    const auth = makeAuth({ banned: 1 });
    try {
      checkApproved(auth);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const resp = err as Response;
      expect(resp.status).toBe(403);
      const body = await resp.json();
      expect(body.error).toBe('Banned');
    }
  });

  it('throws 403 for an unapproved user', async () => {
    const auth = makeAuth({ approved: 0 });
    try {
      checkApproved(auth);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const resp = err as Response;
      expect(resp.status).toBe(403);
      const body = await resp.json();
      expect(body.error).toBe('Unapproved');
    }
  });

  it('throws 403 for a suspended user with future date', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const auth = makeAuth({ approved: 1, banned: 0, suspendedUntil: futureDate });
    try {
      checkApproved(auth);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const resp = err as Response;
      expect(resp.status).toBe(403);
      const body = await resp.json();
      expect(body.error).toBe('Suspended');
      // suspendedUntil is included in the response
      expect(body.suspendedUntil).toBeTruthy();
    }
  });

  it('passes for a user whose suspension has expired', () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const auth = makeAuth({ approved: 1, banned: 0, suspendedUntil: pastDate });
    expect(checkApproved(auth)).toBe(auth);
  });

  it('passes for a user with null suspendedUntil', () => {
    const auth = makeAuth({ approved: 1, banned: 0, suspendedUntil: null });
    expect(checkApproved(auth)).toBe(auth);
  });

  it('prioritizes banned check over suspended/unapproved', async () => {
    // Banned AND unapproved — banned takes priority
    const auth = makeAuth({ banned: 1, approved: 0 });
    try {
      checkApproved(auth);
      expect.fail('should have thrown');
    } catch (err) {
      const resp = err as Response;
      const body = await resp.json();
      expect(body.error).toBe('Banned');
    }
  });
});

// ─── Constants ───────────────────────────────────────────────────────

describe('constants', () => {
  it('SESSION_COOKIE_NAME is ffy_session', () => {
    expect(SESSION_COOKIE_NAME).toBe('ffy_session');
  });

  it('SESSION_DAYS is 30', () => {
    expect(SESSION_DAYS).toBe(30);
  });
});