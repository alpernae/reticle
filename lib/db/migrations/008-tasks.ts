// Migration 008 — the durable task system.
//
// One `tasks` table is the only record of long-running work (ADR-001): AI
// generations, workflows, automations, collector runs. `task_events` is the
// step log Activity renders.
import type { DatabaseSync } from 'node:sqlite';

export const version = 8;
export const name = 'tasks-tables';

export function up(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT '',
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      input TEXT NOT NULL DEFAULT '{}',
      output TEXT,
      error TEXT,
      checkpoint TEXT,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      run_after INTEGER NOT NULL DEFAULT 0,
      lease_until INTEGER,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      page TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      trigger TEXT NOT NULL DEFAULT '',
      created INTEGER NOT NULL DEFAULT 0,
      started INTEGER,
      finished INTEGER
    );
    CREATE INDEX IF NOT EXISTS tasks_ready ON tasks(status, run_after);
    CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent_id);
    CREATE INDEX IF NOT EXISTS tasks_created ON tasks(created);

    CREATE TABLE IF NOT EXISTS task_events (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      at INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'step',
      label TEXT,
      state TEXT,
      data TEXT,
      PRIMARY KEY (task_id, seq)
    );
    CREATE INDEX IF NOT EXISTS task_events_at ON task_events(at);
  `);
}
