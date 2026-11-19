// Migration 001 — the schema Reticle had before versioning existed.
//
// New databases get the full shape directly. Databases created by older
// builds are upgraded in place: CREATE TABLE IF NOT EXISTS leaves them alone,
// and addMissing() adds the columns that used to be bolted on by ensureColumns().
import type { DatabaseSync } from 'node:sqlite';

export const version = 1;
export const name = 'initial-schema';

const POST_V2: [string, string][] = [
  ['views', 'INTEGER'], ['aiCats', 'TEXT'], ['author', 'TEXT'], ['authorFollowers', 'INTEGER'],
  ['shares', 'INTEGER'], ['saves', 'INTEGER'], ['media', 'TEXT'], ['hashtags', 'TEXT'],
  ['body', 'TEXT'], ['durationSec', 'INTEGER'], ['authorLocation', 'TEXT'],
];

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name));
}

function addMissing(db: DatabaseSync, table: string, cols: [string, string][]) {
  const have = columns(db, table);
  for (const [col, type] of cols) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}

export function up(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0,
      T TEXT NOT NULL DEFAULT '', topics TEXT NOT NULL DEFAULT '[]',
      security INTEGER NOT NULL DEFAULT 0, dev INTEGER NOT NULL DEFAULT 0,
      views INTEGER, aiCats TEXT, author TEXT, authorFollowers INTEGER,
      shares INTEGER, saves INTEGER, media TEXT, hashtags TEXT,
      body TEXT, durationSec INTEGER, authorLocation TEXT
    );

    CREATE TABLE IF NOT EXISTS manual (
      id INTEGER PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'other', text TEXT NOT NULL DEFAULT '',
      eng INTEGER NOT NULL DEFAULT 0, "when" TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL DEFAULT 0,
      likes INTEGER, comments INTEGER, views INTEGER
    );

    -- Unused since the first prototype; dropped in migration 002.
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, handle TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'x', niche TEXT NOT NULL DEFAULT 'dev', notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      passHash TEXT NOT NULL,
      created INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user TEXT NOT NULL,
      created INTEGER NOT NULL DEFAULT 0,
      expires INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT 'x',
      status TEXT NOT NULL DEFAULT 'queued', steps TEXT NOT NULL DEFAULT '[]', result TEXT NOT NULL DEFAULT '',
      err TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0, started INTEGER, finished INTEGER,
      model TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', page TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '', input TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'running',
      steps TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
      created INTEGER NOT NULL DEFAULT 0, finished INTEGER, ms INTEGER
    );
  `);

  // Legacy databases: add the columns older builds created lazily.
  addMissing(db, 'posts', POST_V2);
  addMissing(db, 'manual', [['likes', 'INTEGER'], ['comments', 'INTEGER'], ['views', 'INTEGER']]);
  addMissing(db, 'jobs', [['model', "TEXT NOT NULL DEFAULT ''"]]);

  db.exec(`
    CREATE INDEX IF NOT EXISTS posts_created ON posts(created);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user);
    CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created);
    CREATE INDEX IF NOT EXISTS ai_runs_created ON ai_runs(created);
  `);
}
