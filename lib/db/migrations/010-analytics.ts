// Migration 010 — the analytics read model (ADR-004).
//
// Analytics used to be rebuilt from scratch on every read: a full table load
// of the posts plus several CPU passes, repeated for each request that wanted
// a number. Now the derived facts live next to the data:
//
//   • posts get their derived columns (engagement, hook, length, outlier …)
//   • author_baselines / platform_baselines hold the yardsticks
//   • analytics_snapshot holds the materialized aggregates (pattern library,
//     topic spikes, hour histogram, digest text) for one data version
//
// The columns start out NULL: the rebuild task fills them the first time it
// runs. Nothing breaks in the meantime — the readers fall back to computing.
import type { DatabaseSync } from 'node:sqlite';

export const version = 10;
export const name = 'analytics-read-model';

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name));
}

export function up(db: DatabaseSync) {
  // ---- posts: the derived facts ----
  const have = columns(db, 'posts');
  const add = (name: string, type: string) => {
    if (!have.has(name)) db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${type}`);
  };
  add('eng', 'INTEGER');            // weighted engagement (likes + 2·comments + 3·shares + 2·saves)
  add('hook', 'TEXT');              // hook type ('question', 'listicle', …)
  add('hookLine', 'TEXT');          // the first line — what the reader sees first
  add('words', 'INTEGER');
  add('lengthBucket', 'TEXT');      // short | medium | long
  add('hasLink', 'INTEGER');
  add('emojiCount', 'INTEGER');
  add('outlier', 'REAL');           // engagement ÷ the creator's (or platform's) normal
  add('baseline', 'TEXT');          // author | audience | platform — which yardstick was used
  add('analyzedAt', 'INTEGER');     // when the derived facts were last computed

  db.exec(`CREATE INDEX IF NOT EXISTS posts_outlier ON posts(outlier DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS posts_source_created ON posts(source, created DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS posts_eng ON posts(eng DESC)`);

  // ---- the yardsticks ----
  db.exec(`CREATE TABLE IF NOT EXISTS author_baselines (
    source TEXT NOT NULL,
    author TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    median_eng REAL NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source, author)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS platform_baselines (
    source TEXT PRIMARY KEY,
    n INTEGER NOT NULL DEFAULT 0,
    median_eng REAL NOT NULL DEFAULT 0,
    median_per_follower REAL NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0
  )`);

  // ---- the snapshot: one row, the materialized read model ----
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 0,
    computed_at INTEGER NOT NULL DEFAULT 0,
    tz TEXT NOT NULL DEFAULT 'UTC',
    payload TEXT NOT NULL DEFAULT '{}'
  )`);
}
