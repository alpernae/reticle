// lib/settings.ts — typed user configuration in its own table.
//
// Values are JSON text with a schema version, so a config change is one row
// write instead of rewriting a shared blob. Legacy `meta` keys are moved here
// once, on first read (the same lazy pattern as lib/secrets.ts), and the
// plaintext meta copy is cleared.
import 'server-only';
import { getStore } from './db';

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

export function readSetting<T>(key: string, fallback: T, parse?: (value: unknown) => T | null): T {
  migrateLegacySettings();
  const row = getStore().getSettingRow(key);
  if (!row) return fallback;
  try {
    const value = JSON.parse(row.value);
    return parse ? (parse(value) ?? fallback) : (value as T);
  } catch {
    return fallback;
  }
}

export function writeSetting(key: string, value: unknown, version = 1) {
  migrateLegacySettings();
  getStore().setSettingRow(key, JSON.stringify(value), version);
}

export function deleteSetting(key: string) {
  migrateLegacySettings();
  getStore().deleteSettingRow(key);
}
