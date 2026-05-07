import { defineMiddleware } from 'astro:middleware';
import { getDrizzle } from '@/lib/db';
import { sessions, users } from '@/lib/schema';
import { and, eq, gt, sql } from 'drizzle-orm';
import { cspHeaders } from '@/lib/csp';
import { validateApiKey, extractBearerToken } from '@/lib/api-keys';

// Paths accessible without authentication or approval
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/pending-approval',
  '/feed.xml',
  '/privacy',
  '/terms',
  '/api',         // API docs index page
  '/api/docs',    // Interactive API docs (Scalar)
  '/api/openapi.json', // OpenAPI spec
];

const PUBLIC_PATH_PREFIXES = [
  '/api/auth/',
  '/api/bugs/',
  '/api/client-log',
  '/_astro/',
];

function isPublicPath(pathname: string): boolean {
  // Static assets
  if (pathname.startsWith('/_astro/') || pathname.startsWith('/favicon')) return true;
  // Auth and bug report APIs
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/api/bugs/')) return true;
  // Public read-only API endpoints
  // /api/works: read endpoints (GET) are public, write endpoints use requireAuth internally
  // Only auth-gated sub-routes needing middleware protection: /progress, /mine
  if (pathname.startsWith('/api/works')) {
    if (pathname.includes('/progress') || pathname.includes('/mine')) return false;
    return true;
  }
  if (pathname.startsWith('/api/pseuds')) return true;
  if (pathname.startsWith('/api/tags')) return true;
  if (pathname.startsWith('/api/search')) return true;
  if (pathname.startsWith('/api/collections')) return true;
  if (pathname.startsWith('/api/series')) return true;
  if (pathname.startsWith('/api/characters')) return true;
  // Canon API: GET endpoints are public reads, writes use requireAuth internally
  if (pathname.startsWith('/api/canon')) return true;
  // Public content pages (browse, read, search)
  if (pathname === '/works' || pathname.startsWith('/works/')) return true;
  if (pathname === '/characters' || pathname.startsWith('/characters/')) return true;
  if (pathname === '/pseuds' || pathname.startsWith('/pseuds/')) return true;
  if (pathname === '/tags' || pathname.startsWith('/tags/')) return true;
  if (pathname === '/series' || pathname.startsWith('/series/')) return true;
  if (pathname === '/collections' || pathname.startsWith('/collections/')) return true;
  if (pathname === '/search') return true;
  if (pathname === '/canon' || pathname.startsWith('/canon/')) return true;
  if (pathname === '/') return true;

  // Exact match paths
  if (PUBLIC_PATHS.includes(pathname)) return true;

  return false;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const method = context.request.method;

  // Publish flow debug logging
  const isPublishRelated = pathname.startsWith('/api/works') && (method === 'PUT' || method === 'POST');
  if (isPublishRelated) {
    const hasCookie = !!(context.request.headers.get('cookie') ?? '').match(/session=([a-f0-9]+)/);
    console.log(JSON.stringify({
      t: 'mw_publish',
      method,
      pathname,
      hasSessionCookie: hasCookie,
      contentType: context.request.headers.get('Content-Type'),
    }));
  }

  // Allow all public paths through without auth checks
  if (isPublicPath(pathname)) {
    if (isPublishRelated) {
      console.log(JSON.stringify({ t: 'mw_publish', note: 'isPublicPath=true — skipping auth', pathname }));
    }
    return next();
  }

  // Read session cookie
  const cookie = context.request.headers.get('cookie') ?? '';
  const sessionMatch = cookie.match(/session=([a-f0-9]+)/);

  // For API routes, check Bearer token auth as fallback
  if (!sessionMatch && pathname.startsWith('/api/')) {
    const bearerToken = extractBearerToken(context.request);
    if (bearerToken) {
      const apiKeyResult = await validateApiKey(d1, bearerToken);
      if (apiKeyResult) {
        // API key auth successful — set minimal user in locals
        context.locals.user = apiKeyResult.user;
        const response = await next();
        // Add rate limit headers
        response.headers.set('X-RateLimit-Limit', apiKeyResult.key.rateLimitTier === 'pro' ? '120' : '60');
        response.headers.set('X-RateLimit-Remaining', '59'); // Simplified — real rate limiting would need a counter
        const csp = cspHeaders();
        response.headers.set(Object.keys(csp)[0], Object.values(csp)[0]);
        return response;
      }
      // Invalid/expired API key
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!sessionMatch) {
    if (isPublishRelated) {
      console.log(JSON.stringify({ t: 'mw_publish', note: 'NO_SESSION_COOKIE — returning 401', pathname }));
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return context.redirect('/login');
  }

  const d1 = context.locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  // Look up session and user
  const session = await db.select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.token, sessionMatch[1]), gt(sessions.expiresAt, sql`datetime('now')`)))
    .get();

  if (!session) {
    if (isPublishRelated) {
      console.log(JSON.stringify({ t: 'mw_publish', note: 'SESSION_EXPIRED_OR_INVALID — returning 401', pathname }));
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  const user = await db.select({
    id: users.id,
    role: users.role,
    approved: users.approved,
    banned: users.banned,
    suspendedUntil: users.suspendedUntil,
  }).from(users).where(eq(users.id, session.userId)).get();

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  // Banned users — destroy session and redirect
  if (user.banned) {
    await db.delete(sessions).where(eq(sessions.token, sessionMatch[1]));
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login?error=banned',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  // Suspended users — keep session, block access until suspension lifts
  if (user.suspendedUntil) {
    const suspendedTime = new Date(user.suspendedUntil + 'Z').getTime();
    if (Date.now() < suspendedTime) {
      // Still suspended
      if (pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'suspended', suspendedUntil: user.suspendedUntil }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return context.redirect(`/login?error=suspended&until=${encodeURIComponent(user.suspendedUntil)}`);
    }
    // Suspension expired — auto-restore by clearing the field
    await db.update(users).set({ suspendedUntil: null }).where(eq(users.id, user.id));
  }

  // Unapproved users
  if (!user.approved) {
    if (pathname === '/pending-approval' || pathname === '/api/auth/me' || pathname === '/api/auth/logout') {
      context.locals.user = user;
      return next();
    }
    return context.redirect('/pending-approval');
  }

  // Approved user — set user info in locals and continue
  context.locals.user = user;

  // Continue to the page/API handler, then add CSP headers
  const response = await next();
  const csp = cspHeaders();
  response.headers.set(Object.keys(csp)[0], Object.values(csp)[0]);
  return response;
});