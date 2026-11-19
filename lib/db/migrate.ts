// lib/db/migrate.ts — ordered, versioned schema migrations on PRAGMA user_version.
//
// One transaction per migration; a failure rolls back and leaves the version
// untouched, so the next boot retries from the same place. Migrations are plain
// TS modules rather than .sql files so the Next bundler ships them without
// runtime file reads.
import type { DatabaseSync } from 'node:sqlite';
import * as initial from './migrations/001-initial';
import * as secrets from './migrations/002-secrets';
import * as settings from './migrations/003-settings';

export type Migration = { version: number; name: string; up(db: DatabaseSync): void };

const MIGRATIONS: Migration[] = [initial, secrets, settings];
export const MIGRATION_VERSION = Math.max(...MIGRATIONS.map(m => m.version));

/** Current PRAGMA user_version (0 = never migrated). */
export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return Number(row?.user_version || 0);
}

/** Apply every migration newer than the stored version; returns the new version. */
export function runMigrations(db: DatabaseSync): number {
  const have = currentVersion(db);
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version <= have) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
      console.info(`[reticle] migration ${m.version} (${m.name}) applied`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    }
  }
  return currentVersion(db);
}
