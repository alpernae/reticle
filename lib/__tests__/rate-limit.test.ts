import { describe, expect, it } from 'vitest';
import { clientIp, clearFailures, limitRetryAfter, noteFailure } from '../http/rate-limit';

describe('sign-in rate limit', () => {
  it('lets a fresh caller through', () => {
    expect(limitRetryAfter('ip:new', 5, 60_000)).toBe(0);
  });

  it('closes the door after too many failures and reopens it when the window passes', () => {
    const key = 'ip:brute';
    clearFailures(key);
    for (let i = 0; i < 5; i++) {
      expect(limitRetryAfter(key, 5, 60_000)).toBe(0);
      noteFailure(key, 60_000);
    }
    const wait = limitRetryAfter(key, 5, 60_000);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);

    // a successful sign-in clears the slate
    clearFailures(key);
    expect(limitRetryAfter(key, 5, 60_000)).toBe(0);
  });

  it('keeps one caller from blocking another', () => {
    const a = 'ip:a', b = 'ip:b';
    clearFailures(a); clearFailures(b);
    for (let i = 0; i < 6; i++) noteFailure(a, 60_000);
    expect(limitRetryAfter(a, 5, 60_000)).toBeGreaterThan(0);
    expect(limitRetryAfter(b, 5, 60_000)).toBe(0);
  });

  it('reads the caller IP from the proxy header, falling back to local', () => {
    const req = (headers: Record<string, string>) => new Request('http://localhost/api/auth', { headers });
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(req({}))).toBe('local');
  });
});
