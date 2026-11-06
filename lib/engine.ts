// social-panel engine — classifier, insights, storage. Server-side only. Post
// collection lives in lib/apify.ts (the user's own Apify collectors for
// X · Instagram · LinkedIn); this module classifies, analyzes and serves
// whatever is already in SQLite.
import 'server-only';
import { getStore, type PostRow } from './db';
import { analyze, patternLibrary, patternTable, winners, winnerCard } from './patterns';
import { findRecycled, recycledText } from './recycle';
import { geoRegions } from './geo';

export type Post = {
  id: string; source: string; title: string; text: string; url: string; link: string; score: number; comments: number; created: number;
  T?: string; topics?: string[]; security?: boolean; dev?: boolean; views?: number;
  // v2 normalizer fields (see lib/normalize.ts) — absent on legacy rows
  author?: string; authorFollowers?: number; authorLocation?: string; shares?: number; saves?: number;
  media?: string; hashtags?: string[]; body?: string; durationSec?: number;
  aiCats?: string[]; // AI-assigned audience categories (lib/categories.ts keys)
};
export type Manual = { id: number; platform: string; text: string; eng: number; when: string; ts: number; likes?: number | null; comments?: number | null; views?: number | null };
export type AIStatus = { ok: boolean; message: string; ts: number } | null;
export type AIAnalysis = { mode: 'ai' | 'stats'; text: string; ts: number; via?: { providerID: string; id: string } | null } | null;
export type DB = { posts: Post[]; manual: Manual[]; lastCollect: { ts: number; tookMs: number; summary: Record<string, string | number> } | null; lastAI?: AIStatus; lastGoodModel?: { providerID: string; id: string } | null; lastAnalysis?: AIAnalysis };

// ---------------- storage bridge (same shapes, SQLite behind) ----------------
function load(): DB {
  reclassifyIfNeeded();
  const db = getStore();
  const posts: Post[] = db.allPosts().map((r: PostRow) => ({
    id: r.id, source: r.source, title: r.title, text: r.text, url: r.url, link: r.link,
    score: r.score, comments: r.comments, created: r.created,
    T: r.T || undefined, topics: safeTopics(r.topics), security: !!r.security, dev: !!r.dev, views: r.views != null ? Number(r.views) : undefined,
    author: r.author || undefined,
    authorFollowers: r.authorFollowers != null ? Number(r.authorFollowers) : undefined,
    authorLocation: r.authorLocation || undefined,
    shares: r.shares != null ? Number(r.shares) : undefined,
    saves: r.saves != null ? Number(r.saves) : undefined,
    media: r.media || undefined,
    hashtags: r.hashtags ? safeTopics(r.hashtags) : undefined,
    body: r.body || undefined,
    durationSec: r.durationSec != null ? Number(r.durationSec) : undefined,
    aiCats: r.aiCats ? safeTopics(r.aiCats) : undefined,
  }));
  let lastCollect: DB['lastCollect'] = null, lastAI: AIStatus = null, lastGoodModel: DB['lastGoodModel'] = null, lastAnalysis: AIAnalysis = null;
  try { const v = db.getMeta('lastCollect'); if (v) lastCollect = JSON.parse(v); } catch {}
  try { const v = db.getMeta('lastAI'); if (v) lastAI = JSON.parse(v); } catch {}
  try { const v = db.getMeta('lastGoodModel'); if (v) lastGoodModel = JSON.parse(v); } catch {}
  try { const v = db.getMeta('lastAnalysis'); if (v) lastAnalysis = JSON.parse(v); } catch {}
  return { posts, manual: db.allManual(), lastCollect, lastAI, lastGoodModel, lastAnalysis };
}
function safeTopics(s: string): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }

// ---------------- classification ----------------
const SEC = [/\bcyber\s?-?security\b/, /\binfosec\b/, /\bsecurity\b/, /\bcve\b/, /\bexploit/, /\bvulnerab/, /\bzero[- ]?day\b/, /\b0day\b/, /\bmalware\b/, /\bransomware\b/, /\bphishing\b/, /\bhack/, /\bbreach\b/, /\bpentest/, /\bbug ?bounty/, /\bappsec\b/, /\bosint\b/, /\bforensic/, /\bddos\b/, /\bxss\b/, /\bsqli\b/, /\bssrf\b/, /\bpassword\b/, /\bcredential/, /\bauth(entication)?\b/, /\bencrypt/, /\bred team\b/, /\bblue team\b/, /\bthreat\b/, /\bsoc\b/, /\bfir(m|w)ware\b/, /\bbackdoor\b/, /\bleak(ed)?\b/, /\bprivacy\b/];
// target audiences beyond security: mobile devs and SaaS / startup founders (count as in-niche)
const MOBILE_RX = /\bios\b|\bandroid\b|\bswift(ui)?\b|\bkotlin\b|\bflutter\b|\bdart\b|react native|\bexpo\b|app store|play store|testflight|mobile apps?\b|\bxcode\b|\bapk\b/;
const SAAS_RX = /\bsaas\b|\bstartups?\b|indie ?hack|\bmrr\b|\barr\b|bootstrap(ped|ping)|\bfounders?\b|product hunt|\bchurn\b|\bmicro[- ]?saas\b|\bpaying (users|customers)\b|\bcustomers?\b|\brevenue\b|\bvalidat(e|ed|ing|ion)\b/;
const DEV = [/\bpython\b/, /\bjavascript\b/, /\btypescript\b/, /\bnode\.?js?\b/, /\breact\b/, /\bvue\b/, /\bsvelte\b/, /\bangular\b/, /\brust\b/, /\bgolang\b/, /\bdotnet\b|\.net\b/, /\bsql\b/, /\bdatabase\b/, /\bapi\b/, /\bdevops\b/, /\bkubernetes\b|\bk8s\b/, /\bdocker\b/, /\blinux\b/, /\bgit(hub|lab)?\b/, /\bopen[- ]?source\b/, /\bprogramm/, /\bdevelop/, /\bcompiler\b/, /\bfront[- ]?end\b/, /\bback[- ]?end\b/, /\bfull[- ]?stack\b/, /\bmachine learning\b/, /(^|\s)ai($|\s)/, /\bllm\b|\bgpt\b|\bclaude\b|\bgemini\b/, /\bframework\b/, /\balgorithm/, /\binterview\b/, MOBILE_RX, SAAS_RX];

export const TOPICS: [string, RegExp][] = [
  ['AI & LLMs', /\bai\b|\bllm\b|\bllms\b|\bgpt\b|\bclaude\b|\bgemini\b|\bmachine learning\b|openai|anthropic|neural|\bfine[- ]?tun(e|ing)\b/],
  ['Python', /\bpython\b|pypi|pandas\b|django|flask|fastapi|pytest/],
  ['JS / Web / Frontend', /\bjavascript\b|\btypescript\b|\breact\b|\bnode\b|\bvue\b|\bsvelte\b|\bangular\b|\bhtml\b|\bcss\b|frontend|web ?dev|browser|\btailwind\b/],
  ['DevOps & Cloud', /\bdevops\b|\bci\/cd\b|github actions|\bkubernetes\b|\bk8s\b|\bdocker\b|AWS\b|azure\b|\bgcp\b|terraform|cloud|\bdeploy/],
  ['Cybersecurity', /\bsecurity\b|infosec|cyber|\bcve\b|vulnerab|zero[- ]?day|0day|\bpatch(ed|ing)?\b|advisory/],
  ['Hacking & Exploits', /\bhack|exploit|\bbreach\b|\bpwn|pentest|bug ?bounty|\bxss\b|\bsqli\b|\bssrf\b|\bmalware\b|\bransomware\b|\bphishing\b|\breverse engineer|\bred team\b/],
  ['Privacy & OSINT', /\bprivacy\b|\bosint\b|surveillance|forensic|\bleak(ed)?\b|tracking|gdpr|\bdox/],
  ['Auth & Identity', /\bpassword\b|\bcredentials?\b|\bauth(entication)?\b|\b2fa\b|\bmfa\b|oauth|sso\b/],
  ['Databases', /\bdatabase\b|\bsql\b|postgres|mysql|sqlite|mongo|redis\b|\bschema\b/],
  ['Rust / Go / Systems', /\brust\w*\b|golang|\bkernel\b|\bc\+\+\b|\bcpp\b|systems program|memory safety|\bleak(ing)? (memory|ptr)/],
  ['Career & Growth', /\bcareer\b|\bjob\b|\bjobs\b|\binterview\b|productiv|burnout|remote work|salary|freelanc|\bside project\b|build in public/],
  ['Mobile Dev', MOBILE_RX],
  ['SaaS & Startups', SAAS_RX],
  ['Tools & Launches', /launch(ed|ing)?\b|monetiz|\bpricing\b|\breleased?\b|\bnew tool\b|\bv1\b|\bbeta\b|\bshipped\b/],
];

export function classify(p: Post) {
  const T = (p.title + ' ' + p.text).toLowerCase();
  p.T = T;
  if (SEC.some(r => r.test(T))) p.security = true;
  if (DEV.some(r => r.test(T))) p.dev = true;
  p.topics = TOPICS.filter(([, rx]) => rx.test(T)).map(([n]) => n);
}

/** Bump when TOPICS / niche regexes change — stored posts are re-classified once. */
const CLASSIFIER_VERSION = '2'; // v2: Mobile Dev + SaaS & Startups audiences
let classifierChecked = false;
function reclassifyIfNeeded() {
  if (classifierChecked) return;
  classifierChecked = true;
  const db = getStore();
  if (db.getMeta('classifierVersion') === CLASSIFIER_VERSION) return;
  for (const r of db.allPosts()) {
    const p = { title: r.title, text: r.body || r.text } as Post;
    classify(p);
    db.setClassification(r.id, (p.T || '').slice(0, 2000), JSON.stringify(p.topics || []), p.security ? 1 : 0, p.dev ? 1 : 0);
  }
  db.setMeta('classifierVersion', CLASSIFIER_VERSION);
}

// ---------------- analysis ----------------
export function topicSpikes(dbx: DB = load()) {
  const now = Date.now();
  const fresh = [now - 48 * 36e5, now] as [number, number];
  const prev = [now - 96 * 36e5, now - 48 * 36e5] as [number, number];
  const inWin = (p: Post, [a, b]: [number, number]) => p.created >= a && p.created < b;
  return TOPICS.map(([name]) => {
    const f = dbx.posts.filter(p => inWin(p, fresh) && p.topics!.includes(name));
    const q = dbx.posts.filter(p => inWin(p, prev) && p.topics!.includes(name));
    const pct = q.length ? Math.round(((f.length - q.length) / q.length) * 100) : (f.length ? 100 : 0);
    return { name, fresh: f.length, prev: q.length, pct, top: [...f].sort((a, b) => (b.score + 2 * b.comments) - (a.score + 2 * a.comments)).slice(0, 3).map(p => ({ title: p.title, source: p.source, link: p.link, score: p.score })) };
  }).sort((a, b) => b.fresh - a.fresh || b.pct - a.pct);
}

export function hookStats(dbx: DB = load()) {
  const bySource: Record<string, any> = {}; const agg: any = { winners: 0, numbers: 0, how: 0, questions: 0, colon: 0, lenSum: 0 };
  for (const src of new Set(dbx.posts.map(p => p.source))) {
    const rows = dbx.posts.filter(p => p.source === src && p.score > 3);
    if (rows.length < 10) continue;
    const scores = rows.map(p => p.score).sort((a, b) => a - b);
    const th = scores[Math.floor(scores.length * 0.75)];
    const winners = rows.filter(p => p.score >= th);
    let numbers = 0, how = 0, questions = 0, colon = 0, lenSum = 0;
    for (const p of winners) {
      const t = p.title;
      if (/\d/.test(t)) numbers++;
      if (/^(how|why|what|is|does|can|stop|the)\b/i.test(t)) how++;
      if (/\?/.test(t)) questions++;
      if (/:\s/.test(t)) colon++;
      lenSum += t.length;
    }
    bySource[src] = { winners: winners.length, total: rows.length, numbers, how, questions, colon, avgLen: Math.round(lenSum / (winners.length || 1)) };
    agg.winners += winners.length; agg.numbers += numbers; agg.how += how; agg.questions += questions; agg.colon += colon; agg.lenSum += lenSum;
  }
  if (agg.winners) agg.avgLen = Math.round(agg.lenSum / agg.winners);
  agg.numbers = Math.round((agg.numbers / (agg.winners || 1)) * 100);
  agg.how = Math.round((agg.how / (agg.winners || 1)) * 100);
  agg.questions = Math.round((agg.questions / (agg.winners || 1)) * 100);
  agg.colon = Math.round((agg.colon / (agg.winners || 1)) * 100);
  return { agg, bySource };
}

export function hourHistogram(dbx: DB = load()) {
  const counts = new Array(24).fill(0);
  const rows = dbx.posts.filter(p => p.created && p.score > 3);
  const thPer: Record<string, number> = {};
  for (const src of new Set(dbx.posts.map(p => p.source))) {
    const scores = rows.filter(p => p.source === src).map(p => p.score).sort((a, b) => a - b);
    thPer[src] = scores[Math.floor(scores.length * 0.8)] || 1;
  }
  const winners = rows.filter(p => p.score >= thPer[p.source]);
  for (const p of winners) counts[new Date(p.created).getHours()]++;
  return { counts, total: winners.length };
}

export function topPosts(n = 40, filter?: (p: Post) => boolean, dbx: DB = load()) {
  let rows = dbx.posts.filter(p => p.score > 1);
  if (filter) rows = rows.filter(filter);
  return [...rows].sort((a, b) => (b.score + 2 * b.comments) - (a.score + 2 * a.comments)).slice(0, n);
}

export type Digest = {
  total: number;
  last24h: number;
  windowDays: number;
  bySource: { source: string; n: number; eng: number }[];
  securityShare: number;
  risingTopics: { name: string; fresh: number; prev: number; pct: number }[];
  topPosts: { title: string; source: string; link: string; score: number }[];
  hours: { counts: number[]; total: number };
  hooks: { numbers: number; how: number; questions: number; colon: number; avgLen: number | null };
  winnerCards: string;   // top outlier posts, AI-ready
  patterns: string;      // pattern-library lifts, AI-ready
  recycled: string;      // posts creators keep re-posting, AI-ready
};

/**
 * SQL-backed digest of the whole database — this is what the AI reads before it
 * writes anything. Richer than the page analytics: window buckets, per-source
 * engagement, security share and rising topics straight out of SQL.
 */
export function analysisDigest(): Digest {
  const db = getStore();
  const now = Date.now();
  const spikes = topicSpikes();
  const rising = spikes.filter(t => t.fresh || t.prev).slice(0, 8).map(t => ({ name: t.name, fresh: t.fresh, prev: t.prev, pct: t.pct }));
  const ha = hookStats().agg;
  const rows = analyze(load().posts);
  const wins = winners(rows, { limit: 8 });
  return {
    total: db.count(),
    last24h: db.volumeWindow(now - 864e5),
    windowDays: 30,
    bySource: db.sourceStats(now - 30 * 864e5),
    securityShare: Math.round((db.securityCount(now - 30 * 864e5) / Math.max(1, db.count())) * 100),
    risingTopics: rising,
    topPosts: db.topEngaged(now - 7 * 864e5, 8).map(t => ({ title: t.title, source: t.source, link: t.link, score: t.score })),
    hours: hourHistogram(),
    hooks: { numbers: ha.numbers, how: ha.how, questions: ha.questions, colon: ha.colon, avgLen: ha.avgLen ?? null },
    winnerCards: wins.map((a, i) => winnerCard(a, i, 320)).join('\n\n'),
    patterns: patternTable(patternLibrary(rows), undefined, 10),
    recycled: recycledText(findRecycled(rows), 4),
  };
}

/** The digest rendered as the compact bullet block the AI prompt embeds. */
export function digestText(d: Digest): string {
  const lines: string[] = [];
  lines.push(`Database: ${d.total} posts (rolling collection window), ${d.last24h} in the last 24h, ${d.securityShare}% tagged security.`);
  lines.push(`By source: ${d.bySource.map((s: any) => `${s.source} ${s.n} posts / ${s.eng} total engagement`).join('; ') || 'none'}.`);
  lines.push('Rising topics (last 48h vs previous 48h):');
  for (const t of d.risingTopics) lines.push(`  - ${t.name}: ${t.fresh} fresh vs ${t.prev} prev (${t.pct >= 0 ? '+' : ''}${t.pct}%)`);
  lines.push('Top engaged posts (last 7d):');
  for (const p of d.topPosts) lines.push(`  - ${p.title.slice(0, 110)} [score ${p.score}, ${p.source}]`);
  const topHours = d.hours.counts.map((n, h) => [n, h] as [number, number]).filter((x: [number, number]) => x[0]).sort((a: [number, number], b: [number, number]) => b[0] - a[0]).slice(0, 3);
  lines.push(`Best posting hours (local): ${topHours.map((x: [number, number]) => String(x[1]).padStart(2, '0') + ':00').join(', ') || 'no data'} (${d.hours.total} top-scoring posts sampled).`);
  lines.push(`Hook patterns of winners: ${d.hooks.numbers}% contain a number; ${d.hooks.how}% start with How/Why/What/Stop/The; ${d.hooks.questions}% are questions; ${d.hooks.colon}% use "title: subtitle"; avg title ${d.hooks.avgLen ?? '—'} chars.`);
  if (d.winnerCards) lines.push('', "OUTLIER WINNER CARDS (posts that beat their creator's normal):", d.winnerCards);
  if (d.patterns) lines.push('', 'PATTERN TABLE:', d.patterns);
  if (d.recycled) lines.push('', 'RECYCLED POSTS (same text re-posted by its creator, or one template used by many):', d.recycled);
  return lines.join('\n');
}

/** Honest no-AI fallback: the same digest, summarized by rules. */
export function statsSummary(d: Digest): string {
  const top = d.risingTopics[0];
  const topHours = d.hours.counts.map((n, h) => [n, h] as [number, number]).filter((x: [number, number]) => x[0]).sort((a: [number, number], b: [number, number]) => b[0] - a[0]).slice(0, 2);
  const engTotal = d.bySource.reduce((s: number, x: { n: number; eng: number }) => s + x.eng, 0);
  return [
    `Snapshot (stats only — AI unavailable):`,
    `· ${d.total} posts over ${d.windowDays} days, ${d.last24h} landed in the last 24h, ${d.securityShare}% security-tagged.`,
    top ? `· Fastest topic: ${top.name} — ${top.fresh} fresh vs ${top.prev} prev (${top.pct >= 0 ? '+' : ''}${top.pct}%).` : '· No topic spikes yet.',
    `· Total engagement ${engTotal.toLocaleString('en-US')}; busiest hours ${topHours.map((x: [number, number]) => String(x[1]).padStart(2, '0') + ':00').join(' & ') || '—'}.`,
    d.hooks.numbers ? `· ${d.hooks.numbers}% of winning titles contain a number; avg title ${d.hooks.avgLen} chars.` : '',
    `· Action: post a ${top?.name || 'top'} take around ${topHours[0] ? String(topHours[0][1]).padStart(2, '0') + ':00' : 'your peak hour'}; keep titles 45–85 chars with one concrete number.`,
  ].filter(Boolean).join('\n');
}

export function allPayload() {
  const d = load();
  return {
    posts: d.posts,
    topics: topicSpikes(d),
    hooks: hookStats(d),
    hours: hourHistogram(d),
    // compact timing points for the Best-time card: source, created, outlier score
    ...(() => {
      const rows = analyze(d.posts).filter(a => a.created);
      return {
        timing: rows.map(a => ({ s: a.source, t: a.created, o: a.outlier })),
        // post id → outlier score (the Feed shows it on every row)
        outliers: Object.fromEntries(rows.map(a => [a.id, Math.round(a.outlier * 100) / 100])) as Record<string, number>,
        // where authors say they are → regions for the Overview planet
        geo: geoRegions(rows.map(a => ({ source: a.source, author: a.author, authorLocation: a.authorLocation, created: a.created, outlier: a.outlier, title: a.title, link: a.link }))),
      };
    })(),
    manual: d.manual,
    lastCollect: d.lastCollect ?? null,
    lastAI: d.lastAI ?? null,
    lastGoodModel: d.lastGoodModel ?? null,
    lastAnalysis: d.lastAnalysis ?? null,
    count: d.posts.length,
  };
}

// ---------------- manual (my results: generate outputs + logged stats) ----------------
export function addManual(m: { platform: string; text: string; eng: number; when: string; likes?: number | null; comments?: number | null; views?: number | null }) {
  if (!m.text?.trim()) throw new Error('text required');
  const db = getStore();
  const num = (v: unknown) => (v == null ? null : Math.max(0, Math.round(Number(v) || 0)));
  db.addManual({
    id: Date.now() + Math.floor(Math.random() * 999),
    platform: String(m.platform || 'other').slice(0, 20),
    text: String(m.text).slice(0, 1500),
    eng: Math.max(0, +m.eng || 0),
    when: String(m.when || '').slice(0, 80),
    ts: Date.parse(String(m.when || '')) || Date.now(),
    likes: num(m.likes), comments: num(m.comments), views: num(m.views),
  });
}

/** Whitelisted partial update for a stored result (log likes/comments/views/date). */
export function updateManual(id: string, f: { eng?: number; when?: string; likes?: number | null; comments?: number | null; views?: number | null }) {
  const n = Number(String(id).replace(/^m:/, ''));
  if (!Number.isFinite(n)) throw new Error('bad id');
  const num = (v: unknown) => (v == null ? null : Math.max(0, Math.round(Number(v) || 0)));
  const eng = f.eng != null ? Math.max(0, Math.round(Number(f.eng) || 0)) : undefined;
  const likes = f.likes === undefined ? undefined : num(f.likes);
  const comments = f.comments === undefined ? undefined : num(f.comments);
  const views = f.views === undefined ? undefined : num(f.views);
  getStore().updateManual(n, {
    eng,
    when: f.when === undefined ? undefined : String(f.when).slice(0, 80),
    likes, comments, views,
    // engagement derived when the user logs the granular numbers and didn't type eng directly
    ...((eng === undefined && likes != null && comments != null) ? { eng: likes + 2 * comments } : {}),
  });
}
export function delManual(id: string) {
  const n = Number(String(id).replace(/^m:/, ''));
  if (Number.isFinite(n)) getStore().delManual(n);
}

export function markAI(ok: boolean, message: string) {
  getStore().setMeta('lastAI', JSON.stringify({ ok, message, ts: Date.now() }));
}

export function markGoodModel(m: { providerID: string; id: string } | null) {
  getStore().setMeta('lastGoodModel', JSON.stringify(m));
}

export function markAnalysis(a: NonNullable<AIAnalysis>) {
  getStore().setMeta('lastAnalysis', JSON.stringify(a));
}

// ---------------- platform formats & fallback skeletons ----------------
export const PLATFORM_HINTS: Record<string, { label: string; rules: string; limit?: number }> = {
  x: { label: 'X / Twitter', rules: 'Hook in line 1 (no link in body). One idea per line, line breaks over punctuation. Max 1 hashtag (often none). Under 280 chars for the main tweet.', limit: 280 },
  linkedin: { label: 'LinkedIn', rules: 'First 2 lines earn the "…more" click — strongest claim there. 3 short paragraphs max, one idea each. Question CTA. No link in body (reaches worse). 3–5 hashtags at the very end. Professional but personal voice.', limit: 3000 },
  instagram: { label: 'Instagram (carousel)', rules: 'Slide 1 = 4–6 word giant title. Slides 2–5: one point each, huge text, few words. Last slide = CTA (save + follow). Caption: 2–3 sentences + 5–10 niche hashtags (mix big and small tags).', limit: 2200 },
  threads: { label: 'Threads', rules: 'Hook in line 1, written for a stranger with no context. Conversational, first person, short paragraphs. Max 500 chars per post; longer ideas become a chain. At most ONE topic tag. End with a real question that invites replies.', limit: 500 },
  tiktok: { label: 'TikTok / Reels', rules: '0–2s pattern interrupt (most surprising fact first). Then 3 quick beats: what → why → what to do. End loops back to start. Write as a 15–30s spoken script with on-screen caption cues. Add a 1–2 line caption + 3–5 hashtags.', limit: 4000 },
  youtube: { label: 'YouTube', rules: 'Deliver: TITLE (≤60 chars, curiosity + concrete payoff), THUMBNAIL TEXT (≤4 words), then the first 30 seconds as a spoken HOOK SCRIPT (state the payoff, show proof, open a loop), then a 5–7 beat OUTLINE with timestamps. If the pattern data favors Shorts, write a 30–45s Short script instead.', limit: 5000 },
};

const HASHTAGS: Record<string, string[]> = {
  'AI & LLMs': ['#AI', '#LLM', '#OpenAI'], Python: ['#Python', '#CodeNewbie', '#DevCommunity'],
  'JS / Web / Frontend': ['#JavaScript', '#WebDev', '#ReactJS'], 'DevOps & Cloud': ['#DevOps', '#Kubernetes', '#Cloud'],
  Cybersecurity: ['#Infosec', '#CyberSecurity', '#Security'], 'Hacking & Exploits': ['#BugBounty', '#Infosec', '#Hacking'],
  'Privacy & OSINT': ['#Privacy', '#OSINT'], 'Auth & Identity': ['#AppSec', '#2FA'], Databases: ['#SQL', '#Database'],
  'Rust / Go / Systems': ['#RustLang', '#SystemsProgramming'], 'Career & Growth': ['#BuildInPublic', '#DevLife'], 'Tools & Launches': ['#SaaS', '#IndieHacker'],
};

export function fallbackDraft(platformKey: string, src?: { title?: string; topic?: string } | null) {
  const pf = PLATFORM_HINTS[platformKey] || PLATFORM_HINTS.x;
  const topic = src?.topic || 'dev';
  const srcTitle = src?.title ? `'${src.title.slice(0, 90)}${src.title.length > 90 ? '…' : ''}'` : 'the top post in this topic';
  const base: Record<string, string> = {
    x: `1) HOOK — rewrite the source's surprise in your own words, ≤90 chars. Seed: ${srcTitle}\n2) BODY — 2–3 short lines: what happened → why devs/security folks care.\n3) TAKE — one plain-spoken opinion. No engagement-bait.\n4) Link goes in the first reply, not the post.`,
    linkedin: `1) HOOK (first 2 visible lines): a claim or number people must agree/disagree with.\n2) STORY: 3 mini-paragraphs — what happened → what you noticed that others missed → what you do differently.\n3) CTA: a question your audience can answer from experience.\n4) Link in the first comment.`,
    instagram: `1) SLIDE 1: giant 4–6 word title from the source.\n2) SLIDES 2–5: one point per slide, huge text.\n3) LAST SLIDE: "Save this" + follow CTA.\n4) CAPTION: 2–3 sentences of context.`,
    tiktok: `0–2s: say the most surprising part first (no intro).\n2–15s: three beats — what → why → show it (screen-record the source if possible).\n15–25s: one action viewers can take today.\nEND: last line loops back to the first.`,
  };
  const text = base[platformKey] || base.x;
  const hashtags = HASHTAGS[topic] || [];
  return {
    mode: 'template' as const,
    variants: [{ angle: 'Template skeleton', text, hashtags: hashtagLine(platformKey, hashtags) }],
    note: `Template skeleton for ${pf.label}. Connect AI (OpenCode) for fully written drafts.`,
  };
}
function hashtagLine(platformKey: string, tags: string[]): string[] {
  if (!tags.length) return [];
  const n = platformKey === 'x' || platformKey === 'threads' ? 1 : platformKey === 'linkedin' ? 4 : 8;
  return tags.slice(0, n);
}

// legacy export used by lib/opencodeai (kept for compatibility)
export const dbHandles = { get: load, markAI };
