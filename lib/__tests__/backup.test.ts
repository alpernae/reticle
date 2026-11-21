// lib/__tests__/backup.test.ts — the nightly backup, the health picture and
// the live event stream (ADR-004, phase 4e).
//
// The backup is the important one: a copy that is not a working database is
// worse than no copy, so the test opens the copy and reads the rows back.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let db: typeof import('../db');
let backup: typeof import('../backup');
let backupApp: typeof import('../application/backup');
let health: typeof import('../application/health');
let activity: typeof import('../application/activity');
let tasks: typeof import('../application/tasks');
let handlers: typeof import('../application/task-handlers');
let worker: typeof import('../runtime/worker');

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-backup-'));
  db = await import('../db');
  backup = await import('../backup');
  backupApp = await import('../application/backup');
  health = await import('../application/health');
  activity = await import('../application/activity');
  tasks = await import('../application/tasks');
  handlers = await import('../application/task-handlers');
  worker = await import('../runtime/worker');
});

beforeEach(() => {
  const store = db.getStore();
  for (const t of store.listTaskRows({ limit: 500 })) store.deleteTaskRow(t.id);
  store.db.exec('DELETE FROM posts');
  store.db.exec('DELETE FROM manual');
  // a small corpus to copy
  store.upsertPost({
    id: 'b1', source: 'x', title: 'A post', text: 'A post', url: '', link: 'https://example.test/b1',
    score: 12, comments: 3, created: Date.now(), T: '', topics: '["AI & LLMs"]', security: 0, dev: 0,
    views: null, author: 'alice', authorFollowers: 500, authorLocation: null,
    shares: null, saves: null, media: 'text', hashtags: '[]', body: 'A post', durationSec: null,
  });
});

describe('the database backup', () => {
  it('writes a copy that opens as a database and holds the rows', () => {
    const out = backup.runBackup();
    expect(fs.existsSync(out.file)).toBe(true);
    expect(out.bytes).toBeGreaterThan(0);

    const copy = new DatabaseSync(out.file);
    const posts = copy.prepare('SELECT id, score FROM posts').all() as { id: string; score: number }[];
    expect(posts).toEqual([{ id: 'b1', score: 12 }]);
    // a copy is a whole database, not a fragment of one
    const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain('settings');
    expect(tables.map(t => t.name)).toContain('tasks');
    copy.close();
  });

  it('keeps the newest seven copies', () => {
    // start from a clean folder — the other tests wrote copies too
    for (const b of backup.listBackups()) fs.rmSync(b.file, { force: true });
    // nine copies, one minute apart
    for (let i = 0; i < 9; i++) {
      const at = new Date(2026, 10, 20, 10, i).getTime();
      backup.runBackup(at);
    }
    const all = backup.listBackups();
    expect(all.length).toBe(7);
    // the newest are the ones that survive
    expect(all[0].name).toContain('2026-11-20-1008');
    expect(all.map(b => b.name)).not.toContain('data-2026-11-20-1000.sqlite');
  });

  it('names the copies so they sort by time', () => {
    expect(backup.backupName(new Date(2026, 10, 20, 9, 5).getTime())).toBe('data-2026-11-20-0905.sqlite');
  });
});

describe('the backup schedule', () => {
  it('runs at 03:00 local time', () => {
    const at = new Date(2026, 10, 20, 12, 0, 0).getTime();
    const next = new Date(backupApp.nextBackupAt(at));
    expect(next.getHours()).toBe(3);
    expect(next.getDate()).toBe(21); // tomorrow, because 03:00 already passed
    // before 03:00 it is the same day
    const early = new Date(2026, 10, 20, 1, 0, 0).getTime();
    const nextEarly = new Date(backupApp.nextBackupAt(early));
    expect(nextEarly.getDate()).toBe(20);
    expect(nextEarly.getHours()).toBe(3);
  });

  it('keeps exactly one recurring backup task', () => {
    expect(backupApp.ensureBackupTask()).toBe(true);   // the first one
    expect(backupApp.ensureBackupTask()).toBe(false);  // it is already there
    const live = tasks.listTasks({ kind: 'backup', limit: 10 }).filter(t => t.status === 'queued');
    expect(live.length).toBe(1);
  });

  it('reschedules itself after a nightly run and finishes a manual one', async () => {
    const nightly = tasks.enqueueTask({ kind: 'backup', title: 'Nightly database backup' });
    await worker.runUntilIdle();
    const done = tasks.getTask(nightly.id)!;
    expect(done.status).toBe('waiting');
    expect(done.runAfter).toBeGreaterThan(Date.now());
    expect((done.output as any).name).toMatch(/^data-/);

    const manual = tasks.enqueueTask({ kind: 'backup', input: { manual: true }, title: 'Database backup' });
    await worker.runUntilIdle();
    expect(tasks.getTask(manual.id)!.status).toBe('done');
  });
});

describe('the health picture', () => {
  it('describes the database, the worker and the backups', () => {
    const h = health.health();
    expect(h.db.migration).toBe(h.db.expectedMigration);
    expect(h.db.counts.posts).toBe(1);
    expect(h.analytics.posts).toBe(1);
    expect(h.worker).toHaveProperty('running');
    expect(h.providers.providers.length).toBeGreaterThan(0);
    expect(Array.isArray(h.problems)).toBe(true);
  });
});
describe('the activity summary', () => {
  it('counts what runs and what finished', () => {
    const s = activity.activitySummary();
    expect(s.running).toBe(0);
    expect(Array.isArray(s.active)).toBe(true);
    expect(Array.isArray(s.recent)).toBe(true);
  });
});
