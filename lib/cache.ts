// lib/cache.ts — small derived values (model lists, price tables) that can be
// rebuilt at any time. Caches are never authoritative: a miss or unreadable
// row just returns the fallback. Legacy meta cache keys move over on first read.
import 'server-only';
import { getStore } from './db';

export function readCache<T>(key: string, fallback: T): T {
  const store = getStore();
  let raw = store.getCacheEntry(key);
  if (raw == null) {
    const legacy = store.getMeta(key);
    if (legacy != null) {
      raw = legacy;
      store.setCacheEntry(key, legacy);
      store.setMeta(key, ''); // the cache row is authoritative now
    }
  }
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function writeCache(key: string, value: unknown) {
  getStore().setCacheEntry(key, JSON.stringify(value));
}

export function dropCache(key: string) {
  getStore().deleteCacheEntry(key);
}
