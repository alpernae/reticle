// lib/application/backup.ts — the nightly backup.
//
// The backup itself is a task (ADR-001): it runs in the worker, never on a
// request path, and it survives a restart. The task reschedules itself —
// after every run it goes back to 'waiting' with the next 03:00 — so there
// is exactly one recurring backup row, whether the app was running or not.
//
// A manual "back up now" (the Settings page) enqueues the same task with
// `manual: true`; that run finishes instead of rescheduling itself.
import 'server-only';
import { enqueueTask, listTasks, type Task } from './tasks';

/** The hour the nightly backup runs (local time). */
export const BACKUP_HOUR = 3;

/** The next 03:00 local time — when the nightly backup runs. */
export function nextBackupAt(from = Date.now()): number {
  const d = new Date(from);
  const next = new Date(d);
  next.setHours(BACKUP_HOUR, 0, 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  return next.getTime();
}

/** The statuses that mean "a backup is already scheduled or running". */
const LIVE = ['queued', 'waiting', 'running', 'paused'];

/**
 * Make sure a recurring backup exists. The scheduler calls this on every
 * tick; it enqueues one task only when there is none.
 */
export function ensureBackupTask(): boolean {
  const has = LIVE.some(status => listTasks({ kind: 'backup', status, limit: 1 }).length > 0);
  if (has) return false;
  enqueueTask({
    kind: 'backup',
    title: 'Nightly database backup',
    trigger: 'scheduler',
    runAfter: nextBackupAt(),
  });
  return true;
}

/** Back up now, as a task. */
export function backupNow(): Task {
  return enqueueTask({
    kind: 'backup',
    title: 'Database backup',
    trigger: 'manual',
    input: { manual: true },
  });
}
