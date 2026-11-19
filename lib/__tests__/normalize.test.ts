import { describe, expect, it } from 'vitest';
import { flatten, normalize, twitterDate } from '../normalize';

describe('twitterDate', () => {
  it('parses the legacy Twitter format with its offset', () => {
    expect(twitterDate('Wed Oct 30 12:38:00 +0000 2026')).toBe(Date.UTC(2026, 9, 30, 12, 38, 0));
    expect(twitterDate('Thu Jul 02 08:15:30 -0400 2026')).toBe(Date.UTC(2026, 6, 2, 12, 15, 30));
  });

  it('falls back to Date.parse and returns 0 for junk', () => {
    expect(twitterDate('2026-10-30T12:38:00Z')).toBe(Date.UTC(2026, 9, 30, 12, 38, 0));
    expect(twitterDate('not a date')).toBe(0);
    expect(twitterDate('')).toBe(0);
  });
});

describe('normalize X rows', () => {
  const tweet = {
    id_str: '123',
    full_text: 'Hello #Security world #appsec',
    createdAt: 'Wed Oct 30 12:38:00 +0000 2026',
    author: { userName: 'alice', followers: '4.2K', location: 'Istanbul' },
    likeCount: 10,
    replyCount: 2,
    retweetCount: 3,
    quoteCount: 1,
    bookmarkCount: 4,
    viewCount: 1000,
    entities: { hashtags: [{ text: 'AppSec' }], urls: [{ expanded_url: 'https://example.com' }] },
    media: [{ type: 'photo' }],
  };

  it('maps a tweet into the normalized shape', () => {
    const p = normalize('x', tweet)!;
    expect(p).toMatchObject({
      id: 'apify-x:123',
      platform: 'x',
      url: 'https://x.com/alice/status/123',
      author: 'alice',
      authorFollowers: 4200,
      authorLocation: 'Istanbul',
      created: Date.UTC(2026, 9, 30, 12, 38, 0),
      body: 'Hello #Security world #appsec',
      likes: 10,
      comments: 2,
      shares: 4,
      saves: 4,
      views: 1000,
      media: 'image',
    });
    expect(p.hashtags).toEqual(expect.arrayContaining(['#security', '#appsec']));
  });

  it('drops retweets, replies and rows without an id', () => {
    expect(normalize('x', { ...tweet, isRetweet: true })).toBeNull();
    expect(normalize('x', { ...tweet, isReply: true })).toBeNull();
    expect(normalize('x', { ...tweet, full_text: 'RT @bob: something' })).toBeNull();
    expect(normalize('x', { full_text: 'no id here' })).toBeNull();
  });

  it('reads the format from media, poll and link entities', () => {
    const media = (extra: Record<string, unknown>) => normalize('x', { id_str: 'm', ...extra })!.media;
    expect(media({ media: [{ type: 'video' }] })).toBe('video');
    expect(media({ media: [{ type: 'photo' }, { type: 'photo' }] })).toBe('carousel');
    expect(media({ poll: { options: [] } })).toBe('poll');
    expect(media({ full_text: 'A thread 🧵 about SQLite' })).toBe('thread');
    expect(media({ full_text: 'Read this', entities: { urls: [{ expanded_url: 'https://x' }] } })).toBe('link');
    expect(media({ full_text: 'just words' })).toBe('text');
  });
});

describe('flatten', () => {
  it('unwraps apimaestro LinkedIn rows', () => {
    const items = [{ data: { posts: [{ id: 1 }, { id: 2 }] } }, { id: 3 }];
    expect(flatten('linkedin', items)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('leaves other platforms untouched', () => {
    const items = [{ id: 1 }];
    expect(flatten('x', items)).toBe(items);
  });
});
