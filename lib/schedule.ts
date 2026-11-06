// lib/schedule.ts — automation schedules (client-safe): when does it fire next,
// and how to say the schedule in words. Local time of the machine running it.

export type Schedule = {
  type: 'manual' | 'once' | 'daily' | 'weekly' | 'interval';
  at?: string;               // once: 'YYYY-MM-DDTHH:MM' (local)
  time?: string;             // daily/weekly: 'HH:MM'
  days?: number[];           // weekly: 0 = Sun … 6 = Sat
  everyHours?: number;       // interval
};

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The next time this schedule fires after `from`, or null. */
export function nextRunOf(s: Schedule, from = Date.now()): number | null {
  const atTime = (d: Date, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  switch (s.type) {
    case 'once': { if (!s.at) return null; const t = new Date(s.at).getTime(); return t > from ? t : null; }
    case 'daily': { const d = atTime(new Date(from), s.time || '09:00'); if (d.getTime() <= from) d.setDate(d.getDate() + 1); return d.getTime(); }
    case 'weekly': {
      if (!s.days?.length) return null;
      for (let i = 0; i < 8; i++) {
        const d = new Date(from); d.setDate(d.getDate() + i);
        const t = atTime(d, s.time || '09:00');
        if (s.days.includes(t.getDay()) && t.getTime() > from) return t.getTime();
      }
      return null;
    }
    case 'interval': return from + (s.everyHours || 24) * 36e5;
    default: return null;
  }
}

const hm = (t?: string) => {
  const [h, m] = (t || '09:00').split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

/** "Every weekday at 9:00 AM", "Once on Fri, Nov 7 at 6:30 PM", … */
export function describeSchedule(s: Schedule): string {
  switch (s.type) {
    case 'once': return s.at ? `Once on ${new Date(s.at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Once (pick a date)';
    case 'daily': return `Every day at ${hm(s.time)}`;
    case 'weekly': {
      const d = [...(s.days || [])].sort();
      const days = d.join() === '1,2,3,4,5' ? 'weekday' : d.join() === '0,6' ? 'weekend day' : d.map(x => DAY_SHORT[x]).join(', ');
      return d.length ? `Every ${days} at ${hm(s.time)}` : 'Weekly (pick days)';
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
