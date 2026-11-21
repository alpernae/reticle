// lib/settings.ts — typed user configuration in its own table.
//
// Values are JSON text with a schema version, so a config change is one row
// write instead of rewriting a shared blob. Legacy `meta` keys are moved here
// once, on first read (the same lazy pattern as lib/secrets.ts), and the
// plaintext meta copy is cleared.
import 'server-only';
import { getStore } from './db';
import { schemaFor } from './settings-schema';

/** Thrown when a value does not fit the key's schema (ADR-003). */
export class SettingError extends Error {
  /** The HTTP status a route should answer with (the wrapper honours it). */
  readonly status = 400;
  constructor(readonly key: string, message: string) { super(message); this.name = 'SettingError'; }
}

/** Keys whose meta value was already JSON text. */
const LEGACY_JSON = ['aiConfig', 'apifyConfig', 'creatorProfile', 'playbook'];
/** Keys whose meta value was a plain string. */
const LEGACY_STRING = ['timezone'];
/** Keys whose meta value was a plain number. */
const LEGACY_NUMBER = ['apifyBudgetUsd', 'aiDailyRunBudget'];

let migratedLegacy = false;

/** One-time, idempotent move of config keys from meta into settings. */
export function migrateLegacySettings() {
  if (migratedLegacy) return;
  migratedLegacy = true;
  const store = getStore();
  for (const key of [...LEGACY_JSON, ...LEGACY_STRING, ...LEGACY_NUMBER]) {
    const raw = store.getMeta(key);
    if (raw == null) continue;
    if (!store.getSettingRow(key)) {
      let value: string | null = null;
      if (LEGACY_JSON.includes(key)) {
        try { JSON.parse(raw); value = raw; } catch { value = null; } // leave unreadable config alone
      } else if (LEGACY_STRING.includes(key)) {
        value = JSON.stringify(raw);
      } else {
        value = JSON.stringify(Number(raw) || 0);
      }
      if (value != null) store.setSettingRow(key, value, 1);
    }
    if (store.getSettingRow(key)) store.setMeta(key, ''); // the settings row is authoritative now
  }
}

/**
 * Read one setting.
 *
 * The row is checked against the key's schema (ADR-003): a value that does
 * not fit falls back to the default instead of reaching the page — a broken
 * setting is never worse than a missing one. A `parse` function may narrow
 * the value further; it wins over the schema's verdict.
 */
export function readSetting<T>(key: string, fallback: T, parse?: (value: unknown) => T | null): T {
  migrateLegacySettings();
  const row = getStore().getSettingRow(key);
  if (!row) return fallback;
  let value: unknown;
  try { value = JSON.parse(row.value); } catch { return fallback; }
  const schema = schemaFor(key);
  if (schema) {
    const checked = schema.check(value);
    if (!checked.ok) {
      console.warn(`[settings] "${key}" holds an invalid value (${checked.error}) — using the default`);
      return fallback;
    }
    value = checked.value;
  }
  if (parse) return parse(value) ?? fallback;
  return value as T;
}

/**
 * Write one setting.
 *
 * A value that does not fit the key's schema is refused (ADR-003): the row
 * keeps the last good value instead of storing something the readers cannot
 * make sense of. Keys this build does not know about are stored as they are.
 */
export function writeSetting(key: string, value: unknown, version = 1) {
  migrateLegacySettings();
  const schema = schemaFor(key);
  if (schema) {
    const checked = schema.check(value);
    if (!checked.ok) throw new SettingError(key, `"${key}" is not a valid value: ${checked.error}`);
  }
  getStore().setSettingRow(key, JSON.stringify(value), version);
}

export function deleteSetting(key: string) {
  migrateLegacySettings();
  getStore().deleteSettingRow(key);
}
