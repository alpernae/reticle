// Auth API — the only open surface (proxy exempts /api/auth). GET reports
// whether an owner exists and who is signed in; POST registers the first
// owner or signs in; DELETE logs out. Sessions are SQLite rows; the browser
// only ever sees an httpOnly, sameSite=lax cookie.
//
// Sign-in is rate limited (ADR-005): a few failures per window per IP, so a
// LAN-reachable instance cannot be used to guess the password.
import { NextRequest, NextResponse } from 'next/server';
import { COOKIE, SESSION_MS, hasUser, registerOwner, sessionUser, signIn, signOut } from '@/lib/auth';
import { clientIp, clearFailures, limitRetryAfter, noteFailure } from '@/lib/http/rate-limit';

/** Failed sign-ins allowed per IP before the door closes. */
const SIGNIN_LIMIT = 5;
/** How long the door stays closed. */
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;

export async function GET(req: NextRequest) {
  return NextResponse.json({ hasUser: hasUser(), user: sessionUser(req.cookies.get(COOKIE)?.value) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const action = body?.action === 'register' ? 'register' : 'signin';
  const key = 'auth:' + clientIp(req);

  if (action === 'signin') {
    const wait = limitRetryAfter(key, SIGNIN_LIMIT, SIGNIN_WINDOW_MS);
    if (wait > 0) {
      return NextResponse.json(
        { error: `Too many failed sign-in attempts. Try again in ${Math.max(1, Math.ceil(wait / 60))} minute(s).`, hasUser: hasUser() },
        { status: 429, headers: { 'Retry-After': String(wait) } },
      );
    }
  }

  const r = action === 'register'
    ? registerOwner(String(body?.username || ''), String(body?.password || ''))
    : signIn(String(body?.username || ''), String(body?.password || ''));
  if (!r.ok || !r.token) {
    const missingField = !String(body?.username || '').trim() || !String(body?.password || '');
    // only a real credential guess counts against the limit
    if (action === 'signin' && !missingField) noteFailure(key, SIGNIN_WINDOW_MS);
    return NextResponse.json({ error: r.error, hasUser: hasUser() }, { status: missingField ? 400 : 401 });
  }
  clearFailures(key);
  const res = NextResponse.json({ ok: true, user: r.user });
  res.cookies.set(COOKIE, r.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_MS / 1000),
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  signOut(req.cookies.get(COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
