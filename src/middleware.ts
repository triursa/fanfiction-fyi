import { defineMiddleware } from 'astro:middleware';
import { getDrizzle } from '@/lib/db';
import { sessions, users } from '@/lib/schema';
import { and, eq, gt, sql } from 'drizzle-orm';
import { cspHeaders } from '@/lib/csp';
import { validateApiKey, extractBearerToken } from '@/lib/api-keys';
import type { AuthLevel } from '@/lib/auth-guard';

// Extend Astro locals with user info
declare module 'astro:middleware' {
  interface Locals {
    user?: {
      id: number;
      role: string;
      approved: number;
      banned: number;
      suspendedUntil: string | null;
    };
  }
}

// ─── Route config resolution ────────────────────────────────
// When Astro supports route-level exports, this will read the
// `config` export from each route module. For now, we resolve
// auth level from route data or fall back to the default.

function getAuthLevel(pathname: string): AuthLevel {
  // Public paths — accessible without any auth
  if (pathname === '/' || pathname === '/login' || pathname === '/signup') return 'public';
  if (pathname === '/pending-approval') return 'public';
  if (pathname === '/privacy' || pathname === '/terms') return 'public';
  if (pathname === '/feed.xml') return 'public';

  // Public content pages (browse, read, search)
  if (pathname === '/works' || pathname.startsWith('/works/')) return 'public';
  if (pathname === '/characters' || pathname.startsWith('/characters/')) return 'public';
  if (pathname === '/pseuds' || pathname.startsWith('/pseuds/')) return 'public';
  if (pathname === '/tags' || pathname.startsWith('/tags/')) return 'public';
  if (pathname === '/series' || pathname.startsWith('/series/')) return 'public';
  if (pathname === '/collections' || pathname.startsWith('/collections/')) return 'public';
  if (pathname === '/search') return 'public';
  if (pathname === '/canon' || pathname.startsWith('/canon/')) return 'public';

  // Static assets
  if (pathname.startsWith('/_astro/') || pathname.startsWith('/favicon')) return 'public';

  // Public API endpoints (read-only)
  if (pathname.startsWith('/api/auth/')) return 'public';
  if (pathname.startsWith('/api/bugs/')) return 'public';
  if (pathname.startsWith('/api/client-log')) return 'public';
  // /api/works: GET endpoints are public, write endpoints use requireAuth internally
  if (pathname.startsWith('/api/works') && !pathname.includes('/progress') && !pathname.includes('/mine') && !pathname.includes('/annotations')) return 'public';
  if (pathname.startsWith('/api/pseuds')) return 'public';
  if (pathname.startsWith('/api/tags')) return 'public';
  if (pathname.startsWith('/api/search')) return 'public';
  if (pathname.startsWith('/api/collections')) return 'public';
  if (pathname.startsWith('/api/series')) return 'public';
  if (pathname.startsWith('/api/characters')) return 'public';
  if (pathname.startsWith('/api/canon')) return 'public';

  // Default: auth required (safe default)
  return 'required';
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

const CLEAR_SESSION_COOKIE = 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function unauthorizedRedirect(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': CLEAR_SESSION_COOKIE,
    },
  });
}

function bannedRedirect(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login?error=banned',
      'Set-Cookie': CLEAR_SESSION_COOKIE,
    },
  });
}

function suspendedResponse(suspendedUntil: string, isApi: boolean): Response {
  if (isApi) {
    return new Response(JSON.stringify({ error: 'suspended', suspendedUntil }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: `/login?error=suspended&until=${encodeURIComponent(suspendedUntil)}` },
  });
}

function unapprovedRedirect(): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: '/pending-approval' },
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const authLevel = getAuthLevel(pathname);
  const isApi = isApiRoute(pathname);

  // ─── Public routes: skip auth entirely ──────────────────
  if (authLevel === 'public') {
    return next();
  }

  // ─── Optional & Required: try to read session ───────────
  const cookie = context.request.headers.get('cookie') ?? '';
  const sessionMatch = cookie.match(/session=([a-f0-9]+)/);

  // For API routes, also accept Bearer token auth as fallback
  if (!sessionMatch && isApi) {
    const bearerToken = extractBearerToken(context.request);
    if (bearerToken) {
      const d1 = context.locals.runtime.env.DB as D1Database;
      const apiKeyResult = await validateApiKey(d1, bearerToken);
      if (apiKeyResult) {
        context.locals.user = apiKeyResult.user;
        const response = await next();
        const csp = cspHeaders();
        for (const [header, value] of Object.entries(csp)) {
          response.headers.set(header, value);
        }
        return response;
      }
      return unauthorizedResponse();
    }
  }

  // ─── Optional: no session → continue without user ────────
  if (authLevel === 'optional' && !sessionMatch) {
    return next();
  }

  // ─── Required: no session → redirect/401 ─────────────────
  if (!sessionMatch) {
    return isApi ? unauthorizedResponse() : unauthorizedRedirect();
  }

  // ─── Look up session and user in D1 ─────────────────────
  const d1 = context.locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  const session = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.token, sessionMatch[1]), gt(sessions.expiresAt, sql`datetime('now')`)))
    .get();

  if (!session) {
    return isApi
      ? new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': CLEAR_SESSION_COOKIE },
        })
      : unauthorizedRedirect();
  }

  const user = await db
    .select({
      id: users.id,
      role: users.role,
      approved: users.approved,
      banned: users.banned,
      suspendedUntil: users.suspendedUntil,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();

  if (!user) {
    return isApi
      ? new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': CLEAR_SESSION_COOKIE },
        })
      : unauthorizedRedirect();
  }

  // ─── Banned users: destroy session, redirect ─────────────
  if (user.banned) {
    await db.delete(sessions).where(eq(sessions.token, sessionMatch[1]));
    return bannedRedirect();
  }

  // ─── Suspended users: block access until suspension lifts ─
  if (user.suspendedUntil) {
    const suspendedTime = new Date(user.suspendedUntil + 'Z').getTime();
    if (Date.now() < suspendedTime) {
      return suspendedResponse(user.suspendedUntil, isApi);
    }
    // Suspension expired — auto-restore
    await db.update(users).set({ suspendedUntil: null }).where(eq(users.id, user.id));
  }

  // ─── Unapproved users: only access pending-approval page ─
  if (!user.approved) {
    if (pathname === '/pending-approval' || pathname === '/api/auth/me' || pathname === '/api/auth/logout') {
      context.locals.user = user;
      return next();
    }
    return unapprovedRedirect();
  }

  // ─── Approved user: set locals and continue ──────────────
  context.locals.user = user;

  const response = await next();
  const csp = cspHeaders();
  for (const [header, value] of Object.entries(csp)) {
    response.headers.set(header, value);
  }
  return response;
});