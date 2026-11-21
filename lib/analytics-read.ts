// lib/analytics-read.ts — reading the materialized analytics (ADR-004).
//
// The snapshot is one row: the aggregates the app needs (pattern library,
// topic spikes, hour histogram, digest text, geo regions) for one data
// version and one timezone. It is written by the rebuild task
// (lib/application/analytics.ts) and read from here — so both the
// infrastructure layer (lib/engine.ts) and the application layer can use it
// without depending on each other.
import 'server-only';
import { getStore } from './db';
import { dataVersion } from './data-version';
import { readTimezone } from './timezone-store';
import type { PatternRow } from './domain/patterns';
import type { RecycledCluster } from './domain/recycle';
import type { GeoRegion } from './domain/geo';

export type TopicSpike = {
  name: string; fresh: number; prev: number; pct: number;
  top: { title: string; source: string; link: string; score: number }[];
};

export type SnapshotPayload = {
  total: number;
  last24h: number;
  windowDays: number;
  bySource: { source: string; n: number; eng: number }[];
  securityShare: number;
  risingTopics: { name: string; fresh: number; prev: number; pct: number }[];
  topicSpikes: TopicSpike[];
  topPosts: { title: string; source: string; link: string; score: number }[];
  hours: { counts: number[]; total: number };
  hooks: { agg: any; bySource: any };
  patternRows: PatternRow[];
  winnerCards: string;
  patterns: string;
  recycled: string;
  recycledRows: RecycledCluster[];
  geo: { regions: GeoRegion[]; located: number; unknown: number; noLocation: number };
  analyzedAt: number;
};

export type Snapshot = {
  version: number;
  computedAt: number;
  tz: string;
  payload: SnapshotPayload;
};

/** The snapshot row, if there is one. */
export function readSnapshotRow(): { version: number; computedAt: number; tz: string; payload: string } | undefined {
  try { return getStore().readAnalyticsSnapshot(); } catch { return undefined; }
}

/**
 * The current snapshot — or null when it is missing or stale.
 *
 * Stale means: the data changed since it was built, or the timezone changed
 * (the hour histogram depends on it), or it is older than the refresh window
 * (the time-window metrics — "last 48 h" — go stale on their own).
 */
export function currentSnapshot(opts: { maxAgeMs?: number } = {}): Snapshot | null {
  const row = readSnapshotRow();
  if (!row || !row.payload) return null;
  if (row.version !== dataVersion()) return null;
  if (row.tz !== readTimezone()) return null;
  const maxAge = opts.maxAgeMs ?? 15 * 60 * 1000; // time-window metrics go stale in 15 minutes
  if (Date.now() - row.computedAt > maxAge) return null;
  try {
    const payload = JSON.parse(row.payload) as SnapshotPayload;
    return { version: row.version, computedAt: row.computedAt, tz: row.tz, payload };
  } catch { return null; }
}

/** The snapshot even when it is stale — for diagnostics and "last computed" UI. */
export function anySnapshot(): Snapshot | null {
  const row = readSnapshotRow();
  if (!row || !row.payload) return null;
  try {
    const payload = JSON.parse(row.payload) as SnapshotPayload;
    return { version: row.version, computedAt: row.computedAt, tz: row.tz, payload };
  } catch { return null; }
}
