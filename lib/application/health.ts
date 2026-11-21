// lib/application/health.ts — what the app can say about itself.
//
// One endpoint that answers "is everything alright?" in one round trip: the
// database (size, migration, counts), the task worker, the analytics read
// model, the AI providers and the backups. It is the first thing to look at
// when something feels off — and the payload an uptime check would read.
//
// Nothing here is secret: it is the same information the Settings page shows.
import 'server-only';
import { getStore, dbStats } from '../db';
import { MIGRATION_VERSION } from '../db/migrate';
import { currentSnapshot } from '../analytics-read';
import { dataVersion } from '../data-version';
import { aiHealth } from '../ai';
import { workerStatus } from '../runtime/worker';
import { listBackups, BACKUP_DIR } from '../backup';

export type Health = {
  ok: boolean;
  now: number;
  uptimeMs: number;
  db: {
    file: string;
    sizeBytes: number;
    journal: string;
    migration: number;
    expectedMigration: number;
    counts: { posts: number; winners: number; jobs: number; meta: number };
  };
  worker: { running: number; bootAt: number; tasks: { id: string; kind: string }[] };
  analytics: { version: number; dataVersion: number; computedAt: number | null; current: boolean; posts: number };
  providers: ReturnType<typeof aiHealth>;
  backups: { dir: string; count: number; latest: { name: string; bytes: number; at: number } | null };
  problems: string[];
};

/** The whole health picture. */
export function health(): Health {
  const store = getStore();
  const stats = dbStats();
  const snap = currentSnapshot();
  const worker = workerStatus();
  const backups = listBackups();
  const version = dataVersion();

  const problems: string[] = [];
  if (stats.counts.posts > 0 && !snap) problems.push('the analytics read model is stale');
  if (!backups.length) problems.push('no database backup yet');
  if (worker.running > 6) problems.push('more tasks are running than the worker allows');

  const userVersion = Number((store.db.prepare('PRAGMA user_version').get() as { user_version: number })?.user_version ?? 0);

  return {
    ok: problems.length === 0,
    now: Date.now(),
    uptimeMs: Date.now() - worker.bootAt,
    db: {
      file: stats.file,
      sizeBytes: stats.sizeBytes,
      journal: stats.journal,
      migration: userVersion,
      expectedMigration: MIGRATION_VERSION,
      counts: stats.counts,
    },
    worker: { running: worker.running, bootAt: worker.bootAt, tasks: worker.tasks.map(t => ({ id: t.id, kind: t.kind })) },
    analytics: {
      version: snap?.version ?? -1,
      dataVersion: version,
      computedAt: snap?.computedAt ?? null,
      current: !!snap,
      posts: store.count(),
    },
    providers: aiHealth(),
    backups: {
      dir: BACKUP_DIR,
      count: backups.length,
      latest: backups[0] ? { name: backups[0].name, bytes: backups[0].bytes, at: backups[0].at } : null,
    },
    problems,
  };
}
