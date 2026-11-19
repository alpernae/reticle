// Migration 003 — typed settings (user configuration), separate from secrets,
// operational state and caches. Values are JSON text with a schema version.
import type { DatabaseSync } from 'node:sqlite';

export const version = 3;
export const name = 'settings-table';

export function up(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated INTEGER NOT NULL DEFAULT 0
    );
  `);
}
