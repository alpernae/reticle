import { describe, expect, it } from 'vitest';
import { describeSchedule, nextRunOf, untilText } from '../domain/schedule';

const IST = 'Europe/Istanbul';
const UTC = 'UTC';

describe('nextRunOf', () => {
  it('schedules daily wall-clock time in the user zone, not the server zone', () => {
    // 08:00 in Istanbul = 05:00 UTC; the next 09:00 is 06:00 UTC the same day.
    const from = Date.UTC(2026, 0, 15, 5, 0);
    expect(nextRunOf({ type: 'daily', time: '09:00' }, from, IST)).toBe(Date.UTC(2026, 0, 15, 6, 0));
    // 10:00 in Istanbul already passed 09:00 → tomorrow 06:00 UTC.
    expect(nextRunOf({ type: 'daily', time: '09:00' }, Date.UTC(2026, 0, 15, 7, 0), IST)).toBe(Date.UTC(2026, 0, 16, 6, 0));
    // The same wall clock in UTC is a different instant.
    expect(nextRunOf({ type: 'daily', time: '09:00' }, from, UTC)).toBe(Date.UTC(2026, 0, 15, 9, 0));
  });

  it('finds the next matching weekday', () => {
    // 2026-01-15 is a Thursday; next Monday is 2026-01-19, 08:00 Istanbul = 05:00 UTC.
    const from = Date.UTC(2026, 0, 15, 12, 0);
    expect(nextRunOf({ type: 'weekly', days: [1], time: '08:00' }, from, IST)).toBe(Date.UTC(2026, 0, 19, 5, 0));
    // No days selected → nothing to run.
    expect(nextRunOf({ type: 'weekly', days: [], time: '08:00' }, from, IST)).toBeNull();
  });

  it('resolves a one-off wall clock in the user zone', () => {
    const from = Date.UTC(2026, 0, 15, 0, 0);
    expect(nextRunOf({ type: 'once', at: '2026-01-20T09:30' }, from, IST)).toBe(Date.UTC(2026, 0, 20, 6, 30));
    expect(nextRunOf({ type: 'once', at: '2026-01-10T09:30' }, from, IST)).toBeNull(); // in the past
    expect(nextRunOf({ type: 'once', at: 'nope' }, from, IST)).toBeNull();
  });

  it('keeps interval and manual schedules as before', () => {
    const from = 1_000_000;
    expect(nextRunOf({ type: 'interval', everyHours: 6 }, from, IST)).toBe(from + 6 * 36e5);
    expect(nextRunOf({ type: 'manual' }, from, IST)).toBeNull();
  });
});

describe('schedule text', () => {
  it('describes a one-off without shifting the picked wall clock', () => {
    expect(describeSchedule({ type: 'once', at: '2026-11-19T09:05' })).toBe('Once on Thu, Nov 19 at 9:05 AM');
  });

  it('describes daily and weekly schedules', () => {
    expect(describeSchedule({ type: 'daily', time: '09:00' })).toBe('Every day at 9:00 AM');
    expect(describeSchedule({ type: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30' })).toBe('Every weekday at 7:30 AM');
    expect(describeSchedule({ type: 'weekly', days: [0, 6], time: '10:00' })).toBe('Every weekend day at 10:00 AM');
  });

  it('formats countdowns', () => {
    const now = Date.UTC(2026, 0, 15, 0, 0);
    expect(untilText(now + 90_000, now)).toBe('in 2m');
    expect(untilText(now + 3 * 36e5 + 20 * 6e4, now)).toBe('in 3h 20m');
    expect(untilText(now - 1, now)).toBe('due now');
    expect(untilText(null)).toBe('—');
  });
});
