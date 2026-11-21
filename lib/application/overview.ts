// lib/application/overview.ts — the Overview page's read model (ADR-004).
//
// The Overview used to receive EVERY post and bucket them in the browser:
// a payload that grew with the corpus (and carried every body with it). Now
// the server does the bucketing. The page asks for a platform, a category and
// a search term; it gets back the day buckets, the counts and the aggregates
// — a few kilobytes, whatever the corpus size.
//
// The numbers are the same ones the old client-side code produced: the day
// buckets use the same "days since now" arithmetic and the same labels.
import 'server-only';
import { getStore } from '../db';
import { readState } from '../app-state';
import { currentSnapshot } from '../analytics-read';
import { topicSpikes, hookStats, hourHistogram } from '../engine';
import { geoRegions } from '../domain/geo';
import { inCategory, CATEGORIES } from '../categories';import type { Manual } from '../domain/post';
import type { TopicSpike } from '../analytics-read';

const DAY = 864e5;
/** How many day buckets the Overview keeps: 90 days of chart + 90 days of
 *  "the window before it" for the delta chips. */
export const OVERVIEW_DAYS = 180;
/** The day-by-day table covers the last 30 days. */
const TABLE_DAYS = 30;

export type OverviewDay = {
  i: number;             // the bucket index (0 = oldest)
  label: string;         // 'Thu, Nov 20'
  labelFull: string;     // 'Thu, Nov 20, 2026'
  date: string;          // '2026-11-20'
  posts: number;
  eng: number;           // score + 2×comments
  score: number;
  comments: number;
  peak: { title: string; link: string; source: string; created: number; score: number; comments: number } | null;
};

export type OverviewPayload = {
  now: number;
  days: OverviewDay[];        // every bucket, oldest → newest
  table: OverviewDay[];       // the last 30 days, non-empty, matching the search
  counts: { total: number; platformTotal: number; bySource: Record<string, number>; security: number };
  categoryCounts: Record<string, number>;
  sources: string[];          // every source in the corpus (the platform tabs)
  topics: TopicSpike[];
  hours: { counts: number[]; total: number };
  hooks: { agg: any; bySource: any };
  manual: Manual[];
  geo: { regions: any[]; located: number; unknown: number; noLocation: number };
  lastAnalysis: any;
  analyzedAt: number | null;
};

const safeList = (s: string | null | undefined): string[] => {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** Build the Overview payload for the given filters. */
export function buildOverview(opts: { platform?: string; category?: string; q?: string } = {}): OverviewPayload {
  const store = getStore();
  const platform = (opts.platform || '').trim();
  const category = (opts.category || '').trim();
  const query = (opts.q || '').trim().toLowerCase();

  const now = Date.now();
  const rows = store.compactPostRows();

  // ---- the corpus, split by the filters ----
  const parsed = rows.map(r => ({
    ...r,
    topics: safeList(r.topics),
    aiCats: safeList(r.aiCats),
  }));
  const byPlatform = platform ? parsed.filter(r => r.source === platform) : parsed;
  const filtered = category ? byPlatform.filter(r => inCategory(r, category)) : byPlatform;

  // ---- the day buckets ----
  type Bucket = OverviewDay & { titles: string[] };
  const buckets: Bucket[] = [];
  for (let k = 0; k < OVERVIEW_DAYS; k++) {
    const stamp = new Date(now - (OVERVIEW_DAYS - 1 - k) * DAY);
    buckets.push({
      i: k,
      label: stamp.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      labelFull: stamp.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      date: stamp.toISOString().slice(0, 10),
      posts: 0, eng: 0, score: 0, comments: 0, peak: null, titles: [],
    });
  }
  for (const r of filtered) {
    if (!r.created) continue;
    const ago = Math.floor((now - r.created) / DAY);
    if (ago < 0 || ago >= OVERVIEW_DAYS) continue;
    const b = buckets[OVERVIEW_DAYS - 1 - ago];
    b.posts += 1;
    b.eng += r.score + 2 * r.comments;
    b.score += r.score;
    b.comments += r.comments;
    if (!b.peak || r.score + 2 * r.comments > b.peak.score + 2 * b.peak.comments) {
      b.peak = { title: r.title, link: r.link, source: r.source, created: r.created, score: r.score, comments: r.comments };
    }
    b.titles.push(r.title);
  }

  // ---- the day-by-day table: the last 30 days, matching the search ----
  const table: OverviewDay[] = [];
  for (let k = OVERVIEW_DAYS - TABLE_DAYS; k < OVERVIEW_DAYS; k++) {
    const b = buckets[k];
    if (!b.posts) continue;
    if (query) {
      const hay = `${b.label} ${b.titles.join(' ')}`.toLowerCase();
      if (!hay.includes(query)) continue;
    }
    const { titles: _titles, ...day } = b;
    table.push(day);
  }
  table.reverse(); // newest first

  // ---- the counts the page shows ----
  const bySource: Record<string, number> = {};
  let security = 0;
  for (const r of filtered) {
    bySource[r.source] = (bySource[r.source] || 0) + 1;
    if (r.security) security += 1;
  }
  const categoryCounts: Record<string, number> = {};
  for (const c of CATEGORIES) categoryCounts[c.key] = byPlatform.filter(r => inCategory(r, c.key)).length;

  // ---- the aggregates (unfiltered: they are computed over the whole corpus) ----
  const snap = currentSnapshot();
  const topics = snap ? snap.payload.topicSpikes : topicSpikes();
  const hooks = snap ? snap.payload.hooks : hookStats();
  const hours = snap ? snap.payload.hours : hourHistogram();
  const geo = snap ? snap.payload.geo : geoRegions(rows.map(r => ({
    source: r.source, author: r.author || undefined, authorLocation: undefined,
    created: r.created, outlier: r.outlier ?? 0, title: r.title, link: r.link,
  })));

  return {
    now,
    days: buckets.map(({ titles: _t, ...d }) => d),
    table,
    counts: { total: filtered.length, platformTotal: byPlatform.length, bySource, security },
    categoryCounts,
    sources: Object.keys(store.sourceCounts()).sort(),
    topics,
    hours,
    hooks,
    manual: store.allManual() as unknown as Manual[],
    geo,
    lastAnalysis: readState<any>('lastAnalysis', null),
    analyzedAt: snap?.computedAt ?? null,
  };
}
