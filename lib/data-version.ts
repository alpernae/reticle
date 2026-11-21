// lib/data-version.ts — the counter that says "the analytics are stale".
//
// Every write that changes what the analytics say bumps this counter. The
// read model (lib/application/analytics.ts) stores the version it was built
// from, so a mismatch means "rebuild" (ADR-004).
//
// It lives here, not in the application layer, because the write paths
// (lib/normalize.ts, lib/engine.ts) are infrastructure and must not depend on
// the application layer.
import 'server-only';
import { getStore } from './db';

const KEY = 'dataVersion';

/** The current data version. */
export function dataVersion(): number {
  const raw = getStore().getAppState(KEY);
  const n = Number(raw || 0);
  return Number.isFinite(n) ? n : 0;
}

/** Mark the analytics as stale; returns the new version. */
export function bumpDataVersion(): number {
  const next = dataVersion() + 1;
  getStore().setAppState(KEY, String(next));
  return next;
}
