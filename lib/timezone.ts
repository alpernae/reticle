// lib/timezone.ts — time-zone math without a dependency (client-safe).
//
// Schedules and hour analytics are wall-clock time in the user's zone, but the
// server may run in UTC (the Docker image sets no TZ). So every "09:00" and
// every "which hour did this post win in" is resolved through an explicit IANA
// zone instead of the process's local time (finding F2).

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** Wall-clock parts of `ts` in `tz`. */
export function zonedParts(ts: number, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(ts))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year, month: out.month, day: out.day,
    hour: out.hour % 24, minute: out.minute, second: out.second,
  };
}

/** The zone this process would use by default (UTC inside Docker unless TZ is set). */
export function systemTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  try { formatter(tz).format(0); return true; } catch { return false; }
}

const offsets = new Map<string, number>();

/** Milliseconds to add to UTC to get local wall-clock time in `tz` at `ts`.
 *  Cached per zone × hour: an offset only changes at a DST transition. */
export function tzOffsetMs(ts: number, tz: string): number {
  const sec = Math.floor(ts / 1000) * 1000;
  const key = tz + '|' + Math.floor(sec / 36e5);
  const hit = offsets.get(key);
  if (hit !== undefined) return hit;
  const p = zonedParts(sec, tz);
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - sec;
  if (offsets.size > 8000) offsets.clear(); // bounded: a few months of hours
  offsets.set(key, off);
  return off;
}

/** 0–23 in `tz`. */
export const hourInTz = (ts: number, tz: string): number => new Date(ts + tzOffsetMs(ts, tz)).getUTCHours();

/** 0 = Sunday … 6 = Saturday in `tz`. */
export const weekdayInTz = (ts: number, tz: string): number => new Date(ts + tzOffsetMs(ts, tz)).getUTCDay();

/** Calendar-day arithmetic that ignores DST (dates, not instants). */
export function addDays(year: number, month: number, day: number, add: number) {
  const d = new Date(Date.UTC(year, month - 1, day + add));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The UTC instant whose wall clock in `tz` reads y-m-d h:mi. Two passes
 *  converge for every real zone; a wall time skipped by DST lands on the next
 *  valid instant instead of shifting the whole schedule. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let ts = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(ts, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const delta = target - asUtc;
    if (!delta) break;
    ts += delta;
  }
  return ts;
}

/** Parse the wall-clock strings the UI produces ('YYYY-MM-DDTHH:MM'). */
export function parseLocalDateTime(at: string): ZonedParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(at || ''));
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute, second: 0 };
}
