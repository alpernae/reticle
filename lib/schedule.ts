// lib/schedule.ts — automation schedules (client-safe): when does it fire next,
// and how to say the schedule in words. Wall-clock time in an explicit IANA
// zone (the user's), never the server process's local time (finding F2).
import { addDays, parseLocalDateTime, systemTimezone, zonedParts, zonedTimeToUtc } from './timezone';

export type Schedule = {
  type: 'manual' | 'once' | 'daily' | 'weekly' | 'interval';
  at?: string;               // once: 'YYYY-MM-DDTHH:MM' (wall clock in the user's zone)
  time?: string;             // daily/weekly: 'HH:MM'
  days?: number[];           // weekly: 0 = Sun … 6 = Sat
  everyHours?: number;       // interval
};

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'HH:MM' → [hour, minute], clamped; missing/invalid falls back to 09:00. */
function hhmm(t?: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '09:00'));
  return m ? [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))] : [9, 0];
}

/** The next time this schedule fires after `from`, or null. */
export function nextRunOf(s: Schedule, from = Date.now(), tz = systemTimezone()): number | null {
  const [h, m] = hhmm(s.time);
  switch (s.type) {
    case 'once': {
      const p = parseLocalDateTime(s.at || '');
      if (!p) return null;
      const t = zonedTimeToUtc(p.year, p.month, p.day, p.hour, p.minute, tz);
      return t > from ? t : null;
    }
    case 'daily': {
      const now = zonedParts(from, tz);
      for (let i = 0; i < 3; i++) {
        const d = addDays(now.year, now.month, now.day, i);
        const t = zonedTimeToUtc(d.year, d.month, d.day, h, m, tz);
        if (t > from) return t;
      }
      return null;
    }
    case 'weekly': {
      if (!s.days?.length) return null;
      const now = zonedParts(from, tz);
      for (let i = 0; i < 8; i++) {
        const d = addDays(now.year, now.month, now.day, i);
        const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
        if (!s.days.includes(weekday)) continue;
        const t = zonedTimeToUtc(d.year, d.month, d.day, h, m, tz);
        if (t > from) return t;
      }
      return null;
    }
    case 'interval': return from + (s.everyHours || 24) * 36e5;
    default: return null;
  }
}

const hmText = (t?: string) => {
  const [h, m] = hhmm(t);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const onceText = (at?: string): string => {
  const p = parseLocalDateTime(at || '');
  if (!p) return 'Once (pick a date)';
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day))
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `Once on ${day} at ${hmText(`${p.hour}:${String(p.minute).padStart(2, '0')}`)}`;
};

/** "Every weekday at 9:00 AM", "Once on Fri, Nov 7 at 6:30 PM", … */
export function describeSchedule(s: Schedule): string {
  switch (s.type) {
    case 'once': return onceText(s.at);
    case 'daily': return `Every day at ${hmText(s.time)}`;
    case 'weekly': {
      const d = [...(s.days || [])].sort();
      const days = d.join() === '1,2,3,4,5' ? 'weekday' : d.join() === '0,6' ? 'weekend day' : d.map(x => DAY_SHORT[x]).join(', ');
      return d.length ? `Every ${days} at ${hmText(s.time)}` : 'Weekly (pick days)';
    }
    case 'interval': return `Every ${s.everyHours || 24} hour${(s.everyHours || 24) === 1 ? '' : 's'}`;
    default: return 'Only when you press Run';
  }
}

/** "in 3h 20m", "in 2 days", "now" */
export function untilText(t: number | null, now = Date.now()): string {
  if (t == null) return '—';
  const m = Math.round((t - now) / 60000);
  if (m <= 0) return 'due now';
  if (m < 60) return `in ${m}m`;
  if (m < 48 * 60) return `in ${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
  return `in ${Math.round(m / 1440)} days`;
}
