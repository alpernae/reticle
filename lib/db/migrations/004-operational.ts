// Migration 004 — operational state leaves `meta`: automations, collector runs
// and small caches become queryable tables with their own indexes.
import type { DatabaseSync } from 'node:sqlite';

export const version = 4;
export const name = 'operational-tables';

export function up(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      steps TEXT NOT NULL DEFAULT '[]',
      schedule TEXT NOT NULL DEFAULT '{"type":"manual"}',
      next_run INTEGER,
      last_run INTEGER,
      history TEXT NOT NULL DEFAULT '[]',
      created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS automations_due ON automations(enabled, next_run);

    CREATE TABLE IF NOT EXISTS collector_runs (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT '',
      actor TEXT NOT NULL DEFAULT '',
      ts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      items INTEGER,
      imported TEXT,
      error TEXT,
      note TEXT,
      cost_usd REAL
    );
    CREATE INDEX IF NOT EXISTS collector_runs_ts ON collector_runs(ts DESC);

    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated INTEGER NOT NULL DEFAULT 0
    );
  `);
}
