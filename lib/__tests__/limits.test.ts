import { describe, expect, it } from 'vitest';
import { platformLength, postLimit, xLength } from '../domain/limits';

describe('X weighted length', () => {
  it('counts latin text by grapheme', () => {
    expect(xLength('hello')).toBe(5);
    expect(xLength('héllo')).toBe(5);
  });

  it('counts every URL as 23 regardless of length', () => {
    expect(xLength('https://example.com/a/very/long/path')).toBe(23);
    expect(xLength('see https://example.com')).toBe(4 + 23);
  });

  it('counts emoji and CJK as 2', () => {
    expect(xLength('🚀')).toBe(2);
    expect(xLength('你好')).toBe(4);
  });
});

describe('platform limits', () => {
  it('uses code points outside X', () => {
    expect(platformLength('linkedin', 'hello')).toBe(5);
    expect(platformLength('linkedin', '🚀')).toBe(1);
  });

  it('returns the per-platform hard limit', () => {
    expect(postLimit('x')).toBe(280);
    expect(postLimit('linkedin')).toBe(3000);
    expect(postLimit('threads')).toBe(500);
    expect(postLimit('unknown')).toBeNull();
    expect(postLimit('youtube', 'yt-short')).toBeNull(); // scripts have no meaningful limit
  });
});
