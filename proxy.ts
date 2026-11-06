// proxy.ts — Next.js request gate (the renamed middleware convention).
// The cookie's token is checked against the local SQLite sessions table, so a
// stale or forged cookie value dressed up as sf_ses gets nowhere: once you
// sign out, that session is dead everywhere. /login and /api/auth stay open
// by design (how else would anyone sign in?).
import { NextRequest, NextResponse } from 'next/server';
import { COOKIE, sessionUser } from '@/lib/auth';
import { getStore } from '@/lib/db';

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = !!sessionUser(req.cookies.get(COOKIE)?.value);

  if (pathname.startsWith('/api/auth')) return NextResponse.next(); // status · register · signin · logout

  // the server's own automation scheduler (lib/startup.ts) carries a key stored in SQLite
  if (pathname === '/api/automations/tick' && req.method === 'POST') {
    const key = req.headers.get('x-payload-scheduler') || '';
    const want = getStore().getMeta('schedulerKey') || '';
    if (authed || (want.length >= 32 && key === want)) return NextResponse.next();
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  if (pathname.startsWith('/api/')) {
    if (!authed) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    return NextResponse.next();
  }

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
