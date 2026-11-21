// Migration 007 — series trackers become rows instead of one JSON blob in `meta`.
import type { DatabaseSync } from 'node:sqlite';

export const version = 7;
export const name = 'trackers-table';

export function up(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trackers (
      id TEXT PRIMARY KEY,
      preset TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      total_days INTEGER NOT NULL DEFAULT 0,
      headline TEXT NOT NULL DEFAULT '',
      hashtags TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '[]',
      vals TEXT NOT NULL DEFAULT '{}',
      log TEXT NOT NULL DEFAULT '[]',
      created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0
    );
  `);
}
