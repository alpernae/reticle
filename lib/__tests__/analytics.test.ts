import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db: typeof import('../db');
let analytics: typeof import('../application/analytics');
let dataVersion: typeof import('../data-version');
let patterns: typeof import('../domain/patterns');
let timezoneStore: typeof import('../timezone-store');

const NOW = Date.now();

/** A small corpus: one prolific creator, one one-off, one without an author. */
function seed() {
  const store = db.getStore();
  const rows = [
    // Alice: 4 posts → she gets a creator baseline
    { id: 'a1', author: 'alice', score: 10, comments: 1, body: 'How I found a bug in OAuth tokens', created: NOW - 36e5 },
    { id: 'a2', author: 'alice', score: 20, comments: 2, body: 'The API rate limit nobody documents', created: NOW - 72e5 },
    { id: 'a3', author: 'alice', score: 30, comments: 0, body: 'Shipping my SaaS dashboard today 🚀', created: NOW - 108e5 },
    { id: 'a4', author: 'alice', score: 40, comments: 5, body: 'A post that broke out — 900 likes for a small account', created: NOW - 144e5 },
    // Bob: 2 posts → no creator baseline, falls back to the platform median
    { id: 'b1', author: 'bob', score: 12, comments: 0, body: 'Quiet launch note', created: NOW - 180e5 },
    { id: 'b2', author: 'bob', score: 14, comments: 1, body: 'Another quiet launch note', created: NOW - 216e5 },
    // No author at all
    { id: 'c1', author: null, score: 8, comments: 0, body: 'Anonymous tip about a vulnerability', created: NOW - 252e5 },
  ];
  for (const r of rows) {
    store.upsertPost({
      id: r.id, source: 'x', title: r.body.slice(0, 60), text: r.body, url: '', link: `https://x.com/${r.id}`,
      score: r.score, comments: r.comments, created: r.created, T: '', topics: '["AI & LLMs"]', security: 0, dev: 0,
      views: null, author: r.author, authorFollowers: r.author ? 500 : null, authorLocation: null,
      shares: null, saves: null, media: 'text', hashtags: '[]', body: r.body, durationSec: null,
    });
  }
}

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-analytics-'));
  db = await import('../db');
  analytics = await import('../application/analytics');
  dataVersion = await import('../data-version');
  patterns = await import('../domain/patterns');
  timezoneStore = await import('../timezone-store');
  seed();
});

describe('the analytics read model', () => {
  it('writes the derived facts into the posts table', () => {
    analytics.rebuild();
    const store = db.getStore();
    const row = store.db.prepare('SELECT * FROM posts WHERE id = ?').get('a1') as any;
    expect(row.eng).toBe(12);           // 10 likes + 2×1 comment
    expect(row.hook).toBe('how-to');    // "How I found…"
    expect(row.words).toBe(8);
    expect(row.lengthBucket).toBe('short');
    expect(row.hasLink).toBe(0);
    expect(row.emojiCount).toBe(0);
    expect(row.analyzedAt).toBeGreaterThan(0);
  });

  it('computes the same outliers as the live analyzer', () => {
    analytics.rebuild();
    const store = db.getStore();
    const posts = (store.analyticsPostRows() as any[]).map(analytics.rowToPost);
    const live = patterns.analyze(posts, 'Europe/Istanbul');
    for (const a of live) {
      const row = store.db.prepare('SELECT outlier, baseline FROM posts WHERE id = ?').get(a.id) as any;
      expect(row.outlier, `outlier of ${a.id}`).toBe(a.outlier);
      expect(row.baseline, `baseline of ${a.id}`).toBe(a.baseline);
    }
  });

  it('stores the creator and platform yardsticks', () => {
    analytics.rebuild();
    const store = db.getStore();
    const author = store.db.prepare('SELECT * FROM author_baselines WHERE source = ? AND author = ?').get('x', 'alice') as any;
    expect(author.n).toBe(4);
    // Alice's median engagement: 12, 24, 30, 50 → 27
    expect(author.median_eng).toBe(27);
    const plat = store.db.prepare('SELECT * FROM platform_baselines WHERE source = ?').get('x') as any;
    expect(plat.n).toBe(7);
  });

  it('publishes a snapshot for the current data version', () => {
    analytics.rebuild();
    const snap = analytics.currentSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.version).toBe(dataVersion.dataVersion());
    expect(snap!.payload.total).toBe(7);
    expect(snap!.payload.hours.counts).toHaveLength(24);
    // 7 posts is not enough for a pattern library — it says so instead of guessing
    expect(Array.isArray(snap!.payload.patternRows)).toBe(true);
    expect(snap!.payload.patterns).toContain('not enough posts yet');
  });

  it('treats the snapshot as stale once the data changes', () => {
    analytics.rebuild();
    expect(analytics.currentSnapshot()).not.toBeNull();
    dataVersion.bumpDataVersion();
    expect(analytics.currentSnapshot()).toBeNull();
    // a rebuild makes it current again
    analytics.rebuild();
    expect(analytics.currentSnapshot()).not.toBeNull();
  });

  it('queues one debounced rebuild, not one per write', () => {
    const before = db.getStore().listTaskRows({ kind: 'analytics', limit: 50 }).length;
    analytics.scheduleRebuild();
    analytics.scheduleRebuild();
    analytics.scheduleRebuild();
    const after = db.getStore().listTaskRows({ kind: 'analytics', limit: 50 });
    expect(after.length).toBe(before + 1);
  });

  it('materializes the same pattern library the live analyzer builds', () => {
    // enough posts for the library to say something — and spread over weekdays
    // and weekends, so the "day" trait has both groups
    const store = db.getStore();
    const noon = (day: number) => Date.UTC(2026, 10, day, 12); // Mon Nov 9 … Sun Nov 15
    const spread = [9, 10, 11, 12, 13, 14, 14, 15, 15, 9, 10, 11];
    for (let i = 0; i < spread.length; i++) {
      const body = `A post from ${spread[i]} November — number ${i}`;
      store.upsertPost({
        id: `d${i}`, source: 'x', title: body.slice(0, 60), text: body, url: '', link: `https://example.test/d${i}`,
        score: 8 + i, comments: i % 3, created: noon(spread[i]) + i * 60_000, T: '', topics: '["AI & LLMs"]',
        security: 0, dev: 0, views: null, author: 'dana', authorFollowers: 500, authorLocation: null,
        shares: null, saves: null, media: 'text', hashtags: '[]', body, durationSec: null,
      });
    }
    analytics.rebuild();

    const tz = timezoneStore.readTimezone();
    const posts = (store.analyticsPostRows() as any[]).map(analytics.rowToPost);
    const live = patterns.patternLibrary(patterns.analyze(posts, tz));
    const snap = analytics.currentSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.payload.patternRows).toEqual(live);
    // the day dimension is one of them — it must not collapse to a single value
    expect(live.some(r => r.trait === 'day')).toBe(true);
  });
});
