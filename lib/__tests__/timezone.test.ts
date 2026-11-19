import { describe, expect, it } from 'vitest';
import {
  addDays, hourInTz, isValidTimezone, parseLocalDateTime, systemTimezone,
  tzOffsetMs, weekdayInTz, zonedParts, zonedTimeToUtc,
} from '../timezone';

describe('timezone math', () => {
  it('reads wall-clock parts in the requested zone', () => {
    const ts = Date.UTC(2026, 0, 15, 0, 0, 0);
    expect(zonedParts(ts, 'UTC')).toMatchObject({ year: 2026, month: 1, day: 15, hour: 0, minute: 0 });
    expect(zonedParts(ts, 'Europe/Istanbul')).toMatchObject({ year: 2026, month: 1, day: 15, hour: 3 });
    expect(zonedParts(ts, 'America/New_York')).toMatchObject({ year: 2026, month: 1, day: 14, hour: 19 });
  });

  it('bucket helpers agree with zonedParts', () => {
    const ts = Date.UTC(2026, 0, 15, 21, 0, 0);
    expect(hourInTz(ts, 'Europe/Istanbul')).toBe(0);
    expect(weekdayInTz(ts, 'Europe/Istanbul')).toBe(5); // Friday
    expect(hourInTz(ts, 'America/New_York')).toBe(16);
    expect(weekdayInTz(ts, 'America/New_York')).toBe(4); // Thursday
  });

  it('round-trips a wall clock through UTC', () => {
    for (const [tz, y, mo, d, h, mi] of [
      ['Europe/Istanbul', 2026, 1, 15, 9, 30],
      ['America/New_York', 2026, 1, 15, 9, 30],
      ['Asia/Tokyo', 2026, 7, 1, 0, 0],
    ] as const) {
      const ts = zonedTimeToUtc(y, mo, d, h, mi, tz);
      expect(zonedParts(ts, tz)).toMatchObject({ year: y, month: mo, day: d, hour: h, minute: mi });
    }
  });

  it('handles DST boundaries', () => {
    // US DST starts 2026-03-08; 09:00 is EDT (UTC-4), not EST (UTC-5).
    expect(zonedTimeToUtc(2026, 3, 8, 9, 0, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 13, 0));
    // London is still GMT on 2026-03-01 and BST on 2026-04-01.
    expect(zonedTimeToUtc(2026, 3, 1, 9, 0, 'Europe/London')).toBe(Date.UTC(2026, 2, 1, 9, 0));
    expect(zonedTimeToUtc(2026, 4, 1, 9, 0, 'Europe/London')).toBe(Date.UTC(2026, 3, 1, 8, 0));
  });

  it('reports the offset at an instant', () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 15), 'Europe/Istanbul')).toBe(3 * 36e5);
    expect(tzOffsetMs(Date.UTC(2026, 0, 15), 'UTC')).toBe(0);
  });

  it('does calendar-day arithmetic across month ends', () => {
    expect(addDays(2026, 1, 31, 1)).toEqual({ year: 2026, month: 2, day: 1 });
    expect(addDays(2026, 12, 31, 1)).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it('validates zones and parses UI datetimes', () => {
    expect(isValidTimezone('Europe/Istanbul')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(parseLocalDateTime('2026-11-19T09:05')).toMatchObject({ year: 2026, month: 11, day: 19, hour: 9, minute: 5 });
    expect(parseLocalDateTime('not a date')).toBeNull();
    expect(parseLocalDateTime('2026-13-01T09:00')).toBeNull();
    expect(typeof systemTimezone()).toBe('string');
  });
});
