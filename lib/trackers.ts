// lib/trackers.ts — the series trackers you keep between sessions.
//
// One row per tracker (the "Day 295/365" daily log). The client saves the whole
// list at once, so saving replaces the set: rows in the list are written,
// trackers that disappeared are deleted. Legacy meta.trackers moves over on
// first read.
import 'server-only';
import { getStore, type TrackerRow } from './db';
import type { Tracker, TrackerField } from './formats';

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

function rowToTracker(r: TrackerRow): Tracker {
  return {
    id: r.id, preset: r.preset, name: r.name, project: r.project,
    startDate: r.startDate, totalDays: r.totalDays, headline: r.headline, hashtags: r.hashtags,
    fields: parseJson<TrackerField[]>(r.fields, []),
    values: parseJson<Record<string, string>>(r.values, {}),
    log: parseJson<Tracker['log']>(r.log, []),
  };
}

function trackerToRow(t: Tracker, created: number): TrackerRow {
  const now = Date.now();
  return {
    id: t.id, preset: t.preset, name: t.name, project: t.project, startDate: t.startDate,
    totalDays: t.totalDays, headline: t.headline, hashtags: t.hashtags,
    fields: JSON.stringify(t.fields || []).slice(0, 20_000),
    values: JSON.stringify(t.values || {}).slice(0, 20_000),
    log: JSON.stringify(t.log || []).slice(0, 100_000),
    created, updated: now,
  };
}

const clean = (s: unknown, n: number) => String(s ?? '').slice(0, n);

function normalize(t: Partial<Tracker>): Tracker {
  return {
    id: clean(t.id, 40) || 't' + Date.now().toString(36),
    preset: clean(t.preset, 40),
    name: clean(t.name, 120) || 'Untitled tracker',
    project: clean(t.project, 200),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(t.startDate)) ? String(t.startDate) : new Date().toISOString().slice(0, 10),
    totalDays: Math.max(1, Math.min(3650, Math.round(Number(t.totalDays) || 30))),
    headline: clean(t.headline, 300),
    hashtags: clean(t.hashtags, 300),
    fields: (Array.isArray(t.fields) ? t.fields : []).slice(0, 40),
    values: (t.values && typeof t.values === 'object' ? t.values : {}) as Record<string, string>,
    log: (Array.isArray(t.log) ? t.log : []).slice(0, 400),
  };
}

let migratedLegacy = false;
/** One-time, idempotent move of meta.trackers into the table. */
function migrateLegacyTrackers() {
  if (migratedLegacy) return;
  migratedLegacy = true;
  const store = getStore();
  const raw = store.getMeta('trackers');
  if (raw == null) return;
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) for (const t of list as Tracker[]) {
      if (!t?.id || store.getTrackerRow(t.id)) continue;
      store.upsertTrackerRow(trackerToRow(normalize(t), Date.now()));
    }
  } catch {}
  store.setMeta('trackers', ''); // the table is authoritative now
}

export function listTrackers(): Tracker[] {
  migrateLegacyTrackers();
  return getStore().listTrackerRows().map(rowToTracker);
}

/** Replace the saved set with `list` (the client always sends the whole list). */
export function saveTrackers(list: Partial<Tracker>[]): Tracker[] {
  migrateLegacyTrackers();
  const store = getStore();
  const cleanList = (Array.isArray(list) ? list : []).slice(0, 20).map(normalize);
  store.tx(() => {
    for (const t of cleanList) {
      const existing = store.getTrackerRow(t.id);
      store.upsertTrackerRow(trackerToRow(t, existing?.created ?? Date.now()));
    }
    store.deleteTrackersNotIn(cleanList.map(t => t.id));
  });
  return cleanList;
}
