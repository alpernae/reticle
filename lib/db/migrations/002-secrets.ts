// Migration 002 — encrypted secret storage; drop the unused prototype table.
import type { DatabaseSync } from 'node:sqlite';

export const version = 2;
export const name = 'encrypted-secrets';

export function up(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      name TEXT PRIMARY KEY,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      updated INTEGER NOT NULL DEFAULT 0
    );
    DROP TABLE IF EXISTS accounts;
  `);
}
