// Migration 005 — provider telemetry and small app state leave `meta`.
//
// provider_health: one row per provider|model with its last outcome and
// measured latency (the old aiLatency / aiModelStatus blobs).
// app_state: last AI/analysis/collection markers and the scheduler key.
import type { DatabaseSync } from 'node:sqlite';

export const version = 5;
export const name = 'provider-health-and-app-state';

export function up(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_health (
      key TEXT PRIMARY KEY,
      ok INTEGER,
      msg TEXT,
      ts INTEGER,
      retry_at INTEGER,
      latency_ms INTEGER
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated INTEGER NOT NULL DEFAULT 0
    );
  `);
}
