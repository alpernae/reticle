// lib/http/rate-limit.ts — a small in-memory counter for the open surfaces.
//
// Reticle is local-first, but the Docker image binds 0.0.0.0, so the app can
// be reachable on a LAN. The one endpoint anyone can hammer is sign-in, so it
// gets a simple limit: a few failures per window, per IP.
//
// The counter lives in memory only. A restart clears it, which is fine for a
// brute-force guard — the scrypt hash is the real defense, this just makes
// guessing expensive.
import 'server-only';

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** The caller's IP as the server sees it (the first proxy hop if there is one). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0]?.trim();
  if (first) return first;
  const real = (req.headers.get('x-real-ip') || '').trim();
  if (real) return real;
  return 'local';
}

/** Drop expired buckets so the map cannot grow without bound. */
function sweep(now: number) {
  if (buckets.size < 500) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/**
 * How long the caller must wait before it may try again — 0 when it may.
 * The bucket counts failures, so a fresh visitor is never blocked.
 */
export function limitRetryAfter(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return 0;
  if (b.count < limit) return 0;
  return Math.max(1, Math.ceil((b.resetAt - now) / 1000));
}

/** Count one failure against the key. */
export function noteFailure(key: string, windowMs: number): number {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  b.count += 1;
  return b.count;
}

/** Forget the key's failures — a successful sign-in clears the slate. */
export function clearFailures(key: string): void {
  buckets.delete(key);
}
