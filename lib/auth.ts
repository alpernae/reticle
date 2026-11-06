// lib/auth.ts — local sign-in. One owner account lives in the SQLite users
// table (created from the /login page in setup mode); sessions are random
// tokens in the sessions table surfaced to the browser as an httpOnly cookie.
// Passwords are scrypt-hashed with a per-user salt — plaintext is never stored.
import 'server-only';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getStore } from './db';
import { COOKIE } from './auth-cookie';

export { COOKIE };
export const SESSION_MS = 30 * 24 * 3600 * 1000; // 30 days

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const cand = scryptSync(pw, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return cand.length === want.length && timingSafeEqual(cand, want);
}

export type AuthResult = { ok: boolean; user?: string; token?: string; error?: string };

/** Whether an owner account exists — the login page flips between setup and sign-in. */
export function hasUser(): boolean {
  return getStore().countUsers() > 0;
}

/** Create the owner account. Refused once one exists (it is the only account). */
export function registerOwner(username: string, password: string): AuthResult {
  const user = String(username || '').trim();
  if (!user) return { ok: false, error: 'Pick a username first.' };
  if (String(password || '').length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
  const store = getStore();
  if (store.countUsers() > 0) return { ok: false, error: 'An account already exists — sign in instead.' };
  store.addUser(user, hashPassword(password));
  return signIn(user, password); // straight into the first session
}

export function signIn(username: string, password: string): AuthResult {
  const row = getStore().getUser(String(username || '').trim());
  if (!row || !verifyPassword(String(password || ''), row.passHash))
    return { ok: false, error: 'Wrong username or password.' };
  const token = randomBytes(32).toString('hex');
  getStore().addSession(token, row.username, Date.now() + SESSION_MS);
  return { ok: true, user: row.username, token };
}

/** Username behind a session token, or null. Expired sessions are dropped on read. */
export function sessionUser(token: string | undefined | null): string | null {
  if (!token) return null;
  const s = getStore().getSession(token);
  return s ? s.user : null;
}

export function signOut(token: string | undefined | null) {
  if (token) getStore().delSession(token);
}
