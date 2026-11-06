// Recommendations — a deterministic, explainable scorer that surfaces winning
// posts (the user's own logged winners + the top public posts collected from
// free sources), tells the truth about WHY each one won, and suggests how to
// run it on a chosen platform. No AI, no invented numbers: every bullet maps to
// a measurable signal the panel already tracks (hooks, hours, medians, spikes).
import 'server-only';
import { allPayload, PLATFORM_HINTS, TOPICS, hourHistogram, type Post } from './engine';

export type Rec = {
  id: string;
  kind: 'own' | 'public';
  origin: string;
  originLabel: string;
  title: string;
  link: string | null;
  eng: number;
  engDetail: string;
  topics: string[];
  whenLabel: string;
  because: string[];
  fit: { x: string; linkedin: string; instagram: string; threads: string };
  likes: number | null;     // public posts: likes / points; null for your logged results
  comments: number | null;
  score: number;
  scorePct: number;
};

export type RecsResult = {
  recs: Rec[];
  topicOptions: { name: string; fresh: number; pct: number }[];
  winnersByPlatform: Record<string, number>;
  note: string;
};

const SOCIALS = ['x', 'linkedin', 'instagram', 'threads'] as const;

const label = (k: string) =>
  PLATFORM_HINTS[k]?.label || ({ hn: 'HN', reddit: 'Reddit', devto: 'dev.to', other: 'Other' } as Record<string, string>)[k] || k;

const topicsOfText = (t: string): string[] => {
  const T = t.toLowerCase();
  return TOPICS.filter(([, rx]) => rx.test(T)).map(([n]) => n);
};

// hook detectors — the same signals hookStats measures on the whole panel
const hasNumber = (s: string) => /\d/.test(s);
const startsHow = (s: string) => /^(how|why|what|stop|the)\b/i.test(s.trim());
const isQuestion = (s: string) => s.includes('?');
const hasColon = (s: string) => /^[^:?#\n]{3,60}:/.test(s.trim());
const sweetLen = (s: string) => s.trim().length >= 45 && s.trim().length <= 85;

// fit lines per target platform — deterministic rewrites of PLATFORM_HINTS rules
const FIT_BASE: Record<(typeof SOCIALS)[number], string> = {
  x: 'Line-1 hook, one idea per line, ≤280 chars — link goes in the first reply.',
  linkedin: 'First 2 visible lines carry the claim; 3 short paragraphs; end on a question CTA; link in the first comment.',
  instagram: 'Slide 1 = 4–6 word giant title; one point per slide; "save this" CTA last; 5–10 niche hashtags in the caption.',
  threads: 'Conversational hook a stranger gets without context, ≤500 chars, one topic tag, end on a real question.',
};

type Cand = {
  id: string;
  kind: 'own' | 'public';
  origin: string;
  title: string;
  link: string | null;
  eng: number;
  score: number;      // public only
  comments: number;   // public only
  topics: string[];
  ts: number;         // best-known time
  whenLabel: string;
  postedHour: number | null; // real posting hour — only public posts have an honest one
  security: boolean;
  dev: boolean;
};

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const D = (n: number) => (n < 10 ? '0' + n : String(n));

export function recommendations(opts: { topics: string[]; src: string }): RecsResult {
  const payload = allPayload();
  const chosen = (opts.topics || []).map(t => String(t).slice(0, 60)).filter(t => TOPICS.some(([n]) => n === t)).slice(0, 2);
  const src = ['all', 'x', 'linkedin', 'instagram', 'threads', 'tiktok', 'youtube'].includes(opts.src) ? opts.src : 'all';

  const notes: string[] = [];
  const allowedOrigins = (k: string): boolean => {
    if (src === 'all') return true;
    return src === k;
  };

  // ---- candidates: own winners + 30-day public posts, topic-filtered ----
  const now = Date.now();
  const cands: Cand[] = [];
  for (const m of payload.manual) {
    const T = m.text || '';
    const mt = topicsOfText(T.slice(0, 300));
    const mTs = Date.parse(m.when || '') || m.ts || 0;
    if (chosen.length && !mt.some(t => chosen.includes(t))) continue;
    if (!allowedOrigins(m.platform)) continue;
    cands.push({
      id: 'm:' + m.id, kind: 'own', origin: m.platform, title: T.replace(/\s+/g, ' ').slice(0, 220),
      link: null, eng: m.eng || 0, score: 0, comments: 0, topics: mt, ts: mTs,
      whenLabel: m.when ? `${m.when} (logged ${new Date(m.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : `logged ${new Date(m.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      postedHour: null, security: false, dev: false,
    });
  }
  for (const p of payload.posts as Post[]) {
    if (now - p.created > 30 * 864e5) continue;
    const g = p.score + 2 * p.comments;
    if (g <= 0) continue;
    if (chosen.length && !(p.topics || []).some(t => chosen.includes(t))) continue;
    if (!allowedOrigins(p.source)) continue;
    const h = new Date(p.created);
    cands.push({
      id: p.id, kind: 'public', origin: p.source, title: p.title, link: p.link || null,
      eng: g, score: p.score, comments: p.comments, topics: p.topics || [], ts: p.created,
      whenLabel: `${months[h.getMonth()]} ${h.getDate()} · ${h.getHours() % 12 || 12}:${D(h.getMinutes())} ${h.getHours() < 12 ? 'AM' : 'PM'}`,
      postedHour: h.getHours(), security: !!p.security, dev: !!p.dev,
    });
  }

  // ---- norms: per-origin max for scoring + 30-day eng lists for percentiles ----
  const maxBy = new Map<string, number>();
  const engByOrigin = new Map<string, number[]>();
  for (const c of cands) {
    const vals = engByOrigin.get(c.origin) || [];
    vals.push(c.eng);
    engByOrigin.set(c.origin, vals);
  }
  for (const [o, vals] of engByOrigin) {
    maxBy.set(o, Math.max(...vals));
    vals.sort((a, b) => a - b);
  }
  const peakHours = hourHistogram().counts
    .map((n: number, h: number) => [n, h] as [number, number])
    .filter((x: [number, number]) => x[0] > 0)
    .sort((a: [number, number], b: [number, number]) => b[0] - a[0])
    .slice(0, 3)
    .map((x: [number, number]) => x[1]);
  const spikeOf = new Map<string, number>(payload.topics.map((t: { name: string; pct: number }) => [t.name, t.pct]));

  const hookFlags = (text: string) => {
    const f: string[] = [];
    if (hasNumber(text)) f.push('number');
    if (startsHow(text)) f.push('lead');
    if (isQuestion(text)) f.push('question');
    if (hasColon(text)) f.push('colon');
    if (sweetLen(text)) f.push('length');
    return f;
  };

  const scored = cands.map((c: Cand) => {
    const text = c.kind === 'public' ? c.title : c.title;
    const flags = hookFlags(text);
    const max = maxBy.get(c.origin) || 0;
    const age = now - c.ts;

    let score = 0;
    if (max > 0) score += Math.min(35, Math.round((c.eng / max) * 35));       // engagement rank inside its platform
    if (c.kind === 'own') score += 15;                                        // you have real receipts
    if (age < 4 * 864e5) score += 12; else if (age < 7 * 864e5) score += 8; else if (age < 14 * 864e5) score += 5; else if (age < 30 * 864e5) score += 2;
    score += Math.min(12, flags.length * 4);                                  // hook patterns
    if (c.postedHour !== null && peakHours.includes(c.postedHour)) score += 6; // landed in a peak hour
    if (chosen.length) {
      const best = Math.max(...c.topics.filter(t => chosen.includes(t)).map(t => Math.max(0, spikeOf.get(t) ?? 0)), 0);
      score += Math.min(8, Math.round(best / 10));                            // rides a spiking topic
    }

    const because: string[] = [];
    if (c.kind === 'own') because.push(`Your own logged result — ${c.eng.toLocaleString('en-US')} engagement you measured yourself, not an estimate.`);
    else {
      const vals = engByOrigin.get(c.origin) || []; // ascending
      const better = vals.length - 1 - vals.lastIndexOf(c.eng); // posts ranked above this one
      const topPct = Math.max(1, Math.ceil(((better + 1) / vals.length) * 100));
      if (topPct <= 10) because.push(`Top ${topPct}% of collected ${label(c.origin)} posts this month by engagement.`);
    }
    if (flags.includes('number')) because.push('Contains a concrete number — the stat-led pattern the panel\'s hook stats keep rewarding.');
    if (flags.includes('lead')) because.push('Leads with How/Why/What/Stop — the direct opener pattern from the top-quartile set.');
    if (flags.includes('question') && !flags.includes('lead')) because.push('Phrased as a question — invites replies on every platform.');
    if (flags.includes('colon')) because.push('Uses the "title: subtitle" colon pattern that wins headlines.');
    if (flags.includes('length')) because.push('Title sits in the 45–85 character sweet spot measured on winners.');
    if (c.postedHour !== null && peakHours.includes(c.postedHour)) because.push(`Went up at ${c.whenLabel.split('·')[1]?.trim() || ''} — inside the panel's peak posting hours.`);
    if (c.kind === 'own' && c.topics.length) because.push(`Rides your logged winner pattern in ${c.topics[0]}.`);
    if (chosen.length) {
      const hot = c.topics.filter(t => chosen.includes(t)).map(t => ({ t, pct: spikeOf.get(t) ?? 0 })).sort((a, b) => b.pct - a.pct)[0];
      if (hot && hot.pct > 0) because.push(`Topic "${hot.t}" is trending — ${hot.pct > 0 ? '+' : ''}${hot.pct}% vs the previous 48h window.`);
    }
    if (age < 7 * 864e5 && c.kind === 'public') because.push('Less than a week old — still inside the window where remixing it is timely.');
    if (c.security) because.push('Lands squarely in the cybersecurity lane of your audience.');

    const firstTopic = c.topics[0] || 'your niche';
    const fit = {} as Rec['fit'];
    for (const s of SOCIALS) {
      const target = label(s);
      fit[s] = `${FIT_BASE[s]} Seed angle: "${c.title.slice(0, 74)}${c.title.length > 74 ? '…' : ''}" — ${firstTopic}, carried over from ${label(c.origin)} where it earned ${c.eng.toLocaleString('en-US')}.`;
    }

    return { cand: c, score, because, fit, flags };
  });

  scored.sort((a, b) => b.score - a.score || b.cand.eng - a.cand.eng);
  const maxScore = scored[0]?.score || 1;

  const recs: Rec[] = scored.slice(0, 12).map((s: { cand: Cand; score: number; because: string[]; fit: Rec['fit'] }) => ({
    id: s.cand.id,
    kind: s.cand.kind,
    origin: s.cand.origin,
    originLabel: label(s.cand.origin),
    title: s.cand.title || '(untitled)',
    link: s.cand.link,
    eng: s.cand.eng,
    likes: s.cand.kind === 'public' ? s.cand.score : null,
    comments: s.cand.kind === 'public' ? s.cand.comments : null,
    engDetail: s.cand.kind === 'public'
      ? `score ${s.cand.score.toLocaleString('en-US')} + 2×${s.cand.comments.toLocaleString('en-US')} comments`
      : 'your logged engagement number',
    topics: s.cand.topics,
    whenLabel: s.cand.whenLabel,
    because: s.because.slice(0, 4),
    fit: s.fit,
    score: s.score,
    scorePct: Math.max(8, Math.round((s.score / maxScore) * 100)),
  }));

  if (!payload.posts.length && !payload.manual.length) notes.push('Nothing to rank yet — run the collectors on Sources (Settings → connect Apify) and log a few winners.');
  else if (!cands.length && chosen.length) notes.push(chosen.length === 1 ? `No candidate matches "${chosen[0]}" in the current pool — pick another topic or clear the filter.` : `No candidate matches those topics in the current pool — loosen the filter.`);
  else if (src !== 'all' && !payload.manual.some((m: { platform: string }) => m.platform === src)) notes.push(`You have no logged winners on ${label(src)} yet — add some on the Winners page; or run the ${label(src)} collector on Sources.`);
  if (!recs.length && !notes.length) notes.push('No recommendations for this combination yet.');

  const winnersByPlatform: Record<string, number> = {};
  for (const m of payload.manual) winnersByPlatform[m.platform] = (winnersByPlatform[m.platform] || 0) + 1;

  return {
    recs,
    topicOptions: payload.topics.filter((t: { fresh: number; name: string }) => t.fresh > 0 || chosen.includes(t.name)).map((t: { name: string; fresh: number; pct: number }) => ({ name: t.name, fresh: t.fresh, pct: t.pct })),
    winnersByPlatform,
    note: notes[0] || '',
  };
}
