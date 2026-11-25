// lib/domain/viral.ts — what makes a post "viral" here, and the structural
// recipe a generated post can imitate.
//
// Two ideas, both pure (no I/O, no imports outside the domain):
//
//   1. VIRALITY. A post is viral relative to something: its own author's
//      usual engagement, the platform's median, or the audience's usual rate.
//      That ratio is already materialized as `outlier` (eng / median). On top
//      of it sits a gentle recency weight, because a three-week-old hit
//      teaches more than a two-year-old one — but an old hit still teaches,
//      so the weight never reaches zero.
//
//   2. STRUCTURE. What the post *did*, stripped of its content: the hook,
//      the length, the format, the cadence, the call to action. That is the
//      only thing "make one like this" copies. The words never get copied.
import type { Analyzed, HookType } from './patterns';
import { HOOK_LABEL } from './patterns';
import { hourInTz, weekdayInTz, systemTimezone } from './timezone';

/** A post that is at least this many times its own baseline is "viral". */
export const VIRAL_LIFT = 3;
/** This many times its baseline is a "breakout" — clearly above normal. */
export const BREAKOUT_LIFT = 2;
/** Days after which a hit keeps half of its recency weight. */
export const HALF_LIFE_DAYS = 45;
/** The recency weight never falls below this share of a fresh post. */
export const RECENCY_FLOOR = 0.55;

export type ViralVerdict = 'viral' | 'breakout' | 'normal' | 'under';

export type ViralFormat = 'text' | 'image' | 'video' | 'thread' | 'link';

export type OpeningShape =
  | 'question'
  | 'number'
  | 'contrarian'
  | 'story'
  | 'how-to'
  | 'result'
  | 'announcement'
  | 'news'
  | 'ask'
  | 'tip'
  | 'claim';

export type CtaKind = 'none' | 'question' | 'follow' | 'comment' | 'link' | 'share';

/** The recipe of a post: everything except the words. */
export type StructureSignature = {
  platform: string;
  hook: HookType;
  hookLabel: string;
  opening: OpeningShape;
  words: number;
  lengthBucket: 'short' | 'medium' | 'long';
  lines: number;
  sentences: number;
  format: ViralFormat;
  durationSec: number | null;
  hashtagCount: number;
  emojiCount: number;
  hasLink: boolean;
  cta: CtaKind;
  topics: string[];
  /** "Tue 09:00" in the reader's own zone. */
  slot: string;
  /** 0 = Sunday … 6 = Saturday, in the reader's own zone. */
  weekday: number;
  /** 0–23 in the reader's own zone. */
  hour: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Big lifts read better as whole numbers: "325×", not "325.27×". */
export const fmtLift = (n: number) => {
  const v = Math.max(0, Number(n) || 0);
  return v >= 10 ? String(Math.round(v)) : String(round2(v));
};

/** How the opening line opens, from the hook the analyzer already found. */
const OPENING: Record<HookType, OpeningShape> = {
  question: 'question',
  listicle: 'number',
  contrarian: 'contrarian',
  story: 'story',
  'how-to': 'how-to',
  proof: 'result',
  launch: 'announcement',
  news: 'news',
  'engagement-ask': 'ask',
  'tool-tip': 'tip',
  statement: 'claim',
};

/** How a post ends — the ask, if there is one. */
export function ctaOf(body: string): CtaKind {
  const text = String(body || '').trim();
  if (!text) return 'none';
  const tail = text.slice(-280).toLowerCase();
  if (/\b(follow me|follow for|hit follow|follow @|follow us)\b/.test(tail)) return 'follow';
  if (/\b(comment|reply|thoughts|drop a|let me know|tell me)\b/.test(tail)) return 'comment';
  if (/\b(repost|rt this|share this|share it|spread the word)\b/.test(tail)) return 'share';
  if (/https?:\/\//.test(tail)) return 'link';
  if (/\?\s*$/.test(tail) || /\?\s*\n*\s*$/.test(text)) return 'question';
  return 'none';
}

/** The post's format, from the media, the duration and the shape of the body. */
export function formatOf(p: {
  media?: string | null;
  durationSec?: number | null;
  hasLink?: boolean;
  body?: string | null;
}): ViralFormat {
  const media = String(p.media || '').toLowerCase();
  if (p.durationSec && p.durationSec > 0) return 'video';
  if (media.includes('video') || media.includes('reel')) return 'video';
  if (media.includes('image') || media.includes('photo') || media.includes('carousel')) return 'image';
  const body = String(p.body || '');
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 4 && /^\s*(\d+[.)]|[-*•])/m.test(body)) return 'thread';
  if (p.hasLink) return 'link';
  return 'text';
}

/**
 * The recency weight of a post: 1 for a post from now, falling by half every
 * `halfLifeDays` days, never below the floor share of a fresh post.
 */
export function recencyWeight(
  created: number,
  now: number,
  halfLifeDays = HALF_LIFE_DAYS,
): number {
  if (!created || !now) return RECENCY_FLOOR;
  const ageDays = Math.max(0, (now - created) / 86_400_000);
  const decayed = Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decayed;
}

/**
 * The viral score of a post: its lift over its baseline, weighted by how
 * recent it is. Comparable across platforms — a 3× on X and a 3× on TikTok
 * are the same size of win, whatever the absolute numbers are.
 */
export function viralScore(
  p: { outlier: number; created: number },
  now: number,
  opts?: { halfLifeDays?: number },
): number {
  const lift = Math.max(0, p.outlier || 0);
  const weight = recencyWeight(p.created, now, opts?.halfLifeDays);
  return round2(lift * weight);
}

/** Which band a lift falls into. */
export function verdictOf(outlier: number): ViralVerdict {
  const lift = Number(outlier) || 0;
  if (lift >= VIRAL_LIFT) return 'viral';
  if (lift >= BREAKOUT_LIFT) return 'breakout';
  if (lift >= 1) return 'normal';
  return 'under';
}

/** The plain-language name of the yardstick a post was measured against. */
export function baselineWord(baseline: string): string {
  if (baseline === 'author') return 'own';
  if (baseline === 'audience') return "audience's";
  return 'platform';
}

/** The recipe of a post — the part a generated post may imitate. */
export function structureSignature(
  p: Analyzed,
  opts?: { tz?: string },
): StructureSignature {
  const tz = opts?.tz || systemTimezone();
  const body = String(p.body || p.text || p.title || '');
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sentences = body.split(/[.!?]+(?:\s|$)/).map(s => s.trim()).filter(Boolean).length;
  const hour = hourInTz(p.created, tz);
  const weekday = weekdayInTz(p.created, tz);
  return {
    platform: p.source,
    hook: p.hook,
    hookLabel: HOOK_LABEL[p.hook] || 'Hook',
    opening: OPENING[p.hook] || 'claim',
    words: p.words || 0,
    lengthBucket: p.lengthBucket || 'short',
    lines: lines.length,
    sentences,
    format: formatOf(p),
    durationSec: p.durationSec ?? null,
    hashtagCount: (p.hashtags || []).length,
    emojiCount: p.emojiCount || 0,
    hasLink: !!p.hasLink,
    cta: ctaOf(body),
    topics: p.topics || [],
    slot: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday]} ${String(hour).padStart(2, '0')}:00`,
    weekday,
    hour,
  };
}

/** The recipe as sentences — what the generator is told to imitate. */
export function describeStructure(sig: StructureSignature): string[] {
  const out: string[] = [];
  out.push(`Open with a ${sig.opening} (${sig.hookLabel.toLowerCase()})`);
  const len = sig.lengthBucket === 'short' ? 'short' : sig.lengthBucket === 'medium' ? 'medium-length' : 'long';
  out.push(`${len} — about ${sig.words} words in ${sig.lines} line${sig.lines === 1 ? '' : 's'}`);
  if (sig.format === 'video') {
    out.push(sig.durationSec ? `Video, about ${Math.round(sig.durationSec)}s` : 'Video');
  } else if (sig.format === 'image') {
    out.push('Image post');
  } else if (sig.format === 'thread') {
    out.push('Numbered thread');
  } else if (sig.format === 'link') {
    out.push('Text post with a link');
  } else {
    out.push('Plain text post');
  }
  if (sig.hashtagCount > 0) out.push(`${sig.hashtagCount} hashtag${sig.hashtagCount === 1 ? '' : 's'}`);
  if (sig.emojiCount > 0) out.push(`${sig.emojiCount} emoji${sig.emojiCount === 1 ? '' : 's'}`);
  if (sig.hasLink && sig.format !== 'link') out.push('Link in the post');
  if (sig.cta !== 'none') {
    const ctaText: Record<CtaKind, string> = {
      none: '',
      question: 'Ends with a question',
      follow: 'Ends with a follow ask',
      comment: 'Ends with a comment ask',
      link: 'Ends with a link',
      share: 'Ends with a share ask',
    };
    out.push(ctaText[sig.cta]);
  }
  out.push(`Posted ${sig.slot}`);
  return out;
}

export type ViralReasonContext = {
  now: number;
  tz?: string;
  /** Lift for a trait/value pair ("length" / "short") from the pattern library. */
  traitLift?: (trait: string, value: string) => number | undefined;
  /** Lift for a posting slot, from the best-time analysis (day + hour). */
  slotLift?: (hour: number, weekday: number) => number | undefined;
};

/**
 * Why a post ranked where it did, in plain words. The lift and the shape
 * are always known; the corpus-specific lifts (this length usually wins,
 * this hour usually wins) are passed in when they are available.
 */
export function viralReasons(p: Analyzed, ctx: ViralReasonContext): string[] {
  const tz = ctx.tz || systemTimezone();
  const sig = structureSignature(p, { tz });
  const out: string[] = [];

  const lift = fmtLift(p.outlier || 0);
  const base = baselineWord(p.baseline);
  out.push(`${lift}× your ${base} usual engagement`);

  out.push(`${sig.hookLabel} hook`);

  const lengthLift = ctx.traitLift?.('length', sig.lengthBucket);
  if (lengthLift && lengthLift >= 1.1) {
    out.push(`${sig.lengthBucket} length wins ${round2(lengthLift)}× here`);
  }

  const slotLift = ctx.slotLift?.(sig.hour, sig.weekday);
  if (slotLift && slotLift >= 1.1) {
    out.push(`${sig.slot} — a slot that wins ${round2(slotLift)}× for you`);
  }

  const mix: string[] = [];
  if (p.comments) mix.push(`${p.comments} comment${p.comments === 1 ? '' : 's'}`);
  if (p.shares) mix.push(`${p.shares} share${p.shares === 1 ? '' : 's'}`);
  if (p.saves) mix.push(`${p.saves} save${p.saves === 1 ? '' : 's'}`);
  if (mix.length) out.push(`${mix.join(', ')} — the conversation drove it`);

  const days = Math.floor(Math.max(0, ctx.now - p.created) / 86_400_000);
  if (days === 0) out.push('posted today');
  else if (days === 1) out.push('posted yesterday');
  else if (days < 14) out.push(`posted ${days} days ago`);
  else if (days < 90) {
    const weeks = Math.floor(days / 7);
    out.push(`posted ${weeks} week${weeks === 1 ? '' : 's'} ago`);
  } else {
    const months = Math.floor(days / 30);
    out.push(`posted ${months} month${months === 1 ? '' : 's'} ago`);
  }

  return out;
}

/** One-line summary used on cards. */
export function viralHeadline(p: Analyzed, now: number): string {
  const verdict = verdictOf(p.outlier);
  const lift = fmtLift(p.outlier || 0);
  if (verdict === 'viral') return `${lift}× viral`;
  if (verdict === 'breakout') return `${lift}× breakout`;
  return `${lift}×`;
}
