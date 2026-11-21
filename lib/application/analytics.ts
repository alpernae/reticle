// lib/application/analytics.ts — the analytics read model (ADR-004).
//
// Analytics used to be rebuilt on every read: a full load of the posts plus
// several CPU passes, repeated for each request that wanted a number. Now:
//
//   • the per-post facts (engagement, hook, length, outlier) live in the posts
//     table, written when the data changes;
//   • the yardsticks (creator median, platform median) live in the baseline
//     tables;
//   • the aggregates (pattern library, topic spikes, hour histogram, digest
//     text, geo regions) live in one snapshot row, keyed by the data version.
//
// The rebuild runs as a task (never on a request path). Until it has run, the
// readers fall back to computing — so behaviour never depends on the cache.
import 'server-only';
import { getStore } from '../db';
import { dataVersion } from '../data-version';
import { readTimezone } from '../timezone-store';
import { derive, engagement, outlierOf, computeBaselines, patternLibrary, patternTable, winners, winnerCard } from '../domain/patterns';
import { findRecycled, recycledText, type RecycledCluster } from '../domain/recycle';
import { geoRegions, type GeoRegion } from '../domain/geo';
import { hourInTz, weekdayInTz } from '../domain/timezone';
import { TOPICS } from '../domain/topics';
import { enqueueTask } from './tasks';
import type { Post } from '../domain/post';
import type { SnapshotPayload, TopicSpike } from '../analytics-read';

export { currentSnapshot, readSnapshotRow, anySnapshot } from '../analytics-read';
export type { Snapshot, SnapshotPayload, TopicSpike } from '../analytics-read';

/** The data version: bumped by every write that changes what analytics say. */
export { dataVersion } from '../data-version';

/**
 * Queue a rebuild, debounced. Several writes in a row (an import of 500
 * posts) must not queue 500 rebuilds — the pending task is pushed back a
 * little instead, so the work happens once, shortly after the last write.
 */
export function scheduleRebuild(delayMs = 2_000): string {
  const store = getStore();
  const pending = store.listTaskRows({ kind: 'analytics', limit: 20 })
    .find(t => t.status === 'queued' || t.status === 'waiting' || t.status === 'running');
  if (pending) {
    if (pending.status === 'queued' || pending.status === 'waiting') {
      store.patchTaskRow(pending.id, { runAfter: Date.now() + delayMs });
    }
    return pending.id;
  }
  return enqueueTask({
    kind: 'analytics',
    title: 'Rebuild analytics',
    trigger: 'system',
    runAfter: Date.now() + delayMs,
  }).id;
}

// ---------------- the rebuild ----------------

type Row = {
  id: string; source: string; title: string; text: string; link: string; score: number; comments: number;
  created: number; topics: string; security: number; dev: number; views: number | null;
  author: string | null; authorFollowers: number | null; authorLocation: string | null;
  shares: number | null; saves: number | null; media: string | null; hashtags: string | null;
  body: string | null; durationSec: number | null;
};

const safeList = (s: string | null | undefined): string[] => {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
};

export function rowToPost(r: Row): Post {
  return {
    id: r.id, source: r.source, title: r.title, text: r.text, url: '', link: r.link,
    score: r.score, comments: r.comments, created: r.created,
    topics: safeList(r.topics), security: !!r.security, dev: !!r.dev,
    views: r.views != null ? Number(r.views) : undefined,
    author: r.author || undefined,
    authorFollowers: r.authorFollowers != null ? Number(r.authorFollowers) : undefined,
    authorLocation: r.authorLocation || undefined,
    shares: r.shares != null ? Number(r.shares) : undefined,
    saves: r.saves != null ? Number(r.saves) : undefined,
    media: r.media || undefined,
    hashtags: safeList(r.hashtags),
    body: r.body || undefined,
    durationSec: r.durationSec != null ? Number(r.durationSec) : undefined,
  };
}

/** Topic spikes over the last 48 hours vs the 48 before that. */
export function computeTopicSpikes(posts: Post[], now: number): TopicSpike[] {
  const fresh = [now - 48 * 36e5, now] as [number, number];
  const prev = [now - 96 * 36e5, now - 48 * 36e5] as [number, number];
  const inWin = (p: Post, [a, b]: [number, number]) => p.created >= a && p.created < b;
  // the same topic list the live analyzer uses, so the snapshot and the
  // fallback answer the same question
  const names = TOPICS.map(([name]) => name);
  return names.map((name) => {
    const f = posts.filter(p => inWin(p, fresh) && p.topics!.includes(name));
    const q = posts.filter(p => inWin(p, prev) && p.topics!.includes(name));
    const pct = q.length ? Math.round(((f.length - q.length) / q.length) * 100) : (f.length ? 100 : 0);
    return {
      name, fresh: f.length, prev: q.length, pct,
      top: [...f].sort((a, b) => (b.score + 2 * b.comments) - (a.score + 2 * a.comments)).slice(0, 3)
        .map(p => ({ title: p.title, source: p.source, link: p.link, score: p.score })),
    };
  }).sort((a, b) => b.fresh - a.fresh || b.pct - a.pct);
}

/** What the winning titles look like, per source. */
export function computeHookStats(posts: Post[]) {
  const bySource: Record<string, any> = {};
  const agg: any = { winners: 0, numbers: 0, how: 0, questions: 0, colon: 0, lenSum: 0 };
  for (const src of new Set(posts.map(p => p.source))) {
    const rows = posts.filter(p => p.source === src && p.score > 3);
    if (rows.length < 10) continue;
    const scores = rows.map(p => p.score).sort((a, b) => a - b);
    const th = scores[Math.floor(scores.length * 0.75)];
    const win = rows.filter(p => p.score >= th);
    let numbers = 0, how = 0, questions = 0, colon = 0, lenSum = 0;
    for (const p of win) {
      const t = p.title;
      if (/\d/.test(t)) numbers++;
      if (/^(how|why|what|is|does|can|stop|the)\b/i.test(t)) how++;
      if (/\?/.test(t)) questions++;
      if (/:\s/.test(t)) colon++;
      lenSum += t.length;
    }
    bySource[src] = { winners: win.length, total: rows.length, numbers, how, questions, colon, avgLen: Math.round(lenSum / (win.length || 1)) };
    agg.winners += win.length; agg.numbers += numbers; agg.how += how; agg.questions += questions; agg.colon += colon; agg.lenSum += lenSum;
  }
  if (agg.winners) agg.avgLen = Math.round(agg.lenSum / agg.winners);
  agg.numbers = Math.round((agg.numbers / (agg.winners || 1)) * 100);
  agg.how = Math.round((agg.how / (agg.winners || 1)) * 100);
  agg.questions = Math.round((agg.questions / (agg.winners || 1)) * 100);
  agg.colon = Math.round((agg.colon / (agg.winners || 1)) * 100);
  return { agg, bySource };
}

/** When the winners post — on the user's own clock. */
export function computeHourHistogram(posts: Post[], tz: string) {
  const counts = new Array(24).fill(0);
  const rows = posts.filter(p => p.created && p.score > 3);
  const thPer: Record<string, number> = {};
  for (const src of new Set(posts.map(p => p.source))) {
    const scores = rows.filter(p => p.source === src).map(p => p.score).sort((a, b) => a - b);
    thPer[src] = scores[Math.floor(scores.length * 0.8)] || 1;
  }
  const win = rows.filter(p => p.score >= thPer[p.source]);
  for (const p of win) counts[hourInTz(p.created, tz)]++;
  return { counts, total: win.length };
}

/**
 * Rebuild the whole read model: the derived post columns, the baselines and
 * the snapshot. This is the expensive part — it runs in a task, never on a
 * request path.
 */
export function rebuild(): { version: number; posts: number; computedAt: number } {
  const store = getStore();
  const tz = readTimezone();
  const now = Date.now();
  const rows = store.analyticsPostRows() as unknown as Row[];
  const posts = rows.map(rowToPost);

  const base = computeBaselines(posts);

  // ---- the derived facts + the outliers ----
  const analyzedAt = now;
  const derived = new Map<string, ReturnType<typeof derive> & { outlier: number; baseline: string }>();
  store.tx(() => {
    for (const p of posts) {
      const d = derive(p);
      const { outlier, baseline } = outlierOf({ ...p, eng: d.eng }, base);
      const rounded = Math.round(outlier * 100) / 100;
      derived.set(p.id, { ...d, outlier: rounded, baseline });
      store.setPostDerived(p.id, {
        eng: d.eng, hook: d.hook, hookLine: d.hookLine, words: d.words, lengthBucket: d.lengthBucket,
        hasLink: d.hasLink ? 1 : 0, emojiCount: d.emojiCount,
        outlier: rounded, baseline, analyzedAt,
      });
    }

    // ---- the yardsticks ----
    store.replaceAuthorBaselines([...base.authorMed].map(([key, med]) => {
      const [source, ...rest] = key.split('|');
      return { source, author: rest.join('|'), n: base.authorN.get(key) ?? 0, medianEng: med, updated: analyzedAt };
    }));
    store.replacePlatformBaselines([...base.platMed].map(([source, med]) => ({
      source, n: base.platN.get(source) ?? 0, medianEng: med,
      medianPerFollower: base.pfMed.get(source) ?? 0, updated: analyzedAt,
    })));
  });

  // ---- the aggregates (built from the same numbers we just wrote) ----
  const spikes = computeTopicSpikes(posts, now);
  const hooks = computeHookStats(posts);
  const hours = computeHourHistogram(posts, tz);
  const full = posts.map(p => {
    const d = derived.get(p.id)!;
    return {
      ...p,
      eng: d.eng,
      er: p.views ? d.eng / p.views : p.authorFollowers ? d.eng / p.authorFollowers : null,
      outlier: d.outlier,
      baseline: d.baseline as 'author' | 'audience' | 'platform',
      hook: d.hook,
      hookLine: d.hookLine,
      words: d.words,
      lengthBucket: d.lengthBucket,
      hasLink: d.hasLink,
      emojiCount: d.emojiCount,
      hour: hourInTz(p.created, tz),
      weekday: weekdayInTz(p.created, tz),
      niche: !!(p.security || p.dev),
    };
  });

  const lib = patternLibrary(full);
  const wins = winners(full, { limit: 8 });
  const recycledRows = findRecycled(full);
  const geo = geoRegions(full.map(a => ({
    source: a.source, author: a.author, authorLocation: a.authorLocation,
    created: a.created, outlier: a.outlier, title: a.title, link: a.link,
  })));

  const payload: SnapshotPayload = {
    total: store.count(),
    last24h: store.volumeWindow(now - 864e5),
    windowDays: 30,
    bySource: store.sourceStats(now - 30 * 864e5),
    securityShare: Math.round((store.securityCount(now - 30 * 864e5) / Math.max(1, store.count())) * 100),
    risingTopics: spikes.filter(t => t.fresh || t.prev).slice(0, 8).map(t => ({ name: t.name, fresh: t.fresh, prev: t.prev, pct: t.pct })),
    topicSpikes: spikes,
    topPosts: store.topEngaged(now - 7 * 864e5, 8).map(t => ({ title: t.title, source: t.source, link: t.link, score: t.score })),
    hours,
    hooks,
    patternRows: lib,
    winnerCards: wins.map((a, i) => winnerCard(a, i, 320)).join('\n\n'),
    patterns: patternTable(lib, undefined, 10),
    recycled: recycledText(recycledRows, 4),
    recycledRows,
    geo,
    analyzedAt,
  };

  const version = dataVersion();
  store.writeAnalyticsSnapshot({ version, computedAt: analyzedAt, tz, payload: JSON.stringify(payload) });
  return { version, posts: posts.length, computedAt: analyzedAt };
}
