// lib/apify.ts — server-only bridge to the user's own Apify account for the
// platforms this panel targets: X, Instagram, Threads, LinkedIn, TikTok, YouTube.
//
// The token lives locally in SQLite meta (never committed, never sent anywhere
// but api.apify.com). Runs are started through the Apify Run API with cost
// guards (maxItems per run + reduced memory allocation), then polled; finished
// run datasets are mapped defensively (actor output shapes vary version to
// version) into the standard posts table with source = x | instagram | linkedin,
// so every existing analysis / scoring / recommendation path works unchanged.
//
// Honest limits: public scrapes can return the posted time and public like
// counts; X actors usually return the public view count (an impressions proxy).
// Private analytics — your own impressions per country, reach demographics —
// are NOT obtainable through Apify; that needs an own-account importer later.
import 'server-only';
import { getStore, type PostRow } from './db';
import { importItems, isPlatform as isPlat, PLAT_LABEL as LABELS, type Platform } from './normalize';

export type ApifyPlatform = Platform;
export const PLAT_LABEL = LABELS;

/** Editable actor defaults — overridden in the Sources page, stored in meta. */
export type ApifyConfig = Record<ApifyPlatform, { actor: string; sources: string; maxItems: number }>;

const DEFAULT_CONFIG: ApifyConfig = {
  x: { actor: 'apidojo/tweet-scraper', sources: '', maxItems: 150 },
  linkedin: { actor: 'apimaestro/linkedin-profile-posts', sources: '', maxItems: 30 },
  instagram: { actor: 'apify/instagram-scraper', sources: '', maxItems: 30 },
  threads: { actor: 'futurizerush/meta-threads-scraper', sources: '', maxItems: 30 },
  tiktok: { actor: 'clockworks/tiktok-scraper', sources: '', maxItems: 30 },
  youtube: { actor: 'streamers/youtube-scraper', sources: '', maxItems: 20 },
};

export function isPlatform(k: string): k is ApifyPlatform { return isPlat(k); }

// ---------------- token (stored locally in SQLite meta only) ----------------
export function getApifyToken(): string | null {
  const t = (getStore().getMeta('apifyToken') || '').trim();
  return t.length >= 20 ? t : null;
}
export function setApifyToken(t: string) { getStore().setMeta('apifyToken', String(t || '').trim().slice(0, 200)); }
export function clearApifyToken() { getStore().setMeta('apifyToken', ''); }
export function tokenMasked(): string | null {
  const t = (getStore().getMeta('apifyToken') || '').trim();
  return t ? '••••' + t.slice(-4) : null;
}

export async function verifyToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const me = await areq<{ username?: string; name?: string }>('/users/me', token);
    return { ok: true, username: me.username || me.name };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'unknown error').slice(0, 140) };
  }
}

// ---------------- spend limit (user-set monthly budget in $) ----------------
/** Monthly spend limit in USD, 0 = unlimited. Once the current usage cycle's
 *  spend (Apify's own usage API, falling back to locally tracked run costs)
 *  reaches the limit, new runs are refused and still-running collector runs
 *  are aborted at the next poll. */
export function readBudget(): number {
  const n = Number(getStore().getMeta('apifyBudgetUsd'));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
export function setBudget(usd: number) {
  const n = Math.min(50, Math.max(0, Math.round(Number(usd) * 100) / 100));
  getStore().setMeta('apifyBudgetUsd', String(n || 0));
}

// ---------------- config ----------------
export function readConfig(): ApifyConfig {
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as ApifyConfig;
  const raw = getStore().getMeta('apifyConfig');
  if (!raw) return base;
  try {
    const v = JSON.parse(raw);
    for (const k of Object.keys(base) as ApifyPlatform[]) {
      if (v[k]?.actor) base[k].actor = String(v[k].actor);
      if (typeof v[k]?.maxItems === 'number') base[k].maxItems = v[k].maxItems;
      if (typeof v[k]?.sources === 'string') base[k].sources = String(v[k].sources);
    }
  } catch {}
  return base;
}

export function saveConfig(next: ApifyConfig): ApifyConfig {
  const cur = readConfig();
  for (const k of Object.keys(cur) as ApifyPlatform[]) {
    const n = next?.[k] || {};
    const actor = String(n.actor || cur[k].actor).trim().replace(/\s+/g, '');
    const maxItems = Math.max(1, Math.min(400, Number(n.maxItems) || cur[k].maxItems));
    const sources = String(n.sources ?? cur[k].sources).slice(0, 1200);
    cur[k] = { actor: actor || DEFAULT_CONFIG[k].actor, maxItems, sources };
  }
  getStore().setMeta('apifyConfig', JSON.stringify(cur));
  return cur;
}

// ---------------- run history (meta 'apifyRuns', last 20) ----------------
export type ApifyRunRec = {
  id: string;
  platform: ApifyPlatform;
  actor: string;
  ts: number;
  status: string;
  items: number | null;
  imported: { added: number; updated: number; skipped: number } | null;
  error: string | null;
  note?: string; // honest context when a run finishes oddly (0 items, everything dropped…)
  costUsd?: number | null; // actual Apify usage for this run (usageTotalUsd), recorded when terminal
};

const monthKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Fallback spend tracking: recorded costs of this panel's runs started this
 *  calendar month. The authoritative number is the user's Apify usage cycle. */
function localSpend(): number | null {
  const mk = monthKey(Date.now());
  let sum = 0, seen = false;
  for (const r of readRuns()) {
    if (typeof r.costUsd === 'number' && monthKey(r.ts) === mk) { sum += r.costUsd; seen = true; }
  }
  return seen ? sum : null;
}

function readRuns(): ApifyRunRec[] {
  try {
    const a = JSON.parse(getStore().getMeta('apifyRuns') || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function writeRuns(r: ApifyRunRec[]) { getStore().setMeta('apifyRuns', JSON.stringify(r.slice(0, 80))); } // deep scans add one run per account
export function listRuns(): ApifyRunRec[] { return readRuns(); }
function patchRun(id: string, patch: Partial<ApifyRunRec>) {
  const runs = readRuns();
  const i = runs.findIndex(r => r.id === id);
  if (i < 0) return;
  runs[i] = { ...runs[i], ...patch };
  writeRuns(runs);
}

export function readApifyStatus() {
  return {
    connected: !!getApifyToken(),
    mask: tokenMasked(),
    config: readConfig(),
    runs: listRuns(),
    budget: { limit: readBudget(), spentThisMonth: localSpend() },
  };
}

// ---------------- apify http ----------------
const API = 'https://api.apify.com/v2';

async function areq<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${sep}token=${encodeURIComponent(token)}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = await res.json(); msg = j?.error?.message || j?.error || msg; } catch {}
    throw new Error(String(msg).slice(0, 200));
  }
  return ((await res.json()) as { data: T }).data;
}

// ---------------- usage + spend guard (Apify's own usage API) ----------------
function numish(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return isFinite(n) && n >= 0 ? n : null;
}

let usageCache: { at: number; usd: number | null } | null = null;
const USAGE_TTL = 60_000;

/** Spend in the user's CURRENT usage cycle (not the calendar month — Apify cycles
 *  start on your signup date). Cached 60s; null when the API never answered. */
async function cycleUsageUsd(token: string): Promise<number | null> {
  if (usageCache && Date.now() - usageCache.at < USAGE_TTL) return usageCache.usd;
  let usd: number | null = null;
  try {
    const j = await areq<any>('/users/me/usage/monthly', token);
    usd = numish(j?.totalUsageCreditsUsdAfterVolumeDiscount)
      ?? numish(j?.totalUsageCreditsUsdBeforeVolumeDiscount)
      ?? numish(j?.totalUsageCreditsUsd);
  } catch { usd = null; } // usage API unavailable — run the guard on locally tracked costs instead
  usageCache = { at: Date.now(), usd };
  return usd;
}

export type SpendInfo = { limit: number; spend: number | null; via: 'apify' | 'local' | 'unknown'; left: number | null };

/** Where things stand against the spend limit. spend/left are null when unknown. */
export function spendInfo(): Promise<SpendInfo> {
  const limit = readBudget();
  const token = getApifyToken();
  if (limit <= 0) {
    return (token ? cycleUsageUsd(token) : Promise.resolve(null)).then(api => {
      const local = localSpend();
      return { limit, spend: api ?? local, via: api != null ? 'apify' as const : local != null ? 'local' as const : 'unknown' as const, left: null };
    });
  }
  return (token ? cycleUsageUsd(token) : Promise.resolve(null)).then(api => {
    const local = localSpend();
    const vals = [api, local].filter((v): v is number => v != null);
    if (!vals.length) return { limit, spend: null, via: 'unknown' as const, left: null };
    const spend = Math.max(...vals); // larger of the two = the safer estimate
    return {
      limit, spend,
      via: api != null && (local == null || api >= local) ? 'apify' as const : 'local' as const,
      left: Math.max(0, limit - spend),
    };
  });
}
// ---------------- actor input (per platform, cost-guarded) ----------------
function splitList(s: string): string[] {
  return String(s || '').split(/[,\n;]+/).map(t => t.trim()).filter(Boolean);
}

/** "https://x.com/someone/" or "https://twitter.com/someone" → "someone"; null
 *  for tweet/list/replies URLs that must stay in startUrls. */
function handleOfUrl(u: string): string | null {
  const m = /^https?:\/\/(www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/?$/i.exec(String(u || '').split('?')[0]);
  return m ? m[2] : null;
}

export function buildActorInput(platform: ApifyPlatform, sources?: string, cap = readConfig()[platform].maxItems, rotate = 0): Record<string, unknown> {
  const raw = splitList(sources ?? readConfig()[platform].sources);
  if (platform === 'x') {
    // Timeline via advanced-search chunks — the plain twitterHandles path has
    // no per-item filters and (log-verified) a small run cap drains only the
    // FIRST account. Chunks spread OR-chains across the whole list and ROTATE
    // each run (`rotate` from apifyStart) so tight caps still cycle every
    // source over time. x.com profile URLs fold into the same queries;
    // anything else (lists, tweets) stays in startUrls.
    // Note: Twitter's current search backend ignores "-filter:retweets
    // -filter:replies" inside OR chains (verified against the run log —
    // replies/RTs still came back), so filtering at the source is NOT
    // reliable. mapX drops them deterministically instead: the dataset flags
    // (isReply, isRetweet, inReplyToUsername) proved exact in both test runs.
    const rawUrls = raw.filter(s => /^https?:/i.test(s));
    const plain = raw.filter(s => !/^https?:/i.test(s)).map(s => s.replace(/^@/, '').trim());
    const fromUrls = rawUrls.map(handleOfUrl).filter((h): h is string => !!h);
    const startUrls = rawUrls.filter(u => !handleOfUrl(u));
    const all = [...plain, ...fromUrls].filter(Boolean);
    if (!all.length && !startUrls.length) throw new Error('X needs at least one handle (@you) or profile URL on Sources.');
    const cs = Math.ceil(all.length / 5);          // actor caps batched queries at 5
    const nChunks = Math.max(1, Math.ceil(all.length / cs));
    const off = (Math.abs(Math.floor(rotate)) % nChunks) * cs;
    const rotated = off ? all.slice(off).concat(all.slice(0, off)) : all;
    const terms: string[] = [];
    for (let i = 0; i < rotated.length; i += cs)
      terms.push(rotated.slice(i, i + cs).map(h => 'from:' + h).join(' OR '));
    return {
      ...(terms.length ? { searchTerms: terms } : {}),
      ...(startUrls.length ? { startUrls } : {}),
      sort: 'Latest',
    };
  }
  // IG / TikTok / YouTube actors cap results PER PROFILE, not per run — so the
  // run budget (maxItems) is split across the listed profiles. Otherwise 10
  // profiles × 30 = 300 paid results when you asked for 30.
  const perProfile = Math.max(1, Math.floor(cap / Math.max(1, raw.length)));
  if (platform === 'instagram') {
    if (!raw.length) throw new Error('Instagram needs at least one @handle or profile URL on Sources.');
    return {
      directUrls: raw.map(s => /^https?:/i.test(s) ? s : `https://www.instagram.com/${s.replace(/^@/, '')}/`),
      resultsType: 'posts',
      resultsLimit: perProfile,
      onlyPostsNewerThan: '45 days',  // don't pay for posts the import window drops anyway
    };
  }
  if (platform === 'threads') {
    // futurizerush/meta-threads-scraper — "user" mode = each account's own
    // posts (max_posts is PER account, actor minimum 10). Lines that aren't a
    // handle or threads.com/net profile URL become keyword searches (top).
    const handle = (s: string) => {
      const m = /^https?:\/\/(?:www\.)?threads\.(?:net|com)\/@?([A-Za-z0-9._]+)/i.exec(s);
      return m ? m[1] : /^@?[A-Za-z0-9._]{1,30}$/.test(s) ? s.replace(/^@/, '') : null;
    };
    const usernames = raw.map(handle).filter((h): h is string => !!h);
    const keywords = raw.filter(s => !handle(s)).slice(0, 10);
    if (!usernames.length && !keywords.length) throw new Error('Threads needs at least one @handle, profile URL or keyword on Sources.');
    // the actor's floor is 10 posts per account, so a run takes a rotating
    // slice of cap/10 accounts (next run → next slice) instead of overshooting
    // the run budget; every listed account still gets collected over time.
    const slots = Math.max(1, Math.floor(cap / 10));
    const off = usernames.length > slots ? (Math.abs(Math.floor(rotate)) * slots) % usernames.length : 0;
    const users = usernames.length > slots ? usernames.slice(off).concat(usernames.slice(0, off)).slice(0, slots) : usernames;
    const per = Math.max(10, Math.floor(cap / Math.max(1, users.length || keywords.length)));
    return usernames.length
      ? { mode: 'user', usernames: users, max_posts: per }
      : { mode: 'search', keywords: keywords.slice(0, slots), max_posts: per, search_filter: 'top', start_date: '45 days' };
  }
  if (platform === 'tiktok') {
    // clockworks/tiktok-scraper — profiles by handle, no video downloads (cost)
    const profiles = raw.map(s => s.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '').replace(/^@/, '').replace(/[/?].*$/, '')).filter(Boolean);
    if (!profiles.length) throw new Error('TikTok needs at least one @handle on Sources.');
    return {
      profiles, resultsPerPage: perProfile, profileScrapeSections: ['videos'], profileSorting: 'latest',
      oldestPostDateUnified: '60 days',
      shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false, shouldDownloadSlideshowImages: false,
    };
  }
  if (platform === 'youtube') {
    // streamers/youtube-scraper — channel /videos (+ /shorts) tabs
    const urls = raw.map(s => /^https?:/i.test(s) ? s : `https://www.youtube.com/@${s.replace(/^@/, '')}`);
    if (!urls.length) throw new Error('YouTube needs at least one @channel or channel URL on Sources.');
    const half = Math.max(1, Math.ceil(perProfile / 2));
    return {
      startUrls: urls.map(url => ({ url })),
      maxResults: half, maxResultsShorts: half, maxResultStreams: 0,
      sortVideosBy: 'NEWEST',
    };
  }
  // apimaestro/linkedin-profile-posts: ONE profile per run. The URL (or slug)
  // goes into `username` — it accepts linkedin.com/in/… URLs; total_posts caps
  // how far automatic pagination digs back. With several profiles listed, each
  // run takes the NEXT one (`rotate` = past LinkedIn run count) so every
  // profile gets collected over time instead of always the first.
  const profiles = raw.filter(s => /^https?:/i.test(s) || s.includes('/in/'));
  if (!profiles.length) throw new Error('LinkedIn needs at least one profile URL (https://www.linkedin.com/in/…)');
  const one = profiles[Math.abs(Math.floor(rotate)) % profiles.length];
  return { username: one.replace(/\/+$/, ''), total_posts: Math.max(1, cap) };
}

/** Start an actor run through the user's own account. Records it in run history. */
export async function apifyStart(platform: ApifyPlatform, sourcesOverride?: string): Promise<ApifyRunRec> {
  const token = getApifyToken();
  if (!token) throw new Error('No Apify token connected — add one on the Sources page first.');
  // spend limit first — refuse before any actor starts when the budget is used up
  const s = await spendInfo();
  if (s.limit > 0 && s.spend != null && s.spend >= s.limit - 1e-9)
    throw new Error(`Spend limit reached: $${s.spend.toFixed(2)} used in the current usage cycle (${s.via === 'apify' ? "your Apify account's usage" : "tracked in Reticle's run history"}) vs your $${s.limit.toFixed(2)} limit — raise or clear it on the Sources page.`);
  const cfg = readConfig()[platform];
  const cap = Math.max(1, Math.min(cfg.maxItems, 400)); // cost guard — pay-per-result actors charge per item
  const rotate = readRuns().filter(r => r.platform === platform).length; // X chunks rotate between runs so tight caps still cover every source
  const input = buildActorInput(platform, sourcesOverride, cap, rotate);
  return startRun(token, platform, cfg.actor, { ...input, maxItems: cap });
}

/** Memory + timeout are RUN OPTIONS (query params), not actor input. 1 GB keeps
 *  compute cheap (the 4 GB default costs 4× per hour). */
async function startRun(token: string, platform: ApifyPlatform, actor: string, input: Record<string, unknown>, note?: string): Promise<ApifyRunRec> {
  const run = await areq<{ id: string; status: string }>(`/acts/${actor.replace(/\//g, '~')}/runs?memory=1024&timeout=300`, token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const rec: ApifyRunRec = {
    id: run.id, platform, actor, ts: Date.now(),
    status: run.status || 'RUNNING', items: null, imported: null, error: null, ...(note ? { note } : {}),
  };
  writeRuns([rec, ...readRuns()]);
  return rec;
}

// ---------------- X topic scan (search all of X for proven winners) ----------------
export async function apifyTopicScanX(label: string, query: string, minFaves = 150, maxItems = 150, days = 30): Promise<ApifyRunRec> {
  const token = getApifyToken();
  if (!token) throw new Error('No Apify token connected — add one on Settings first.');
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (q.length < 3) throw new Error('Enter a search query.');
  const n = Math.max(20, Math.min(400, Math.round(maxItems)));
  const s = await spendInfo();
  if (s.limit > 0 && s.spend != null && s.spend + n * X_DEEP_USD_PER_ITEM > s.limit + 1e-9)
    throw new Error(`Spend limit: $${s.spend.toFixed(2)} used of your $${s.limit.toFixed(2)} limit — this scan could add up to $${(n * X_DEEP_USD_PER_ITEM).toFixed(3)}. Raise the limit on Sources.`);
  const since = new Date(Date.now() - Math.max(3, Math.min(60, days)) * 864e5).toISOString().slice(0, 10);
  const fav = Math.max(0, Math.round(minFaves));
  return startRun(token, 'x', X_DEEP_ACTOR, {
    twitterContent: `${q}${fav ? ` min_faves:${fav}` : ''} -filter:replies -filter:nativeretweets since:${since}`,
    queryType: 'Top',
    maxItems: n,
  }, `topic scan: ${String(label || 'custom').slice(0, 40)}`);
}

// ---------------- X deep scan (one account at a time) ----------------
/** Pay-per-result X actor without the free-plan 10-tweet demo cap (~$0.25 / 1k tweets). */
export const X_DEEP_ACTOR = 'kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest';
export const X_DEEP_USD_PER_ITEM = 0.00025;

/** Pull one account's recent ORIGINAL posts (no replies/retweets) — enough history
 *  for outlier baselines and repost detection. Spend limit is checked first. */
export async function apifyDeepScanX(handle: string, perAccount = 50, days = 60): Promise<ApifyRunRec> {
  const token = getApifyToken();
  if (!token) throw new Error('No Apify token connected — add one on Settings first.');
  const h = String(handle || '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').replace(/[/?].*$/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) throw new Error(`"${handle}" is not a valid X handle`);
  const s = await spendInfo();
  const n = Math.max(5, Math.min(200, Math.round(perAccount)));
  if (s.limit > 0 && s.spend != null && s.spend + n * X_DEEP_USD_PER_ITEM > s.limit + 1e-9)
    throw new Error(`Spend limit: $${s.spend.toFixed(2)} used of your $${s.limit.toFixed(2)} limit — this scan could add up to $${(n * X_DEEP_USD_PER_ITEM).toFixed(3)}. Raise the limit on Sources.`);
  const since = new Date(Date.now() - Math.max(7, Math.min(120, days)) * 864e5).toISOString().slice(0, 10);
  return startRun(token, 'x', X_DEEP_ACTOR, {
    twitterContent: `from:${h} -filter:replies -filter:nativeretweets since:${since}`,
    queryType: 'Latest',
    maxItems: n,
  }, `deep scan @${h}`);
}

const TERMINAL_FAIL = new Set(['FAILED', 'ABORTED', 'ABORTING', 'TIMED-OUT']);

function xRunsThisMonth(): number {
  const mk = monthKey(Date.now());
  return readRuns().filter(r => r.platform === 'x' && r.actor !== X_DEEP_ACTOR && monthKey(r.ts) === mk).length; // the demo cap only applies to the default X actor
}

/** Poll a run; when it has SUCCEEDED and not yet been imported, pull its dataset and import the posts. */
export async function apifyPoll(runId: string): Promise<{ status: string; rec: ApifyRunRec | null }> {
  const token = getApifyToken();
  if (!token) throw new Error('Apify token missing — reconnect on the Sources page.');
  const runs = readRuns();
  const known = runs.find(r => r.id === runId);
  if (!known) throw new Error('Unknown Apify run id');

  const run = await areq<{ id: string; status: string; defaultDatasetId: string }>(`/actor-runs/${runId}`, token);
  patchRun(runId, { status: run.status });
  if (TERMINAL_FAIL.has(run.status)) patchRun(runId, { error: known.error || `run ${run.status}` }); // keep a spend-limit note if one was set

  // record the actual cost once terminal — but only trust POSITIVE numbers:
  // free-plan pay-per-event runs can report usageTotalUsd 0 while the events
  // settle on Apify's side, so keep re-patching if a real figure shows up later.
  if (run.status === 'SUCCEEDED' || TERMINAL_FAIL.has(run.status)) {
    const c = numish((run as any).usageTotalUsd);
    if (c != null && c > 0 && known.costUsd !== c) patchRun(runId, { costUsd: Math.round(c * 1e4) / 1e4 });
  }

  // spend limit that bites mid-run: abort a still-running collector the moment usage crosses the line
  if (run.status !== 'SUCCEEDED' && !TERMINAL_FAIL.has(run.status)) {
    const s = await spendInfo();
    if (s.limit > 0 && s.spend != null && s.spend >= s.limit - 1e-9) {
      try { await areq(`/actor-runs/${runId}/abort`, token, { method: 'POST' }); } catch { /* abort retried at next poll */ }
      patchRun(runId, { error: `aborted — spend limit reached ($${s.spend.toFixed(2)} of $${s.limit.toFixed(2)} in this usage cycle)` });
    }
  }

  // Import once per run — except when a previous import recorded all-zero
  // counts with an unknown item total. That combination is the fingerprint of
  // the old dataset-reading bug (areq unwrapped the bare array into undefined),
  // so re-import: importItems is idempotent (hasPost → refresh, no dupes).
  const allZero = !!known.imported && known.imported.added + known.imported.updated + known.imported.skipped === 0;
  const poisoned = allZero && known.items == null;
  if (run.status === 'SUCCEEDED' && (!known.imported || poisoned)) {
    // /datasets/:id/items returns a BARE JSON array — areq's { data } unwrap
    // would turn it into undefined, which is exactly how "0 new · 0 refreshed"
    // happened while real items sat in Apify. Fetch it raw.
    const res = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?limit=1000&token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(45000) });
    const raw: unknown = await res.json().catch(() => null);
    const items = Array.isArray(raw) ? raw : [];
    const result = importItems(known.platform, items);
    const empty = result.added + result.updated + result.skipped === 0;
    let note: string | undefined;
    const mock = items.length > 0 && items.every((i: any) => i?.type === 'mock_tweet' || i?.noResults);
    if (mock) {
      note = `${/^(deep|topic) scan/.test(known.note || '') ? known.note + ': ' : ''}no posts found — the actor returned placeholder rows (its minimum charge). Check the handle spelling, or the account posted nothing original in the window.`;
    } else if (empty) {
      note = known.platform === 'x' && xRunsThisMonth() >= 5
        ? '0 items — the X free-plan demo allowance (5 runs/month per actor) looks used up; upgrade on Apify or wait for the monthly reset.'
        : known.platform === 'linkedin'
          ? '0 posts returned — LinkedIn throttles scrapes sometimes; re-run, or check that the first profile URL has recent posts.'
          : '0 items returned — check the source list above, then re-run.';
    } else if (result.added + result.updated === 0 && result.skipped > 0) {
      note = `${result.skipped} item${result.skipped === 1 ? '' : 's'} dropped — retweets/replies or older than the collection window.`;
    } else if (/^(deep|topic) scan/.test(known.note || '')) {
      note = known.note; // keep the account label on deep-scan runs
    }
    patchRun(runId, { items: items.length, imported: result, error: null, ...(note ? { note } : {}) });
  }
  return { status: run.status, rec: readRuns().find(r => r.id === runId) || null };
}

/** Poll every run that is still active — or stuck — so collectors finish
 *  importing even when the Sources page was closed mid-run. Bounded per call;
 *  anything left over is picked up on the next status read. */
export async function pollActiveRuns(): Promise<void> {
  const stuck = readRuns().filter(r =>
    ['READY', 'RUNNING', 'QUEUED'].includes(r.status) ||
    // terminal but never imported (process died mid-import), or imported with
    // all-zero counts and an unknown item total — the old bare-array bug's
    // fingerprint; importItems is idempotent so re-importing is always safe
    (r.status === 'SUCCEEDED' && (!r.imported || (r.imported.added + r.imported.updated + r.imported.skipped === 0 && r.items == null)))
  ).slice(0, 4);
  for (const r of stuck) {
    try { await apifyPoll(r.id); } catch { /* transient — retried on the next status read */ }
  }
}

// ---------------- mapping actor output → posts table ----------------
// Lives in lib/normalize.ts (one clean schema for all five platforms).
export { importItems, twitterDate } from './normalize';

/** Re-read the datasets of past SUCCEEDED runs through the current normalizer.
 *  Reading a dataset costs nothing extra (only running actors does); Apify
 *  keeps datasets ~7 days on the free plan, older ones simply report "expired". */
export async function reimportRuns(): Promise<{ runs: number; added: number; updated: number; skipped: number; expired: number }> {
  const token = getApifyToken();
  if (!token) throw new Error('No Apify token connected.');
  const tot = { runs: 0, added: 0, updated: 0, skipped: 0, expired: 0 };
  for (const r of readRuns().filter(x => x.status === 'SUCCEEDED').slice(0, 60)) {
    try {
      const run = await areq<{ defaultDatasetId: string }>(`/actor-runs/${r.id}`, token);
      const res = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?limit=1000&token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) { tot.expired++; continue; }
      const raw: unknown = await res.json().catch(() => null);
      const c = importItems(r.platform, Array.isArray(raw) ? raw : []);
      tot.runs++; tot.added += c.added; tot.updated += c.updated; tot.skipped += c.skipped;
    } catch { tot.expired++; }
  }
  return tot;
}

// ---------------- actor pricing (public Apify API, cached 6h) ----------------
export type ActorPrice = { perResult: number | null; model: string; startFee: number | null };
const priceCache = new Map<string, { at: number; p: ActorPrice }>();
/** Per-result price on the FREE plan tier, read from the actor's public pricing. */
export async function actorPricing(actor: string): Promise<ActorPrice> {
  const hit = priceCache.get(actor);
  if (hit && Date.now() - hit.at < 6 * 36e5) return hit.p;
  let p: ActorPrice = { perResult: null, model: 'unknown', startFee: null };
  try {
    const r = await fetch(`${API}/acts/${actor.replace(/\//g, '~')}`, { signal: AbortSignal.timeout(8000) });
    const d: any = (await r.json())?.data || {};
    const info = (d.pricingInfos || []).slice(-1)[0] || {};
    const price = (e: any) => numish(e?.eventTieredPricingUsd?.FREE?.tieredEventPriceUsd ?? e?.eventPriceUsd);
    const ev = info.pricingPerEvent?.actorChargeEvents || {};
    const per = ev['apify-default-dataset-item'] || ev['result'] || ev['results'] || Object.entries(ev).find(([k]) => !/start|filter|ai-|transcrib|follower/i.test(k))?.[1];
    p = {
      model: String(info.pricingModel || 'unknown'),
      perResult: info.pricingModel === 'PAY_PER_EVENT' ? price(per) : info.pricingModel === 'PRICE_PER_DATASET_ITEM' ? numish(info.pricePerUnitUsd) : null,
      startFee: price(ev['apify-actor-start']),
    };
  } catch { /* offline — no estimate */ }
  priceCache.set(actor, { at: Date.now(), p });
  return p;
}
