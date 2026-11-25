import { describe, expect, it } from 'vitest';
import {
  BREAKOUT_LIFT,
  HALF_LIFE_DAYS,
  RECENCY_FLOOR,
  VIRAL_LIFT,
  baselineWord,
  ctaOf,
  describeStructure,
  formatOf,
  recencyWeight,
  structureSignature,
  verdictOf,
  viralHeadline,
  viralReasons,
  viralScore,
} from '../domain/viral';
import type { Analyzed } from '../domain/patterns';

const DAY = 86_400_000;

function analyzed(over: Partial<Analyzed> = {}): Analyzed {
  return {
    id: 'x:1',
    source: 'x',
    title: 'Build in public',
    text: 'I shipped the thing.',
    url: '',
    link: 'https://x.com/a/1',
    score: 100,
    comments: 10,
    created: Date.UTC(2026, 0, 6, 9, 0, 0), // Tue 09:00 UTC
    author: 'alice',
    authorFollowers: 1000,
    shares: 5,
    saves: 2,
    media: 'image',
    hashtags: ['buildinpublic'],
    body: 'I shipped the thing.\n\nHere is what broke.',
    eng: 136,
    er: null,
    outlier: 4,
    baseline: 'author',
    hook: 'statement',
    hookLine: 'I shipped the thing.',
    words: 8,
    lengthBucket: 'short',
    hasLink: false,
    emojiCount: 0,
    hour: 9,
    weekday: 2,
    niche: false,
    topics: ['SaaS & Startups'],
    ...over,
  } as Analyzed;
}

describe('viral ranking (domain)', () => {
  it('weights recency by half-life but never to zero', () => {
    const now = Date.UTC(2026, 2, 1);
    const fresh = recencyWeight(now, now);
    expect(fresh).toBeCloseTo(1, 5);
    const half = recencyWeight(now - HALF_LIFE_DAYS * DAY, now);
    expect(half).toBeCloseTo(RECENCY_FLOOR + (1 - RECENCY_FLOOR) * 0.5, 5);
    const ancient = recencyWeight(now - 365 * DAY, now);
    expect(ancient).toBeGreaterThanOrEqual(RECENCY_FLOOR);
    expect(ancient).toBeLessThan(half);
  });

  it('scores a fresh hit above an older, bigger hit', () => {
    const now = Date.UTC(2026, 2, 1);
    const fresh = viralScore({ outlier: 3, created: now }, now);
    const older = viralScore({ outlier: 4, created: now - 90 * DAY }, now);
    expect(fresh).toBeCloseTo(3, 2);
    expect(older).toBeLessThan(fresh);
    expect(older).toBeGreaterThan(3 * RECENCY_FLOOR); // an old hit still counts
  });

  it('bands a lift into a verdict', () => {
    expect(verdictOf(VIRAL_LIFT)).toBe('viral');
    expect(verdictOf(BREAKOUT_LIFT)).toBe('breakout');
    expect(verdictOf(1.4)).toBe('normal');
    expect(verdictOf(0.5)).toBe('under');
    expect(viralHeadline(analyzed({ outlier: 3.2 }), Date.now())).toBe('3.2× viral');
  });

  it('names the yardstick a post was measured against', () => {
    expect(baselineWord('author')).toBe('own');
    expect(baselineWord('audience')).toBe("audience's");
    expect(baselineWord('platform')).toBe('platform');
  });
});

describe('the structural recipe', () => {
  it('reads the format from media, duration and shape', () => {
    expect(formatOf({ durationSec: 42, media: null })).toBe('video');
    expect(formatOf({ media: 'image' })).toBe('image');
    expect(formatOf({ media: null, body: '1. one\n2. two\n3. three\n4. four' })).toBe('thread');
    expect(formatOf({ hasLink: true, body: 'look at this https://x.com' })).toBe('link');
    expect(formatOf({ body: 'just a sentence' })).toBe('text');
  });

  it('finds the ask at the end of a post', () => {
    expect(ctaOf('Great post. What do you think?')).toBe('question');
    expect(ctaOf('Read it all — follow me for more.')).toBe('follow');
    expect(ctaOf('Thoughts?')).toBe('comment');
    expect(ctaOf('Repost this if you agree')).toBe('share');
    expect(ctaOf('Details here https://example.com')).toBe('link');
    expect(ctaOf('Just shipping.')).toBe('none');
  });

  it('describes a post without its content', () => {
    const sig = structureSignature(analyzed(), { tz: 'UTC' });
    expect(sig.opening).toBe('claim');
    expect(sig.hookLabel).toBe('Bold statement');
    expect(sig.lengthBucket).toBe('short');
    expect(sig.format).toBe('image');
    expect(sig.hashtagCount).toBe(1);
    expect(sig.cta).toBe('none');
    expect(sig.slot).toBe('Tue 09:00');

    const lines = describeStructure(sig);
    expect(lines.join(' | ')).toContain('Open with a claim');
    expect(lines.join(' | ')).toContain('about 8 words');
    expect(lines.join(' | ')).toContain('Posted Tue 09:00');
    expect(lines.join(' | ')).not.toContain('shipped the thing'); // never the content
  });

  it('puts the post in the reader’s own timezone', () => {
    const sig = structureSignature(analyzed(), { tz: 'Europe/Istanbul' });
    expect(sig.hour).toBe(12); // 09:00 UTC + 3
    expect(sig.slot).toBe('Tue 12:00');
  });
});

describe('why a post ranked', () => {
  const now = Date.UTC(2026, 2, 1);

  it('always explains the lift and the hook', () => {
    const reasons = viralReasons(analyzed(), { now, tz: 'UTC' });
    expect(reasons[0]).toBe('4× your own usual engagement');
    expect(reasons.join(' | ')).toContain('Bold statement hook');
    expect(reasons.join(' | ')).toContain('posted 7 weeks ago');
  });

  it('adds the corpus lifts when they are known', () => {
    const reasons = viralReasons(analyzed(), {
      now,
      tz: 'UTC',
      traitLift: (trait, value) => (trait === 'length' && value === 'short' ? 1.4 : undefined),
      slotLift: (hour) => (hour === 9 ? 1.8 : undefined),
    });
    const joined = reasons.join(' | ');
    expect(joined).toContain('short length wins 1.4× here');
    expect(joined).toContain('a slot that wins 1.8× for you');
  });

  it('mentions the engagement mix when there is one', () => {
    const reasons = viralReasons(analyzed({ comments: 12, shares: 30, saves: 0 }), { now, tz: 'UTC' });
    expect(reasons.join(' | ')).toContain('12 comments');
    expect(reasons.join(' | ')).toContain('30 shares');
  });
});
