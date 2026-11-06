// Auth API — the only open surface (proxy exempts /api/auth). GET reports
// whether an owner exists and who is signed in; POST registers the first
// owner or signs in; DELETE logs out. Sessions are SQLite rows; the browser
// only ever sees an httpOnly, sameSite=lax cookie.
import { NextRequest, NextResponse } from 'next/server';
import { COOKIE, SESSION_MS, hasUser, registerOwner, sessionUser, signIn, signOut } from '@/lib/auth';

export async function GET(req: NextRequest) {
  return NextResponse.json({ hasUser: hasUser(), user: sessionUser(req.cookies.get(COOKIE)?.value) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const action = body?.action === 'register' ? 'register' : 'signin';
  const r = action === 'register'
    ? registerOwner(String(body?.username || ''), String(body?.password || ''))
    : signIn(String(body?.username || ''), String(body?.password || ''));
  if (!r.ok || !r.token) {
    const missingField = !String(body?.username || '').trim() || !String(body?.password || '');
    return NextResponse.json({ error: r.error, hasUser: hasUser() }, { status: missingField ? 400 : 401 });
  }
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
