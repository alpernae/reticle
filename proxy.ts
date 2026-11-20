// proxy.ts — Next.js request gate (the renamed middleware convention).
//
// The cookie's token is checked against the local SQLite sessions table, so a
// stale or forged cookie value dressed up as sf_ses gets nowhere: once you
// sign out, that session is dead everywhere. /login and /api/auth stay open
// by design (how else would anyone sign in?).
//
// API routes are optimistic here: every route asks for a session itself
// (lib/http/route.ts → requestUser), so the same route can also be called from
// a background job or a future CLI without going through the proxy. The proxy
// only guards pages — an unauthenticated page visit is redirected to /login.
import { NextRequest, NextResponse } from 'next/server';
import { COOKIE, sessionUser } from '@/lib/auth';

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/')) return NextResponse.next(); // routes enforce their own session

  const authed = !!sessionUser(req.cookies.get(COOKIE)?.value);

  if (pathname === '/login') {
    if (authed) return NextResponse.redirect(new URL('/', req.url)); // already signed in → app
    return NextResponse.next();
  }

  if (!authed) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}

export const config = {
  // everything except Next internals and dev tooling
  matcher: ['/((?!_next|__nextjs|favicon.ico|icon.svg).*)'],
};
