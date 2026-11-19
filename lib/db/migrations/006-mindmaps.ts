// Migration 006 — mind maps become rows instead of one JSON blob in `meta`.
import type { DatabaseSync } from 'node:sqlite';

export const version = 6;
export const name = 'mindmaps-table';

export function up(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mindmaps (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled map',
      nodes TEXT NOT NULL DEFAULT '[]',
      edges TEXT NOT NULL DEFAULT '[]',
      created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS mindmaps_updated ON mindmaps(updated DESC);
  `);
}
