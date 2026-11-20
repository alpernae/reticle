import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db: typeof import('../db');
let overview: typeof import('../application/overview');
let posts: typeof import('../application/posts');
let bestTime: typeof import('../application/best-time');
let categories: typeof import('../categories');
let appState: typeof import('../app-state');
let engine: typeof import('../engine');

const NOW = Date.now();
const DAY = 864e5;

/** A small corpus with two platforms, two creators and a spread of days.
 *  The posts carry a finished classification (topics + the security flag) —
 *  the engine's one-off reclassifier is switched off below so the corpus
 *  stays exactly as seeded. */
function seed() {
  const store = db.getStore();
  const rows = [
    { id: 'x1', source: 'x', author: 'alice', score: 10, comments: 1, body: 'How I found a bug in OAuth tokens', days: 0, topics: ['AI & LLMs'], security: 0 },
    { id: 'x2', source: 'x', author: 'alice', score: 20, comments: 2, body: 'The API rate limit nobody documents', days: 0, topics: ['Auth & Identity', 'Python'], security: 1 },
    { id: 'x3', source: 'x', author: 'alice', score: 30, comments: 0, body: 'Shipping my SaaS dashboard today 🚀', days: 1, topics: ['SaaS & Startups'], security: 0 },
    { id: 'x4', source: 'x', author: 'bob', score: 12, comments: 0, body: 'Quiet launch note', days: 3, topics: [], security: 0 },
    { id: 'x5', source: 'x', author: 'bob', score: 14, comments: 1, body: 'Another quiet launch note', days: 40, topics: ['AI & LLMs'], security: 0 },
    { id: 'l1', source: 'linkedin', author: 'carol', score: 50, comments: 5, body: 'A long post about building in public and selling a SaaS', days: 2, topics: ['Career & Growth'], security: 0 },
    { id: 'l2', source: 'linkedin', author: 'carol', score: 5, comments: 0, body: 'Security patch for my app', days: 5, topics: ['Cybersecurity'], security: 1 },
  ];
  for (const r of rows) {
    store.upsertPost({
      id: r.id, source: r.source, title: r.body.slice(0, 60), text: r.body, url: '', link: `https://x.com/${r.id}`,
      score: r.score, comments: r.comments, created: NOW - r.days * DAY - 3600_000, T: '', topics: JSON.stringify(r.topics),
      security: r.security, dev: 0, views: null, author: r.author, authorFollowers: 500, authorLocation: null,
      shares: null, saves: null, media: 'text', hashtags: '[]', body: r.body, durationSec: null,
    });
  }
}

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-reads-'));
  db = await import('../db');
  overview = await import('../application/overview');
  posts = await import('../application/posts');
  bestTime = await import('../application/best-time');
  categories = await import('../categories');
  appState = await import('../app-state');
  engine = await import('../engine');
  // the corpus is already classified — the one-off reclassifier must not
  // rewrite the seeded topics and security flags
  appState.writeStateRaw('classifierVersion', engine.CLASSIFIER_VERSION);
  seed();
});

describe('the Overview read model', () => {
  it('buckets the posts into days the way the page expects', () => {
    const d = overview.buildOverview();
    expect(d.days).toHaveLength(180);
    // the newest bucket is today, the oldest is 179 days back
    expect(d.days[179].label).toBe(new Date(NOW).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));

    // x1 and x2 were posted today → they share the newest bucket
    const today = d.days[179];
    expect(today.posts).toBe(2);
    expect(today.score).toBe(30);
    expect(today.comments).toBe(3);
    expect(today.eng).toBe(36);
    // the peak post of the day is the one with the most engagement
    expect(today.peak?.title).toBe('The API rate limit nobody documents');
  });

  it('counts what the page shows and keeps the table to the last 30 days', () => {
    const d = overview.buildOverview();
    expect(d.counts.total).toBe(7);
    expect(d.counts.bySource).toEqual({ x: 5, linkedin: 2 });
    expect(d.counts.security).toBe(2);
    expect(d.sources.sort()).toEqual(['linkedin', 'x']);
    // x5 is 40 days old → outside the 30-day table
    expect(d.table.every(r => r.posts > 0)).toBe(true);
    expect(d.table.length).toBe(5);
    expect(d.table[0].i).toBeGreaterThan(d.table[1].i); // newest first
  });

  it('filters by platform and by category', () => {
    const x = overview.buildOverview({ platform: 'x' });
    expect(x.counts.total).toBe(5);
    expect(x.counts.platformTotal).toBe(5);
    expect(x.days[179].posts).toBe(2);

    const sec = overview.buildOverview({ category: 'security' });
    expect(sec.counts.total).toBe(2);
    expect(sec.categoryCounts.security).toBe(2);

    const ai = overview.buildOverview({ category: 'ai-tools' });
    expect(ai.counts.total).toBe(2); // x1 + x5
  });

  it('searches the day rows', () => {
    const hit = overview.buildOverview({ q: 'oauth' });
    expect(hit.table.length).toBe(1);
    // the row keeps the whole day it matched (as the old client-side table did)
    expect(hit.table[0].posts).toBe(2);
    const miss = overview.buildOverview({ q: 'nothing-matches-this' });
    expect(miss.table.length).toBe(0);
  });
});

describe('the Feed read model', () => {
  it('serves a page and the stats for the whole filtered set', () => {
    const p = posts.listPosts();
    expect(p.posts.length).toBe(7);
    expect(p.total).toBe(7);
    expect(p.grandTotal).toBe(7);
    expect(p.bySource).toEqual({ x: 5, linkedin: 2 });
    expect(p.stats.security).toBe(2);
    expect(p.stats.newest).toBeGreaterThan(0);
    expect(p.next).toBeNull();
    // every post carries its own breakout score now
    expect(p.posts.every(x => typeof x.outlier === 'number')).toBe(true);
  });

  it('paginates with a cursor without dropping or repeating a row', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const p = posts.listPosts({ limit: 2, cursor });
      seen.push(...p.posts.map(x => x.id));
      cursor = p.next;
      if (!cursor) break;
    }
    expect(seen.length).toBe(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('sorts by every order it offers', () => {
    const byNew = posts.listPosts({ sort: 'new' }).posts.map(p => p.created);
    expect([...byNew].sort((a, b) => b - a)).toEqual(byNew);

    const byEng = posts.listPosts({ sort: 'eng' }).posts.map(p => p.score + 2 * p.comments);
    expect([...byEng].sort((a, b) => b - a)).toEqual(byEng);

    const byOutlier = posts.listPosts({ sort: 'outlier' }).posts.map(p => p.outlier);
    expect([...byOutlier].sort((a, b) => b - a)).toEqual(byOutlier);
  });

  it('filters by platform, topic, security and search', () => {
    expect(posts.listPosts({ platform: 'linkedin' }).total).toBe(2);
    expect(posts.listPosts({ topic: 'Cybersecurity' }).total).toBe(1);
    expect(posts.listPosts({ security: true }).total).toBe(2);
    expect(posts.listPosts({ q: 'oauth' }).total).toBe(1);
    expect(posts.listPosts({ q: 'CAROL' }).total).toBe(2); // the author search is case-insensitive
    expect(posts.listPosts({ q: '%' }).total).toBe(0); // a wildcard is not a wildcard
  });

  it('takes the median of the filtered set', () => {
    const p = posts.listPosts();
    const scores = p.posts.map(x => x.score).sort((a, b) => a - b);
    expect(p.stats.medianLikes).toBe(scores[scores.length >> 1]);
  });
});

describe('the best-time read model', () => {
  it('serves one small point per post', () => {
    const all = bestTime.bestTimePoints();
    expect(all.points.length).toBe(7);
    expect(all.points[0]).toHaveProperty('s');
    expect(all.points[0]).toHaveProperty('t');
    expect(all.points[0]).toHaveProperty('o');
    const x = bestTime.bestTimePoints('x');
    expect(x.points.length).toBe(5);
    expect(x.points.every(p => p.s === 'x')).toBe(true);
  });
});

describe('the category helpers', () => {
  it('maps classifier topics onto the audience categories', () => {
    expect(categories.inCategory({ topics: ['AI & LLMs'] }, 'ai-tools')).toBe(true);
    expect(categories.inCategory({ topics: ['Cybersecurity'] }, 'security')).toBe(true);
    expect(categories.inCategory({ topics: [] }, 'none')).toBe(true);
  });
});
