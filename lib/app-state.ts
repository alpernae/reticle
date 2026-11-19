// lib/app-state.ts — small operational markers (last AI call, last analysis,
// last collection, the scheduler key). Values live in the app_state table;
// legacy meta keys move over on first read and the meta copy is cleared.
import 'server-only';
import { getStore } from './db';

/** Raw text, migrating a legacy meta value on first access. */
export function readStateRaw(key: string): string | null {
  const store = getStore();
  const value = store.getAppState(key);
  if (value != null) return value;
  const legacy = store.getMeta(key);
  if (legacy == null) return null;
  store.setAppState(key, legacy);
  store.setMeta(key, '');
  return legacy;
}

export function writeStateRaw(key: string, value: string) {
  getStore().setAppState(key, value);
}

export function readState<T>(key: string, fallback: T): T {
  const raw = readStateRaw(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function writeState(key: string, value: unknown) {
  writeStateRaw(key, JSON.stringify(value));
}

export function deleteState(key: string) {
  getStore().deleteAppState(key);
}
