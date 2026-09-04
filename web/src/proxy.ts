import { NextRequest, NextResponse } from 'next/server';

// Duplicated from lib/api.ts's SESSION_COOKIE rather than imported: api.ts
// pulls in next/headers, which is scoped to the Server Component request
// context and shouldn't be dragged into the proxy bundle (a different
// execution context that runs before routing). Keep these two in sync by
// hand if the cookie name ever changes.
const SESSION_COOKIE = 'omniprint_session';
const PLATFORM_SESSION_COOKIE = 'omniprint_platform_session';
const PUBLIC_PATHS = ['/login'];

// Only checks that a session cookie is present - a fast redirect for the
// common "not logged in at all" case. It does NOT verify the JWT's
// signature/expiry (that needs the shared secret and is easy to get subtly
// wrong at the edge); an expired/invalid token still reaches the backend,
// which rejects it with 401, and src/lib/api.ts (or platform-api.ts)
// redirects from there. Per Next.js's own guidance, proxy is a UX
// shortcut, not the security boundary - the backend guards are.
//
// /platform uses a completely separate cookie from everything else - see
// lib/platform-api.ts - so a tenant session never grants entry there and
// vice versa, even at this presence-check level.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/platform')) {
    if (pathname === '/platform/login') {
      return NextResponse.next();
    }
    if (!request.cookies.has(PLATFORM_SESSION_COOKIE)) {
      return NextResponse.redirect(new URL('/platform/login', request.url));
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // icon.svg is this app's own favicon (see app/icon.svg) - Next.js serves
  // it at that path directly, and it must stay reachable without a session
  // or the browser tab icon breaks on the login page itself.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
