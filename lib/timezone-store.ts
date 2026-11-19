// lib/timezone-store.ts — the user's chosen zone, stored in SQLite `meta`.
// Kept apart from lib/timezone.ts so the pure time math stays client-safe.
import 'server-only';
import { getStore } from './db';
import { isValidTimezone, systemTimezone } from './timezone';

const KEY = 'timezone';

/** Saved zone when valid, otherwise the process default (UTC in Docker). */
export function readTimezone(): string {
  const saved = (getStore().getMeta(KEY) || '').trim();
  return saved && isValidTimezone(saved) ? saved : systemTimezone();
}

/** '' clears the override and follows the server/browser default. */
export function saveTimezone(tz: string): void {
  const v = String(tz || '').trim();
  if (v && !isValidTimezone(v)) throw new Error('Unknown time zone: ' + v);
  getStore().setMeta(KEY, v);
}

const FALLBACK = [
  'UTC', 'Europe/Istanbul', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney',
];

/** Every zone the runtime knows, for the Settings picker. */
export function timezoneOptions(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const list = intl.supportedValuesOf?.('timeZone');
    return list && list.length ? list : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** What Settings renders: the override (if any), the effective zone and the server default. */
export function timezoneInfo() {
  const saved = (getStore().getMeta(KEY) || '').trim() || null;
  return { saved, current: readTimezone(), detected: systemTimezone(), options: timezoneOptions() };
}
