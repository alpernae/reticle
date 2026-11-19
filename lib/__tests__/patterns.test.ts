import { describe, expect, it } from 'vitest';
import { analyze, engagement, hookType, patternLibrary } from '../patterns';
import type { Post } from '../engine';

const post = (over: Partial<Post> & { id: string }): Post => ({
  source: 'x', title: '', text: '', url: '', link: '', score: 0, comments: 0, created: Date.UTC(2026, 0, 15, 12, 0),
  ...over,
});

describe('engagement', () => {
  it('weights comments ×2, shares ×3 and saves ×2', () => {
    expect(engagement({ ...post({ id: 'p' }), score: 10, comments: 2, shares: 3, saves: 4 })).toBe(10 + 4 + 9 + 8);
    expect(engagement(post({ id: 'q', score: 7 }))).toBe(7);
  });
});

describe('hookType', () => {
  it('classifies the common openings', () => {
    expect(hookType('How to find IDORs in 10 minutes')).toBe('how-to');
    expect(hookType('5 tools I use every day')).toBe('listicle');
    expect(hookType('Why is nobody talking about this?')).toBe('question');
    expect(hookType('Unpopular opinion: most scans are noise')).toBe('contrarian');
    expect(hookType('I built a scanner in a weekend')).toBe('launch');
    expect(hookType('Just a normal sentence.')).toBe('statement');
  });
});

describe('analyze', () => {
  it('scores an author against their own median', () => {
    const rows = analyze([
      post({ id: 'a', author: 'alice', score: 10 }),
      post({ id: 'b', author: 'alice', score: 10 }),
      post({ id: 'c', author: 'alice', score: 100 }),
    ]);
    const c = rows.find(r => r.id === 'c')!;
    expect(c.baseline).toBe('author');
    expect(c.outlier).toBe(10);
    expect(rows.find(r => r.id === 'a')!.outlier).toBe(1);
  });

  it('falls back to the platform median for one-off authors', () => {
    const rows = analyze([post({ id: 'a', score: 10 }), post({ id: 'b', score: 20 }), post({ id: 'c', score: 30 })]);
    expect(rows[0].baseline).toBe('platform');
    expect(rows[1].outlier).toBe(1);
  });

  it('buckets hours and weekdays in the requested zone', () => {
    const p = post({ id: 'p', created: Date.UTC(2026, 0, 15, 21, 0) });
    const [ist] = analyze([p], 'Europe/Istanbul');
    const [ny] = analyze([p], 'America/New_York');
    expect(ist.hour).toBe(0);
    expect(ist.weekday).toBe(5);
    expect(ny.hour).toBe(16);
    expect(ny.weekday).toBe(4);
  });
});

describe('patternLibrary', () => {
  it('measures the lift of a trait against the platform median', () => {
    const rows: Post[] = [];
    for (let i = 0; i < 10; i++) rows.push(post({ id: 'tag' + i, author: 'a' + i, score: 100, body: 'winners #security', hashtags: ['#security'] }));
    for (let i = 0; i < 10; i++) rows.push(post({ id: 'plain' + i, author: 'b' + i, score: 10, body: 'ordinary post' }));
    const lib = patternLibrary(analyze(rows));
    const tag = lib.find(r => r.trait === 'hashtags' && r.value === '1–3 hashtags');
    const plain = lib.find(r => r.trait === 'hashtags' && r.value === 'no hashtags');
    expect(tag?.n).toBe(10);
    expect(tag!.lift).toBeGreaterThan(1.5);
    expect(plain!.lift).toBeLessThan(0.5);
  });

  it('ignores traits with fewer than 5 posts', () => {
    const rows: Post[] = [];
    for (let i = 0; i < 6; i++) rows.push(post({ id: 'x' + i, author: 'a' + i, score: 10 }));
    expect(patternLibrary(analyze(rows))).toHaveLength(0);
  });
});
