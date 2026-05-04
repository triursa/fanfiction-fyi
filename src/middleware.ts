import { defineMiddleware } from 'astro:middleware';
import { getDrizzle } from '@/lib/db';
import { sessions, users } from '@/lib/schema';
import { eq, gt, sql } from 'drizzle-orm';
import { cspHeaders } from '@/lib/csp';

// Paths accessible without authentication or approval
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/pending-approval',
  '/feed.xml',
  '/privacy',
  '/terms',
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
  if (pathname.startsWith('/api/works') && !pathname.includes('/chapters/')) return true;
  if (pathname.startsWith('/api/pseuds')) return true;
  if (pathname.startsWith('/api/tags')) return true;
  if (pathname.startsWith('/api/search')) return true;
  if (pathname.startsWith('/api/collections')) return true;
  if (pathname.startsWith('/api/series')) return true;
  if (pathname.startsWith('/api/characters')) return true;
  // Public content pages (browse, read, search)
  if (pathname === '/works' || pathname.startsWith('/works/')) return true;
  if (pathname === '/characters' || pathname.startsWith('/characters/')) return true;
  if (pathname === '/tags' || pathname.startsWith('/tags/')) return true;
  if (pathname === '/series' || pathname.startsWith('/series/')) return true;
  if (pathname === '/collections' || pathname.startsWith('/collections/')) return true;
  if (pathname === '/search') return true;
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