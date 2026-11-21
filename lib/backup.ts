// lib/backup.ts — the database backups.
//
// One file, one process, one SQLite database — but a backup is still the
// difference between "a mistake" and "a disaster". SQLite's `VACUUM INTO`
// writes a consistent, compacted copy while the app keeps running: it takes
// a read lock, so no write is blocked for long and the copy needs no WAL
// sidecar files.
//
// The copies live in `DATA_DIR/backups` and the newest seven are kept.
//
// This module is infrastructure: it knows about files and SQL, not about
// tasks or schedules.
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getStore } from './db';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
/** How many copies to keep — a week of nightly backups. */
export const BACKUP_KEEP = 7;

const pad = (n: number) => String(n).padStart(2, '0');

/** The file name of a backup: `data-YYYY-MM-DD-HHmm.sqlite` (sorts by time). */
export function backupName(at = Date.now()): string {
  const d = new Date(at);
  return `data-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.sqlite`;
}

/** The backups on disk, newest first. */
export function listBackups(): { file: string; name: string; bytes: number; at: number }[] {
  let names: string[] = [];
  try { names = fs.readdirSync(BACKUP_DIR); } catch { return []; }
  const out: { file: string; name: string; bytes: number; at: number }[] = [];
  for (const name of names) {
    if (!/^data-.*\.sqlite$/.test(name)) continue;
    const file = path.join(BACKUP_DIR, name);
    try {
      const st = fs.statSync(file);
      out.push({ file, name, bytes: st.size, at: st.mtimeMs });
    } catch { /* a file that vanished between readdir and stat */ }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

/** Delete the copies beyond the newest `keep`. Returns what was removed. */
export function pruneBackups(keep = BACKUP_KEEP): string[] {
  const all = listBackups();
  const gone: string[] = [];
  for (const b of all.slice(keep)) {
    try { fs.rmSync(b.file, { force: true }); gone.push(b.name); } catch { /* next time */ }
  }
  return gone;
}

/**
 * Write one backup.
 *
 * `VACUUM INTO` takes a file name, not a bound parameter, so the path is
 * quoted here — it comes from DATA_DIR, but a quote in a directory name must
 * not become SQL.
 */
export function runBackup(at = Date.now()): { file: string; name: string; bytes: number; pruned: string[] } {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = backupName(at);
  const file = path.join(BACKUP_DIR, name);
  // VACUUM INTO refuses to overwrite — a backup with the same minute is replaced
  try { fs.rmSync(file, { force: true }); } catch { /* it was not there */ }
  const store = getStore();
  store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  let bytes = 0;
  try { bytes = fs.statSync(file).size; } catch { /* the copy is there or it is not */ }
  const pruned = pruneBackups();
  return { file, name, bytes, pruned };
}
