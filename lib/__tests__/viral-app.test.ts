import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db: typeof import('../db');
let viral: typeof import('../application/viral');
let store: ReturnType<typeof db.getStore>;

const NOW = Date.UTC(2026, 5, 1);
const DAY = 86_400_000;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-viral-'));
  db = await import('../db');
  viral = await import('../application/viral');
  store = db.getStore();
});

/** A post with the derived columns the read model would have written. */
function seed(p: {
  id: string; source?: string; author?: string; eng: number; outlier: number;
  baseline?: 'author' | 'audience' | 'platform'; created: number; hook?: string;
  words?: number; lengthBucket?: string; comments?: number; score?: number;
}) {
  store.upsertPost({
    id: p.id,
    source: p.source || 'x',
    title: `Post ${p.id}`,
    text: 'I built the thing. Here is what broke.',
    url: '',
    link: `https://x.com/${p.id}`,
    score: p.score ?? 10,
    comments: p.comments ?? 1,
    created: p.created,
    T: '',
    topics: '[]',
    security: 0,
    dev: 0,
    author: p.author || null,
    body: 'I built the thing. Here is what broke.',
    hashtags: '[]',
  });
  store.setPostDerived(p.id, {
    eng: p.eng,
    hook: p.hook || 'statement',
    hookLine: 'I built the thing.',
    words: p.words ?? 8,
    lengthBucket: p.lengthBucket || 'short',
    hasLink: 0,
    emojiCount: 0,
    outlier: p.outlier,
    baseline: p.baseline || 'author',
    analyzedAt: NOW,
  });
}

describe('the viral finder (application)', () => {
  it('ranks the biggest lift first and explains why', () => {
    seed({ id: 'x:small', author: 'a', eng: 100, outlier: 1.2, created: NOW - 2 * DAY });
    seed({ id: 'x:big', author: 'b', eng: 900, outlier: 6, created: NOW - 2 * DAY });
    seed({ id: 'x:fresh', author: 'c', eng: 400, outlier: 4, created: NOW - 1 * DAY });

    const page = viral.listViral({ now: NOW, minLift: 1, limit: 10 });
    const ids = page.posts.map(p => p.id);
    expect(ids[0]).toBe('x:big');            // 6× beats 4×
    expect(ids).toContain('x:fresh');
    expect(page.posts[0].reasons.join(' ')).toContain('your own usual engagement');
    expect(page.posts[0].verdict).toBe('viral');
    expect(page.posts[0].recipe.length).toBeGreaterThan(2);
  });

  it('filters by platform and by minimum lift', () => {
    seed({ id: 'threads:a', source: 'threads', author: 'd', eng: 500, outlier: 5, created: NOW - DAY });
    const all = viral.listViral({ now: NOW, minLift: 1, limit: 20 });
    expect(all.posts.map(p => p.id)).toContain('threads:a');

    const onlyX = viral.listViral({ now: NOW, minLift: 1, platform: 'x', limit: 20 });
    expect(onlyX.posts.map(p => p.id)).not.toContain('threads:a');

    const strict = viral.listViral({ now: NOW, minLift: 4.5, limit: 20 });
    expect(strict.posts.map(p => p.id)).not.toContain('x:small');
    expect(strict.posts.map(p => p.id)).toContain('x:big');
  });

  it('pages with a cursor and never repeats a row', () => {
    const first = viral.listViral({ now: NOW, minLift: 1, limit: 1 });
    expect(first.posts).toHaveLength(1);
    expect(first.next).toBeTruthy();
    const second = viral.listViral({ now: NOW, minLift: 1, limit: 1, cursor: first.next });
    expect(second.posts[0].id).not.toBe(first.posts[0].id);
  });

  it('leaves out posts older than the window', () => {
    seed({ id: 'x:old', author: 'e', eng: 800, outlier: 8, created: NOW - 90 * DAY });
    const fresh = viral.listViral({ now: NOW, minLift: 1, days: 30, limit: 20 });
    expect(fresh.posts.map(p => p.id)).not.toContain('x:old');
  });

  it('builds a brief from the structure, not the words', () => {
    const brief = viral.viralBrief('x:big', { now: NOW });
    expect(brief).toBeTruthy();
    expect(brief!.brief).toContain('Imitate its STRUCTURE, not its words');
    expect(brief!.brief).toContain('The recipe:');
    expect(brief!.brief).not.toContain('I built the thing');
    expect(brief!.card.recipe.join(' ')).toContain('Open with a claim');
  });

  it('has no brief for a post that is not there', () => {
    expect(viral.viralBrief('x:missing', { now: NOW })).toBeNull();
  });
});

describe('the feed viral sort', () => {
  it('ranks by lift, damped by age', async () => {
    const feed = await import('../application/posts');
    // the feed ranks against the real clock, so these two sit on it
    const REAL = Date.now();
    // a big hit from four months ago, and a smaller one from yesterday
    seed({ id: 'v:old', author: 'f', eng: 4000, outlier: 10, created: REAL - 120 * DAY });
    seed({ id: 'v:new', author: 'g', eng: 2000, outlier: 8, created: REAL - 1 * DAY });

    const p = feed.listPosts({ sort: 'viral', limit: 50 });
    const ids = p.posts.map(x => x.id);
    const at = (id: string) => ids.indexOf(id);
    expect(at('v:old')).toBeGreaterThanOrEqual(0);
    expect(at('v:new')).toBeGreaterThanOrEqual(0);
    // recency wins between two different lifts
    expect(at('v:new')).toBeLessThan(at('v:old'));
    // the score is the lift with the age folded in — never above the raw lift
    const old = p.posts.find(x => x.id === 'v:old')!;
    expect(old.viral).toBeLessThan(old.outlier);
    expect(old.viral).toBeGreaterThanOrEqual(old.outlier * 0.55);
    // the rows come back sorted by that score
    const scores = p.posts.map(x => x.viral);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('pages with a cursor without dropping or repeating a row', async () => {
    const feed = await import('../application/posts');
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 30; i++) {
      const p = feed.listPosts({ sort: 'viral', limit: 1, cursor });
      seen.push(...p.posts.map(x => x.id));
      cursor = p.next;
      if (!cursor) break;
    }
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.length).toBe(new Set(seen).size);
  });
});
