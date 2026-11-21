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
      expect(tables).toEqual(expect.arrayContaining(['posts', 'manual', 'meta', 'users', 'sessions', 'secrets', 'settings', 'automations', 'collector_runs', 'cache', 'provider_health', 'app_state', 'mindmaps', 'trackers', 'tasks', 'task_events']));
      expect(tables).not.toContain('accounts');
      // the old Activity log and the Studio jobs are gone — tasks replaced them
      expect(tables).not.toContain('ai_runs');
      expect(tables).not.toContain('jobs');
      expect(cols(db, 'posts')).toEqual(expect.arrayContaining([
        'views', 'aiCats', 'author', 'authorFollowers', 'shares', 'saves',
        'media', 'hashtags', 'body', 'durationSec', 'authorLocation',
      ]));
      expect(cols(db, 'manual')).toEqual(expect.arrayContaining(['likes', 'comments', 'views']));
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
          T TEXT NOT NULL DEFAULT '', topics TEXT NOT NULL DEFAULT '[]', security INTEGER NOT NULL DEFAULT 0, dev INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE manual (
          id INTEGER PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'other', text TEXT NOT NULL DEFAULT '',
          eng INTEGER NOT NULL DEFAULT 0, "when" TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO posts (id, source, title) VALUES ('p1', 'x', 'kept');
      `);

      runMigrations(db);

      expect(currentVersion(db)).toBe(MIGRATION_VERSION);
      expect(cols(db, 'posts')).toEqual(expect.arrayContaining(['views', 'author', 'body']));
      expect(cols(db, 'manual')).toEqual(expect.arrayContaining(['likes', 'comments', 'views']));
      expect(db.prepare('SELECT title FROM posts WHERE id = ?').get('p1')).toMatchObject({ title: 'kept' });
    } finally { db.close(); }
  });

  it('moves the old Activity log and Studio jobs into tasks', () => {
    const db = new DatabaseSync(':memory:');
    try {
      // an old database, before the task table existed
      db.exec(`
        CREATE TABLE ai_runs (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', page TEXT NOT NULL DEFAULT '',
          platform TEXT NOT NULL DEFAULT '', input TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'running',
          steps TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
          output TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
          created INTEGER NOT NULL DEFAULT 0, finished INTEGER, ms INTEGER
        );
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT 'x',
          status TEXT NOT NULL DEFAULT 'queued', steps TEXT NOT NULL DEFAULT '[]', result TEXT NOT NULL DEFAULT '',
          err TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL DEFAULT 0, started INTEGER, finished INTEGER,
          model TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO ai_runs (id, kind, title, page, platform, input, status, steps, provider, model, output, error, created, finished, ms)
          VALUES ('run1', 'generate', 'A draft', '/generate', 'x', '{"idea":"x"}', 'done',
                  '[{"label":"Writing","at":100,"state":"done"}]', 'claude-cli', 'sonnet', '{"mode":"ai"}', '', 100, 200, 100);
        INSERT INTO ai_runs (id, kind, status, created) VALUES ('run2', 'tool', 'running', 100);
        INSERT INTO jobs (id, kind, topic, platform, status, steps, result, err, created, started, finished, model)
          VALUES ('job1', 'dive', 'AI', 'x', 'done',
                  '[{"name":"recon","label":"Read the room","state":"done","note":"12 chars","dur":3}]',
                  'the result', '', 100, 110, 200, 'claude-cli|sonnet');
      `);

      runMigrations(db);

      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name);
      expect(tables).not.toContain('ai_runs');
      expect(tables).not.toContain('jobs');

      const run = db.prepare('SELECT * FROM tasks WHERE id = ?').get('run1') as any;
      expect(run.kind).toBe('generate');
      expect(run.title).toBe('A draft');
      expect(run.status).toBe('done');
      expect(run.provider).toBe('claude-cli');
      expect(run.model).toBe('sonnet');
      expect(run.output).toBe('{"mode":"ai"}');
      expect(run.created).toBe(100);
      expect(run.finished).toBe(200);
      // its step log moved with it
      const steps = db.prepare('SELECT label, state FROM task_events WHERE task_id = ? ORDER BY seq').all('run1') as any[];
      expect(steps).toEqual([{ label: 'Writing', state: 'done' }]);

      // a run that was 'running' when the app stopped can never finish
      const orphan = db.prepare('SELECT status, error FROM tasks WHERE id = ?').get('run2') as any;
      expect(orphan.status).toBe('failed');
      expect(orphan.error).toContain('interrupted');

      // the Studio jobs became workflow tasks
      const job = db.prepare('SELECT * FROM tasks WHERE id = ?').get('job1') as any;
      expect(job.kind).toBe('workflow');
      expect(job.status).toBe('done');
      expect(job.title).toContain('dive');
      expect(JSON.parse(job.input).topic).toBe('AI');
      expect(JSON.parse(job.output).result).toBe('the result');
      const jobSteps = db.prepare('SELECT label, state, data FROM task_events WHERE task_id = ?').all('job1') as any[];
      expect(jobSteps[0].label).toBe('Read the room');
      expect(jobSteps[0].state).toBe('done');
      expect(JSON.parse(jobSteps[0].data).dur).toBe(3);
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
