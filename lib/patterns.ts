// lib/patterns.ts — turns collected posts into "why did this win" signals.
//
// Raw like counts mostly measure audience size. A post with 8k likes from an
// 880k-follower account is ordinary for them; 900 likes from a 4k-follower
// security researcher is a breakout. So every post gets an OUTLIER score:
// its weighted engagement divided by the median of the same author's posts
// (falling back to the platform median when we hold < 3 posts of that author).
// Outliers ≥ 2× are "winners" — those are the formats the algorithm pushed.
//
// On top of that each post is fingerprinted (hook type, format, length,
// hashtags, posting hour) and the fingerprints are aggregated into a pattern
// library: which traits LIFT outlier scores per platform. The AI receives
// compact winner cards + the pattern table instead of raw scraper JSON.
import 'server-only';
import type { Post } from './engine';

export type HookType =
  | 'question' | 'listicle' | 'contrarian' | 'story' | 'how-to' | 'launch'
  | 'proof' | 'engagement-ask' | 'news' | 'tool-tip' | 'statement';

export const HOOK_LABEL: Record<HookType, string> = {
  question: 'Question hook', listicle: 'Number / list', contrarian: 'Contrarian / hot take', story: 'Personal story',
  'how-to': 'How-to / tutorial', launch: 'Launch / build-in-public', proof: 'Proof / result', 'engagement-ask': 'Engagement ask',
  news: 'News / breaking', 'tool-tip': 'Tool tip / “you can now…”', statement: 'Bold statement',
};

export type Analyzed = Post & {
  eng: number;              // weighted engagement
  er: number | null;        // engagement rate vs views (or followers)
  outlier: number;          // eng ÷ author baseline (or platform baseline)
  baseline: 'author' | 'audience' | 'platform'; // creator median · engagement-per-follower vs platform · raw platform median
  hook: HookType;
  hookLine: string;
  words: number;
  lengthBucket: 'short' | 'medium' | 'long';
  hasLink: boolean;
  emojiCount: number;
  hour: number;
  weekday: number;
  niche: boolean;           // dev / security relevant
};

/** Weighted engagement — comments, shares and saves are stronger algorithm signals than likes. */
export const engagement = (p: Post) => p.score + 2 * p.comments + 3 * (p.shares || 0) + 2 * (p.saves || 0);

export function hookType(line: string): HookType {
  const l = line.toLowerCase().trim();
  // tool tips & AI news drops: "You can now use GLM for free via…", "Have you tried this new…", "PSA:", "TIL"
  if (/^(you can now|you can (finally|already)|have you tried|did you know|psa\b|til\b|pro ?tip|tip:|hidden feature|just found|this (free )?tool|new (feature|model|tool|skill)s?\b)|\b(is|are) now (free|open[- ]?source|available)|for free (via|with|on)\b/.test(l)) return 'tool-tip';
  if (/drop your|comment (below|".+")|reply with|who else|tag (a|someone)|tell me|what'?s your/.test(l)) return 'engagement-ask';
  if (/unpopular opinion|hot take|stop |nobody (talks|tells)|don'?t |myth|overrated|is dead|you'?re (doing|wrong)|wrong about|controversial/.test(l)) return 'contrarian';
  if (/\$\s?\d|\d+\s?k\b|bount(y|ies)|paid out|earned|got (hired|accepted|paid)|cve-\d{4}|hall of fame|p1\b|critical (bug|vuln)/.test(l)) return 'proof';
  if (/^(introducing|announcing)|just (shipped|launched|released|built|open[- ]?sourced)|i (built|made|shipped|launched)|open[- ]?sourc|now live|v\d+(\.\d+)?\b/.test(l)) return 'launch';
  if (/^(breaking|new:|just in)|announced|released|patch(ed)? |zero[- ]?day|0day|leak(ed)?|breach/.test(l)) return 'news';
  if (/^how (to|i|we)|here'?s how|step[- ]by[- ]step|guide|tutorial|cheat ?sheet|explained/.test(l)) return 'how-to';
  if (/^\d+\s|^\d+\)|\b\d+ (ways|tips|tools|things|lessons|mistakes|steps|reasons|books|repos|resources|bugs|commands)\b/.test(l)) return 'listicle';
  if (/\?\s*$/.test(l)) return 'question';
  if (/^(i |i'?m |i'?ve |my |when i |last (week|month|year)|yesterday|today i|\d+ (years|months) ago)/.test(l)) return 'story';
  return 'statement';
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const EMOJI = /\p{Extended_Pictographic}/gu;

export function analyze(posts: Post[]): Analyzed[] {
  const byAuthor = new Map<string, number[]>();
  const byPlat = new Map<string, number[]>();
  for (const p of posts) {
    const e = engagement(p);
    if (p.author) {
      const k = p.source + '|' + p.author.toLowerCase();
      (byAuthor.get(k) || byAuthor.set(k, []).get(k)!).push(e);
    }
    (byPlat.get(p.source) || byPlat.set(p.source, []).get(p.source)!).push(e);
  }
  const authMed = new Map([...byAuthor].filter(([, v]) => v.length >= 3).map(([k, v]) => [k, median(v)]));
  const platMed = new Map([...byPlat].map(([k, v]) => [k, median(v)]));
  // engagement-per-follower medians — the fair yardstick for one-off authors
  // (topic scans pull 1 post from many creators, so there is no creator median)
  // Only one-off posts (no creator baseline) form this yardstick: topic scans are
  // already filtered to viral posts, so comparing them to followed creators'
  // everyday posts would inflate scores into the thousands.
  const perFollower = new Map<string, number[]>();
  const hasAuthorBase = (p: Post) => !!p.author && (byAuthor.get(p.source + '|' + p.author.toLowerCase())?.length ?? 0) >= 3;
  for (const p of posts) if (p.authorFollowers && p.authorFollowers >= 100 && !hasAuthorBase(p)) {
    (perFollower.get(p.source) || perFollower.set(p.source, []).get(p.source)!).push(engagement(p) / p.authorFollowers);
  }
  const pfMed = new Map([...perFollower].filter(([, v]) => v.length >= 10).map(([k, v]) => [k, median(v)]));

  return posts.map(p => {
    const eng = engagement(p);
    const body = p.body || p.text || p.title || '';
    const hookLine = (body.split('\n').map(s => s.trim()).find(Boolean) || p.title || '').slice(0, 240);
    const aKey = p.author ? p.source + '|' + p.author.toLowerCase() : '';
    const aBase = aKey ? authMed.get(aKey) : undefined;
    const pf = pfMed.get(p.source);
    let outlier: number, baseline: Analyzed['baseline'];
    if (aBase != null) { outlier = eng / Math.max(1, aBase); baseline = 'author'; }
    else if (pf && p.authorFollowers && p.authorFollowers >= 100) { outlier = eng / p.authorFollowers / pf; baseline = 'audience'; }
    else { outlier = eng / Math.max(1, platMed.get(p.source) ?? 1); baseline = 'platform'; }
    const words = body.split(/\s+/).filter(Boolean).length;
    const d = new Date(p.created);
    return {
      ...p,
      eng,
      er: p.views ? eng / p.views : p.authorFollowers ? eng / p.authorFollowers : null,
      outlier: Math.round(outlier * 100) / 100,
      baseline,
      hook: hookType(hookLine),
      hookLine,
      words,
      lengthBucket: words < 40 ? 'short' : words < 150 ? 'medium' : 'long',
      hasLink: /https?:\/\//.test(body),
      emojiCount: (body.match(EMOJI) || []).length,
      hour: d.getHours(),
      weekday: d.getDay(),
      niche: !!(p.security || p.dev),
    } as Analyzed;
  });
}

// ---------------- pattern library ----------------
export type PatternRow = { platform: string; trait: string; value: string; n: number; medianOutlier: number; lift: number; winRate: number };

const WIN = 2; // outlier ≥ 2× the creator's normal = a winner

/** For each platform × trait value: how much does it lift outlier scores vs that platform's overall median? */
export function patternLibrary(rows: Analyzed[], minN = 5): PatternRow[] { // < 5 posts per trait is noise
  const out: PatternRow[] = [];
  const traits: [string, (a: Analyzed) => string | null][] = [
    ['format', a => a.media || null],
    ['hook', a => HOOK_LABEL[a.hook]],
    ['length', a => a.lengthBucket],
    ['hashtags', a => (a.hashtags?.length ? (a.hashtags.length > 3 ? '4+ hashtags' : '1–3 hashtags') : 'no hashtags')],
    ['link in post', a => (a.hasLink ? 'has link' : 'no link')],
    ['emoji', a => (a.emojiCount === 0 ? 'no emoji' : a.emojiCount <= 3 ? '1–3 emoji' : '4+ emoji')],
    ['time', a => (a.hour < 6 ? '00–06' : a.hour < 12 ? '06–12' : a.hour < 18 ? '12–18' : '18–24')],
    ['day', a => (a.weekday === 0 || a.weekday === 6 ? 'weekend' : 'weekday')],
  ];
  for (const plat of new Set(rows.map(r => r.source))) {
    const pr = rows.filter(r => r.source === plat);
    if (pr.length < minN * 2) continue;
    const overall = median(pr.map(r => r.outlier)) || 1;
    for (const [trait, fn] of traits) {
      const groups = new Map<string, Analyzed[]>();
      for (const r of pr) { const v = fn(r); if (v) (groups.get(v) || groups.set(v, []).get(v)!).push(r); }
      if (groups.size < 2) continue; // a trait with one value tells us nothing
      for (const [value, g] of groups) {
        if (g.length < minN) continue;
        const m = median(g.map(r => r.outlier));
        out.push({
          platform: plat, trait, value, n: g.length,
          medianOutlier: Math.round(m * 100) / 100,
          lift: Math.round((m / overall) * 100) / 100,
          winRate: Math.round((g.filter(r => r.outlier >= WIN).length / g.length) * 100),
        });
      }
    }
  }
  return out.sort((a, b) => b.lift - a.lift);
}

export function winners(rows: Analyzed[], opts: { platform?: string; limit?: number; nicheOnly?: boolean } = {}): Analyzed[] {
  return rows
    .filter(r => (!opts.platform || r.source === opts.platform) && (!opts.nicheOnly || r.niche) && r.eng >= 5)
    .sort((a, b) => b.outlier - a.outlier || b.eng - a.eng)
    .slice(0, opts.limit ?? 20);
}

// ---------------- AI-ready rendering ----------------
const k = (n: number | null | undefined) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));

/** One compact, unambiguous card per winning post — what the model actually needs to reverse-engineer it. */
export function winnerCard(a: Analyzed, i: number, bodyChars = 700): string {
  const body = (a.body || a.text || a.title || '').replace(/\n{3,}/g, '\n\n').trim();
  const metrics = [
    `${k(a.score)} likes`, `${k(a.comments)} comments`,
    a.shares != null ? `${k(a.shares)} shares` : '', a.saves != null ? `${k(a.saves)} saves` : '',
    a.views != null ? `${k(a.views)} views` : '',
  ].filter(Boolean).join(' · ');
  return [
    `#${i + 1} [${a.source.toUpperCase()} · ${a.media || 'text'}${a.durationSec ? ` ${a.durationSec}s` : ''}] by ${a.author ? '@' + a.author : 'unknown'}${a.authorFollowers ? ` (${k(a.authorFollowers)} followers)` : ''}`,
    `   OUTLIER ${a.outlier}× vs ${a.baseline === 'author' ? "this creator's median" : a.baseline === 'audience' ? 'typical engagement for an account this size' : 'platform median'} · ${metrics}${a.er != null ? ` · ER ${(a.er * 100).toFixed(1)}%` : ''}`,
    `   hook type: ${HOOK_LABEL[a.hook]} · ${a.words} words · ${a.hashtags?.length || 0} hashtags · ${a.hasLink ? 'has link' : 'no link'} · posted ${new Date(a.created).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' })}${a.niche ? '' : ' · OFF-NICHE (study the format, not the topic)'}`,
    `   HOOK: "${a.hookLine}"`,
    `   BODY: ${body.length > bodyChars ? body.slice(0, bodyChars) + '…' : body}`.replace(/\n/g, '\n         '),
  ].join('\n');
}

export function patternTable(rows: PatternRow[], platform?: string, limit = 14): string {
  const r = rows.filter(x => !platform || x.platform === platform);
  if (!r.length) return '(not enough posts yet for a pattern table — need ≥ 6 per platform)';
  const top = r.filter(x => x.lift >= 1).slice(0, limit);
  const weak = [...r].sort((a, b) => a.lift - b.lift).filter(x => x.lift < 0.85).slice(0, 5);
  return [
    'LIFTS (median outlier vs platform median; n = posts):',
    ...top.map(x => `  + ${x.platform} · ${x.trait} = ${x.value}: ${x.lift}× lift, ${x.winRate}% win-rate (n=${x.n})`),
    weak.length ? 'UNDERPERFORMS:' : '',
    ...weak.map(x => `  − ${x.platform} · ${x.trait} = ${x.value}: ${x.lift}× (n=${x.n})`),
  ].filter(Boolean).join('\n');
}
