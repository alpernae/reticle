import { describe, expect, it } from 'vitest';
import { fitScorer } from '../score';
import { analyze } from '../patterns';
import type { Post } from '../engine';

const post = (over: Partial<Post> & { id: string }): Post => ({
  source: 'x', title: '', text: '', url: '', link: '', score: 0, comments: 0,
  created: Date.UTC(2026, 0, 15, 12, 0),
  ...over,
});

describe('fitScorer', () => {
  it('stays neutral when there is no evidence', () => {
    const fit = fitScorer([], 'x')('anything at all');
    expect(fit.score).toBe(1);
    expect(fit.factors).toHaveLength(0);
    expect(fit.evidence).toBe(0);
    expect(fit.basis).toContain('all platforms');
  });

  it('rewards a trait that over-performed in the collected data', () => {
    const rows: Post[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(post({ id: 'tag' + i, author: 'a' + i, score: 100, body: 'winners #security', hashtags: ['#security'] }));
    }
    for (let i = 0; i < 10; i++) {
      rows.push(post({ id: 'plain' + i, author: 'b' + i, score: 10, body: 'ordinary post' }));
    }
    const score = fitScorer(analyze(rows), 'x');

    const good = score('another #security post');
    const bad = score('another ordinary post');
    expect(good.score).toBeGreaterThan(1.1);
    expect(good.factors.find(f => f.trait === 'hashtags')).toMatchObject({ value: '1–3 hashtags', n: 10 });
    expect(bad.score).toBeLessThan(0.9);
    expect(bad.factors.find(f => f.trait === 'hashtags')?.value).toBe('no hashtags');
  });

  it('pools platforms while a single one is too thin', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => post({ id: 'x' + i, source: 'x', author: 'a' + i, score: 50 })),
      ...Array.from({ length: 10 }, (_, i) => post({ id: 'l' + i, source: 'linkedin', author: 'b' + i, score: 50 })),
    ];
    const fit = fitScorer(analyze(rows), 'x')('hello');
    expect(fit.basis).toContain('all platforms');
    expect(fit.basis).toContain('x has 10');
  });
});
