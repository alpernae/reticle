// lib/besttime.ts — "when should I post?" (client-safe).
//
// Two sources, always labelled:
//   1. YOUR DATA — when the winning posts in your database went out, on the
//      clock of the audience region you pick. Uses the outlier score (post vs
//      the creator's normal), so busy hours don't win just because more people
//      post then: a window ranks high only if posts there beat their own baseline.
//   2. TYPICAL — widely reported platform habits (people's daily routines),
//      in the audience's local time. Used when your data is too thin.
// Every window is also converted to the other regions and to YOUR clock.

export type TimingPoint = { s: string; t: number; o: number }; // source, created (ms), outlier

export const REGIONS = [
  { key: 'us-east', label: 'US East', tz: 'America/New_York', note: 'NYC, Boston, Toronto, Miami' },
  { key: 'us-west', label: 'US West', tz: 'America/Los_Angeles', note: 'SF Bay Area, Seattle, LA' },
  { key: 'uk', label: 'UK', tz: 'Europe/London', note: 'London, Dublin' },
  { key: 'eu', label: 'Central Europe', tz: 'Europe/Berlin', note: 'Berlin, Paris, Amsterdam' },
  { key: 'tr', label: 'Türkiye', tz: 'Europe/Istanbul', note: 'Istanbul, Ankara' },
  { key: 'in', label: 'India', tz: 'Asia/Kolkata', note: 'Bengaluru, Delhi, Mumbai' },
] as const;
export type RegionKey = typeof REGIONS[number]['key'];

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Typical windows in the AUDIENCE'S local time (start hour inclusive, end exclusive). */
export const TYPICAL: Record<string, { days: number[]; windows: [number, number][]; why: string; avoid: string }> = {
  x: {
    days: [2, 3, 4], windows: [[8, 11], [12, 13]],
    why: 'Feeds are checked before and at the start of work. Dev and founder X is busiest on US mornings, which is also the European afternoon, so one post reaches both.',
    avoid: 'Late evening and Saturday: replies dry up, and X ranks early replies heavily.',
  },
  linkedin: {
    days: [2, 3, 4], windows: [[7, 9], [12, 13]],
    why: 'A work network: people scroll on the commute, before the first meeting and at lunch. Tue–Thu outperform Monday (inbox day) and Friday.',
    avoid: 'Weekends and after 6 PM: reach drops sharply.',
  },
  instagram: {
    days: [1, 2, 3, 4, 5], windows: [[11, 13], [19, 21]],
    why: 'Lunch break and evening downtime. Reels get a second push in the evening.',
    avoid: 'Early morning (before 8 AM) and late night.',
  },
  threads: {
    days: [1, 2, 3, 4], windows: [[7, 9], [12, 14], [19, 21]],
    why: 'Threads behaves like a calmer X: morning check-ins, lunch and the evening scroll on phones. Its feed leans on recent posts with early replies, so post when you can answer replies for the first hour.',
    avoid: 'Late night and Saturday mornings: little early conversation for the feed to pick up.',
  },
  tiktok: {
    days: [2, 3, 4, 5], windows: [[18, 22], [9, 10]],
    why: 'Evening scrolling after work or school is TikTok\'s peak. A secondary bump comes in the morning.',
    avoid: 'Mid-afternoon on weekdays.',
  },
  youtube: {
    days: [4, 5, 6], windows: [[14, 16]],
    why: 'Publish in the afternoon so the video is indexed and picking up early views before the 6–9 PM viewing peak. Thu–Sat lead into weekend watching.',
    avoid: 'Late night uploads miss the first-day push.',
  },
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(ts: number, tz: string): { day: number; hour: number } {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }); fmtCache.set(tz, f); }
  const p = f.formatToParts(ts);
  const wd = p.find(x => x.type === 'weekday')?.value || 'Sun';
  return { day: DAYS.indexOf(wd), hour: Number(p.find(x => x.type === 'hour')?.value || 0) % 24 };
}

/** UTC offset (hours) of a zone right now (handles DST). */
export function offsetHours(tz: string, at = Date.now()): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(at).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return Math.round((asUTC - at) / 36e5 * 2) / 2;
}

/** Shift an hour from one zone's clock to another's; returns hour (may be fractional) and day shift. */
export function shiftHour(h: number, fromTz: string, toTz: string): { h: number; dayShift: number } {
  const x = h + offsetHours(toTz) - offsetHours(fromTz);
  const dayShift = x < 0 ? -1 : x >= 24 ? 1 : 0;
  return { h: ((x % 24) + 24) % 24, dayShift };
}

export const fmtHour = (h: number) => {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `${hh % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${hh < 12 ? 'AM' : 'PM'}`;
};
/** "6–10 AM" / "11 AM–1 PM" */
export function fmtRange(a: number, b: number): string {
  const end = ((b % 24) + 24) % 24;
  const sameHalf = (a < 12) === (end < 12) && end !== 0;
  const tail = (h: number) => fmtHour(h).replace(/ (AM|PM)$/, '');
  return sameHalf ? `${tail(a)}–${fmtHour(end)}` : `${fmtHour(a)}–${fmtHour(end)}`;
}
/** A window expressed on another zone's clock, e.g. "2–4 PM" (+ "next day" if it crosses midnight). */
export function convertRange(a: number, b: number, fromTz: string, toTz: string): string {
  const s = shiftHour(a, fromTz, toTz), e = shiftHour(b, fromTz, toTz);
  const day = s.dayShift > 0 ? ' (next day)' : s.dayShift < 0 ? ' (day before)' : '';
  return fmtRange(s.h, e.h) + day;
}

const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export type Window = { start: number; end: number; n: number; lift: number; winRate: number };
export type DayStat = { day: number; n: number; lift: number; winRate: number };
export type BestTimes = {
  n: number;
  enough: boolean;              // data is strong enough to trust over the typical windows
  windows: Window[];            // best 3-hour windows (non-overlapping), best first
  worst: Window | null;
  days: DayStat[];              // Sun..Sat
  grid: { n: number; lift: number }[][]; // [day][block of 3h] → lift vs overall median
};

const WIN = 2;       // outlier ≥ 2 = a winning post
const MIN_N = 5;     // fewer posts in a bucket is noise

/** Rank posting windows from your data, on the clock of `tz`. */
export function bestTimes(points: TimingPoint[], tz: string, platform?: string): BestTimes {
  const rows = points.filter(p => p.t && Number.isFinite(p.o) && (!platform || platform === 'all' || p.s === platform));
  const overall = median(rows.map(r => r.o)) || 1;
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  const byDay: number[][] = Array.from({ length: 7 }, () => []);
  const grid: number[][][] = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => []));
  for (const r of rows) {
    const { day, hour } = parts(r.t, tz);
    byHour[hour].push(r.o); byDay[day]?.push(r.o); grid[day]?.[Math.floor(hour / 3)].push(r.o);
  }
  const stat = (v: number[]) => ({ n: v.length, lift: v.length ? Math.round(median(v) / overall * 100) / 100 : 0, winRate: v.length ? Math.round(v.filter(o => o >= WIN).length / v.length * 100) : 0 });

  // every 3-hour sliding window, then pick non-overlapping best ones
  const all: Window[] = [];
  for (let h = 0; h < 24; h++) {
    const v = [...byHour[h], ...byHour[(h + 1) % 24], ...byHour[(h + 2) % 24]];
    if (v.length >= MIN_N) all.push({ start: h, end: h + 3, ...stat(v) });
  }
  // rank by lift, nudged by win rate so a lucky single outlier doesn't dominate
  const rank = (w: Window) => w.lift * 0.7 + (w.winRate / 100) * 0.3 * 3;
  const sorted = [...all].sort((a, b) => rank(b) - rank(a));
  const windows: Window[] = [];
  for (const w of sorted) {
    const overlaps = windows.some(x => { const d = Math.abs(((w.start - x.start) % 24 + 24) % 24); return Math.min(d, 24 - d) < 3; });
    if (!overlaps) windows.push(w);
    if (windows.length === 3) break;
  }
  const worst = [...all].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  return {
    n: rows.length,
    enough: rows.length >= 40 && windows.length > 0,
    windows,
    worst: worst && windows.some(w => w.start === worst.start) ? null : worst,
    days: byDay.map((v, day) => ({ day, ...stat(v) })),
    grid: grid.map(row => row.map(v => ({ n: v.length, lift: v.length >= 3 ? Math.round(median(v) / overall * 100) / 100 : 0 }))),
  };
}

export const userTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
export const tzCity = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ');
