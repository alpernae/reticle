// lib/application/viral.ts — the viral finder: the corpus ranked by how far
// each post beat its own yardstick, with the reason and the recipe attached.
//
// The ranking is relative on purpose. A 40-like post is nothing on X and
// everything on Threads, so "viral" here means "many times more than this
// author (or this platform) normally gets" — the same yardstick the rest of
// the app already uses. On top of that sits a gentle recency weight.
//
// The recipe is the other half: what the post did, not what it said. That is
// what "make one like this" hands to the generator — the structure, never
// the words.
import 'server-only';
import { getStore } from '../db';
import { currentSnapshot } from '../analytics-read';
import { readTimezone } from '../timezone-store';
import { bestTimes } from '../besttime';
import { hourInTz, weekdayInTz } from '../domain/timezone';
import { HOOK_LABEL, type Analyzed, type HookType } from '../domain/patterns';
import {
  describeStructure,
  structureSignature,
  verdictOf,
  viralHeadline,
  viralReasons,
  viralScore,
  type StructureSignature,
  type ViralVerdict,
} from '../domain/viral';

export type ViralCard = {
  id: string;
  source: string;
  title: string;
  body: string;
  link: string;
  author: string | null;
  authorFollowers: number | null;
  created: number;
  ageDays: number;
  likes: number;
  comments: number;
  shares: number | null;
  saves: number | null;
  views: number | null;
  eng: number;
  /** How many times the post beat its baseline. */
  outlier: number;
  baseline: 'author' | 'audience' | 'platform';
  /** The recency-weighted rank score. */
  viralScore: number;
  verdict: ViralVerdict;
  headline: string;
  hook: HookType;
  hookLabel: string;
  words: number;
  lengthBucket: string;
  media: string | null;
  hashtags: string[];
  topics: string[];
  durationSec: number | null;
  /** Why it ranked here, in plain words. */
  reasons: string[];
  /** The structural recipe. */
  signature: StructureSignature;
  recipe: string[];
};

export type ViralPage = {
  posts: ViralCard[];
  next: string | null;
  /** How many posts match the filters. */
  total: number;
  bySource: Record<string, number>;
  sources: string[];
  filters: { platform: string; days: number; minLift: number };
  corpus: { posts: number; analyzed: number };
  /** How many matches fall into each band. */
  verdicts: { viral: number; breakout: number; normal: number; under: number };
  /** The best score in this view. */
  top: number;
  generatedAt: number;
};

export type ViralBrief = {
  card: ViralCard;
  /** The prompt-ready brief: the recipe and the reasons, never the original words. */
  brief: string;
  source: { id: string; title: string; link: string; author: string | null };
};

type CandidateRow = ReturnType<ReturnType<typeof getStore>['viralCandidateRows']>[number];

const DAY = 86_400_000;

const parseArray = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/** The candidate row as the domain's Analyzed shape. */
function toAnalyzed(r: CandidateRow, tz: string): Analyzed {
  const eng = Number(r.eng) || 0;
  const views = r.views ?? null;
  const followers = r.authorFollowers ?? null;
  const er = views ? eng / views : followers ? eng / followers : null;
  return {
    id: r.id,
    source: r.source,
    title: r.title || '',
    text: r.text || '',
    url: r.link || '',
    link: r.link || '',
    score: r.score || 0,
    comments: r.comments || 0,
    created: r.created,
    views: views ?? undefined,
    author: r.author ?? undefined,
    authorFollowers: followers ?? undefined,
    shares: r.shares ?? undefined,
    saves: r.saves ?? undefined,
    media: r.media ?? undefined,
    hashtags: parseArray(r.hashtags),
    body: r.body ?? undefined,
    durationSec: r.durationSec ?? undefined,
    topics: parseArray(r.topics),
    eng,
    er,
    outlier: Number(r.outlier) || 0,
    baseline: (r.baseline as Analyzed['baseline']) || 'platform',
    hook: (r.hook as HookType) || 'statement',
    hookLine: r.hookLine || '',
    words: r.words || 0,
    lengthBucket: (r.lengthBucket as Analyzed['lengthBucket']) || 'short',
    hasLink: !!r.hasLink,
    emojiCount: r.emojiCount || 0,
    hour: hourInTz(r.created, tz),
    weekday: weekdayInTz(r.created, tz),
    niche: false,
  };
}

/** The platforms the corpus holds. */
export function viralSources(): string[] {
  return Object.keys(getStore().sourceCounts()).sort();
}

/** Lift for a trait/value pair, from the pattern library in the snapshot. */
function traitLifts(platform: string): (trait: string, value: string) => number | undefined {
  const snap = currentSnapshot();
  const rows = snap?.payload?.patternRows || [];
  if (!rows.length) return () => undefined;

  const map = new Map<string, { lift: number; n: number }>();
  for (const row of rows) {
    if (platform && platform !== 'all' && row.platform !== platform) continue;
    const key = `${row.trait}|${row.value}`;
    const prev = map.get(key);
    if (!prev) { map.set(key, { lift: row.lift, n: row.n }); continue; }
    // several platforms: average the lift, weighted by how many posts stand behind it
    const n = prev.n + row.n;
    map.set(key, { lift: (prev.lift * prev.n + row.lift * row.n) / Math.max(1, n), n });
  }
  return (trait, value) => map.get(`${trait}|${value}`)?.lift;
}

/** Lift for a posting slot, from the best-time analysis of the corpus. */
function slotLifts(platform: string, tz: string): (hour: number, weekday: number) => number | undefined {
  const points = getStore().outlierRows().map(r => ({ s: r.source, t: r.created, o: r.outlier }));
  const best = bestTimes(points, tz, platform && platform !== 'all' ? platform : undefined);
  if (!best.enough) return () => undefined;
  return (hour, weekday) => {
    const cell = best.grid[weekday]?.[Math.floor(hour / 3)];
    return cell && cell.n >= 3 && cell.lift > 0 ? cell.lift : undefined;
  };
}

function cardOf(r: CandidateRow, ctx: { now: number; tz: string; traitLift: (t: string, v: string) => number | undefined; slotLift: (h: number, w: number) => number | undefined }): ViralCard {
  const a = toAnalyzed(r, ctx.tz);
  const signature = structureSignature(a, { tz: ctx.tz });
  const reasons = viralReasons(a, {
    now: ctx.now,
    tz: ctx.tz,
    traitLift: ctx.traitLift,
    slotLift: ctx.slotLift,
  });
  return {
    id: a.id,
    source: a.source,
    title: a.title,
    body: String(a.body || a.text || '').slice(0, 1200),
    link: a.link,
    author: a.author ?? null,
    authorFollowers: a.authorFollowers ?? null,
    created: a.created,
    ageDays: Math.floor(Math.max(0, ctx.now - a.created) / DAY),
    likes: a.score,
    comments: a.comments,
    shares: a.shares ?? null,
    saves: a.saves ?? null,
    views: a.views ?? null,
    eng: a.eng,
    outlier: a.outlier,
    baseline: a.baseline,
    viralScore: viralScore(a, ctx.now),
    verdict: verdictOf(a.outlier),
    headline: viralHeadline(a, ctx.now),
    hook: a.hook,
    hookLabel: HOOK_LABEL[a.hook] || 'Hook',
    words: a.words,
    lengthBucket: a.lengthBucket,
    media: a.media ?? null,
    hashtags: a.hashtags || [],
    topics: a.topics || [],
    durationSec: a.durationSec ?? null,
    reasons,
    signature,
    recipe: describeStructure(signature),
  };
}

/** "x,threads" → ["x","threads"]; "all" / empty → every platform. */
function parseSources(platform?: string): string[] | undefined {
  const raw = String(platform || '').trim();
  if (!raw || raw === 'all') return undefined;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

type Cursor = { s: number; e: number; i: string };

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
const decodeCursor = (raw?: string | null): Cursor | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof v?.s !== 'number' || typeof v?.i !== 'string') return null;
    return { s: v.s, e: Number(v.e) || 0, i: v.i };
  } catch {
    return null;
  }
};

/**
 * The viral finder: the corpus ranked by lift over its own yardstick, with
 * recency folded in. Filters: platforms, age in days, minimum lift.
 */
export function listViral(opts: {
  platform?: string;
  days?: number;
  minLift?: number;
  cursor?: string | null;
  limit?: number;
  now?: number;
} = {}): ViralPage {
  const now = opts.now ?? Date.now();
  const tz = readTimezone();
  const platform = String(opts.platform || 'all');
  const days = Math.max(1, Math.min(365, Math.round(opts.days ?? 60)));
  const minLift = Math.max(0.5, Math.min(20, Number(opts.minLift ?? 1.5)));
  const limit = Math.max(1, Math.min(50, Math.round(opts.limit ?? 20)));
  const sources = parseSources(platform);
  const since = now - days * DAY;

  const rows = getStore().viralCandidateRows({ sources, since, minLift, limit: 1000 });
  const ctx = {
    now,
    tz,
    traitLift: traitLifts(platform),
    slotLift: slotLifts(platform, tz),
  };

  const ranked = rows
    .map(r => ({ row: r, card: cardOf(r, ctx) }))
    .sort((a, b) =>
      b.card.viralScore - a.card.viralScore ||
      b.card.eng - a.card.eng ||
      (a.card.id < b.card.id ? 1 : a.card.id > b.card.id ? -1 : 0),
    );

  const cursor = decodeCursor(opts.cursor);
  const after = cursor
    ? ranked.filter(x =>
        x.card.viralScore < cursor.s ||
        (x.card.viralScore === cursor.s && (x.card.eng < cursor.e || (x.card.eng === cursor.e && x.card.id < cursor.i))),
      )
    : ranked;

  const page = after.slice(0, limit);
  const last = page[page.length - 1];
  const next = after.length > limit && last
    ? encodeCursor({ s: last.card.viralScore, e: last.card.eng, i: last.card.id })
    : null;

  const bySource: Record<string, number> = {};
  for (const x of ranked) bySource[x.card.source] = (bySource[x.card.source] || 0) + 1;

  const verdicts = { viral: 0, breakout: 0, normal: 0, under: 0 };
  for (const x of ranked) verdicts[x.card.verdict]++;

  return {
    posts: page.map(x => x.card),
    next,
    total: ranked.length,
    bySource,
    sources: viralSources(),
    filters: { platform, days, minLift },
    corpus: { posts: getStore().count(), analyzed: rows.length },
    verdicts,
    top: ranked.length ? ranked[0].card.viralScore : 0,
    generatedAt: now,
  };
}

/**
 * The brief for one viral post: what it did and why it worked, ready to be
 * pasted into a prompt. The original wording is deliberately left out.
 */
export function viralBrief(postId: string, opts: { now?: number } = {}): ViralBrief | null {
  const row = getStore().viralSourcePost(postId);
  if (!row) return null;
  const now = opts.now ?? Date.now();
  const tz = readTimezone();
  const card = cardOf(row, {
    now,
    tz,
    traitLift: traitLifts('all'),
    slotLift: slotLifts('all', tz),
  });
  const worked = card.verdict === 'viral' || card.verdict === 'breakout';
  const lines = [
    `A post on ${card.source}${worked ? ` that worked (${card.headline})` : ` (${card.headline} its baseline)`}. Imitate its STRUCTURE, not its words.`,
    `Why it worked: ${card.reasons.join('; ')}.`,
    'The recipe:',
    ...card.recipe.map(r => `- ${r}`),
    'Write a NEW post on the same structure — your own topic, your own words, your own voice. Do not repeat the original wording.',
  ];
  return {
    card,
    brief: lines.join('\n'),
    source: { id: card.id, title: card.title, link: card.link, author: card.author },
  };
}
