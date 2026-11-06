// lib/formats.ts — shared (client + server) definitions for the Formats page:
// series trackers (the "Day 295/365" style daily log) and quick AI formats
// (polls, "convince me", ask-the-crowd, connect calls…).
//
// Trackers are deterministic templates filled from numbers the creator logs —
// the AI never invents a stat here. The optional "polish" only rewrites the
// free-text lines (focus / lesson), never the numbers.

export type TrackerField = { key: string; label: string; emoji: string; kind: 'number' | 'money' | 'text'; cumulative?: boolean };
export type TrackerPreset = { key: string; name: string; headline: string; totalDays: number; fields: TrackerField[]; hashtags: string };

export const TRACKER_PRESETS: TrackerPreset[] = [
  {
    key: 'bounty', name: 'Bug bounty grind',
    headline: 'Day {day}/{total} of hunting until I land a 10.0 Critical',
    totalDays: 365, hashtags: '#bugbounty #infosec',
    fields: [
      { key: 'submitted', label: 'Reports submitted', emoji: '📤', kind: 'number', cumulative: true },
      { key: 'triaged', label: 'Triaged', emoji: '🟠', kind: 'number', cumulative: true },
      { key: 'duplicate', label: 'Duplicate', emoji: '🟤', kind: 'number', cumulative: true },
      { key: 'informative', label: 'Informative / N/A', emoji: '⚪️', kind: 'number', cumulative: true },
      { key: 'paid', label: 'Paid', emoji: '💰', kind: 'money', cumulative: true },
      { key: 'hours', label: 'Worked today (h)', emoji: '💻', kind: 'number' },
      { key: 'focus', label: 'Today’s focus', emoji: '🎯', kind: 'text' },
      { key: 'lesson', label: 'Lesson learned', emoji: '💡', kind: 'text' },
    ],
  },
  {
    key: 'build', name: 'Building my app in public',
    headline: 'Day {day}/{total} building {project} in public',
    totalDays: 100, hashtags: '#buildinpublic #indiehackers',
    fields: [
      { key: 'shipped', label: 'Shipped today', emoji: '🚢', kind: 'text' },
      { key: 'users', label: 'Users / waitlist', emoji: '👥', kind: 'number' },
      { key: 'mrr', label: 'MRR', emoji: '💵', kind: 'money' },
      { key: 'commits', label: 'Commits today', emoji: '🧑‍💻', kind: 'number' },
      { key: 'hours', label: 'Hours', emoji: '⏱️', kind: 'number' },
      { key: 'blocker', label: 'Blocker', emoji: '🧱', kind: 'text' },
      { key: 'next', label: 'Tomorrow', emoji: '➡️', kind: 'text' },
    ],
  },
  {
    key: 'hybrid', name: 'Hacker builds an app',
    headline: 'Day {day}/{total}: hunting bugs by day, building {project} by night',
    totalDays: 180, hashtags: '#bugbounty #buildinpublic',
    fields: [
      { key: 'submitted', label: 'Bug reports (total)', emoji: '🐛', kind: 'number', cumulative: true },
      { key: 'paid', label: 'Bounties paid', emoji: '💰', kind: 'money', cumulative: true },
      { key: 'shipped', label: 'Shipped in my app', emoji: '🚢', kind: 'text' },
      { key: 'users', label: 'App users', emoji: '👥', kind: 'number' },
      { key: 'securityfix', label: 'Security fix I made in my own app', emoji: '🔐', kind: 'text' },
      { key: 'lesson', label: 'Lesson', emoji: '💡', kind: 'text' },
    ],
  },
];

export type Tracker = {
  id: string; preset: string; name: string; project: string;
  startDate: string;   // YYYY-MM-DD — day 1
  totalDays: number;
  headline: string;    // template with {day} {total} {project}
  hashtags: string;
  fields: TrackerField[];
  values: Record<string, string>;      // latest values (cumulative ones carry over)
  log: { day: number; date: string; text: string }[]; // posted history
};

export function dayNumber(startDate: string, now = new Date()): number {
  const s = Date.parse(startDate + 'T00:00:00');
  if (!isFinite(s)) return 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(1, Math.floor((today - s) / 864e5) + 1);
}

const money = (v: string) => (v === '' ? '$?' : /^\$/.test(v) ? v : '$' + v);

/** Render today's post from the tracker. Empty text fields are left out; empty numbers show 0. */
export function renderTracker(t: Tracker, day = dayNumber(t.startDate)): string {
  const head = t.headline.replace('{day}', String(day)).replace('{total}', String(t.totalDays)).replace('{project}', t.project || 'my app');
  const lines = [head, ''];
  for (const f of t.fields) {
    const v = (t.values[f.key] ?? '').trim();
    if (f.kind === 'text') { if (v) lines.push(`${f.emoji} ${f.label}: ${v}`); continue; }
    lines.push(`${f.emoji} ${f.label}: ${f.kind === 'money' ? money(v) : v || '0'}`);
  }
  if (t.hashtags.trim()) lines.push('', t.hashtags.trim());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function newTracker(presetKey: string, project = ''): Tracker {
  const p = TRACKER_PRESETS.find(x => x.key === presetKey) || TRACKER_PRESETS[0];
  const d = new Date();
  return {
    id: 't' + Date.now().toString(36), preset: p.key, name: p.name, project,
    startDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    totalDays: p.totalDays, headline: p.headline, hashtags: p.hashtags,
    fields: p.fields.map(f => ({ ...f })), values: {}, log: [],
  };
}

// ---------------- quick AI formats ----------------
export type QuickFormat = { key: string; name: string; example: string; brief: string };
export const QUICK_FORMATS: QuickFormat[] = [
  { key: 'poll', name: 'Poll', example: 'Which AI company is winning lately?\n- Grok\n- Claude\n- OpenAI',
    brief: 'A one-line question + 3–4 short options (one per line, "- " prefix). Options must be real, comparable choices the audience has opinions on.' },
  { key: 'convince', name: '“Convince me” debate', example: 'Convince me how Codex is better than Claude Code…',
    brief: 'Starts with "Convince me" (or "Change my mind:") pitting two specific, well-known tools/approaches the audience actually uses. Ends with an ellipsis or a question.' },
  { key: 'ask', name: 'Ask the crowd', example: 'Tell me one interesting fact about AI.',
    brief: 'A short imperative ask ("Tell me one…", "Drop the…", "What’s the one…") that anyone in the audience can answer from experience in one line.' },
  { key: 'connect', name: 'Connect call', example: "Let's connect entrepreneurs",
    brief: 'A short "let’s connect" call aimed at ONE specific audience, optionally with what the creator is into (e.g. "Let’s connect if you’re building a mobile app 📱"). No follow-for-follow.' },
  { key: 'hottake', name: 'Hot-take question', example: 'Is learning Flutter in 2026 still worth it?',
    brief: 'A slightly provocative yes/no or which-side question on a live debate in the niche. Must be defensible either way — no rage bait.' },
  { key: 'challenge', name: 'Mini challenge', example: 'Find the bug 👇 (code screenshot)',
    brief: 'A tiny challenge: "Find the bug", "What does this return?", "Spot the security flaw". Post text = 1–2 short lines asking the question (it will be posted with an IMAGE of the code). Then the snippet in ONE fenced code block with a language tag (```swift, ```kotlin, ```ts, ```python, ```php, ```http …), 4–14 lines, realistic (mobile app code, API handlers, auth checks, SQL, config). Then a final line "ANSWER: <one-sentence solution + fix>" — the answer is kept private for the creator\'s reply, never in the post text. The snippet must be correct as described and genuinely solvable; no real company code or secrets.' },
];

export const AUDIENCES: { key: string; label: string }[] = [
  { key: 'mix', label: 'Mix of my audiences' },
  { key: 'security', label: 'Security researchers / bug hunters' },
  { key: 'mobile', label: 'Mobile developers' },
  { key: 'saas', label: 'SaaS & startup founders' },
  { key: 'bridge', label: 'Bridge: security × builders' },
];
