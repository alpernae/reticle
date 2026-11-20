import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { currentVersion, MIGRATION_VERSION, runMigrations } from '../db/migrate';

const cols = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);

describe('migrations', () => {
  it('creates the current schema on a fresh database', () => {
    const db = new DatabaseSync(':memory:');
    try {
      expect(currentVersion(db)).toBe(0);
      expect(runMigrations(db)).toBe(MIGRATION_VERSION);

      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name);
      expect(tables).toEqual(expect.arrayContaining(['posts', 'manual', 'meta', 'users', 'sessions', 'jobs', 'ai_runs', 'secrets', 'settings', 'automations', 'collector_runs', 'cache', 'provider_health', 'app_state', 'mindmaps', 'trackers']));
      expect(tables).not.toContain('accounts');
      expect(cols(db, 'posts')).toEqual(expect.arrayContaining([
        'views', 'aiCats', 'author', 'authorFollowers', 'shares', 'saves',
        'media', 'hashtags', 'body', 'durationSec', 'authorLocation',
      ]));
      expect(cols(db, 'manual')).toEqual(expect.arrayContaining(['likes', 'comments', 'views']));
      expect(cols(db, 'jobs')).toContain('model');
    } finally { db.close(); }
  });

  it('upgrades a legacy database in place and keeps its rows', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE posts (
          id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL,
          text TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
          score INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0,
          T TEXT NOT NULL DEFAULT '', topics TEXT NOT NULL DEFAULT '[]',
          security INTEGER NOT NULL DEFAULT 0, dev INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE manual (
          id INTEGER PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'other', text TEXT NOT NULL DEFAULT '',
          eng INTEGER NOT NULL DEFAULT 0, "when" TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT 'x',
          status TEXT NOT NULL DEFAULT 'queued', steps TEXT NOT NULL DEFAULT '[]', result TEXT NOT NULL DEFAULT '',
          err TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0, started INTEGER, finished INTEGER
        );
        INSERT INTO posts (id, source, title) VALUES ('p1', 'x', 'kept');
      `);

      runMigrations(db);

      expect(currentVersion(db)).toBe(MIGRATION_VERSION);
      expect(cols(db, 'posts')).toEqual(expect.arrayContaining(['views', 'author', 'body']));
      expect(cols(db, 'manual')).toEqual(expect.arrayContaining(['likes', 'comments', 'views']));
      expect(cols(db, 'jobs')).toContain('model');
      expect(db.prepare('SELECT title FROM posts WHERE id = ?').get('p1')).toMatchObject({ title: 'kept' });
    } finally { db.close(); }
  });

  it('is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    try {
      runMigrations(db);
      const first = currentVersion(db);
      expect(runMigrations(db)).toBe(first);
    } finally { db.close(); }
  });
});
