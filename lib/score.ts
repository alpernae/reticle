// lib/score.ts — the pattern-fit score: our explicit criterion for "will this
// draft attract people?" BEFORE it's posted.
//
// A draft is fingerprinted exactly like collected posts (hook type, length,
// hashtag count, link, emoji) and each trait is looked up in the pattern
// library for that platform: how did posts with that trait perform vs the
// platform's median outlier score? Lifts from small samples are shrunk toward
// 1 (n=30 counts fully, n=5 counts 1/6), then combined with a geometric mean.
//
//   fit 1.00× = neutral — traits with no evidence either way
//   fit > 1   = built from traits that over-performed in YOUR collected data
//   fit < 1   = uses traits that under-performed
//
// It measures structure, not topic quality or truth — and it's only as good as
// the data behind it (shown as n). The real verdict is the numbers you log on
// Winners after posting.
import 'server-only';
import { HOOK_LABEL, hookType, patternLibrary, type Analyzed, type PatternRow } from './patterns';

export type FitFactor = { trait: string; value: string; lift: number; n: number; weight: number };
export type Fit = { score: number; basis: string; factors: FitFactor[]; evidence: number };

const EMOJI = /\p{Extended_Pictographic}/gu;

function fingerprint(text: string): Record<string, string> {
  const body = text.trim();
  const first = body.split('\n').map(s => s.trim()).find(Boolean) || '';
  const words = body.split(/\s+/).filter(Boolean).length;
  const tags = (body.match(/#[\p{L}\p{N}_]{2,}/gu) || []).length;
  const emoji = (body.match(EMOJI) || []).length;
  return {
    hook: HOOK_LABEL[hookType(first)],
    length: words < 40 ? 'short' : words < 150 ? 'medium' : 'long',
    hashtags: tags === 0 ? 'no hashtags' : tags > 3 ? '4+ hashtags' : '1–3 hashtags',
    'link in post': /https?:\/\//.test(body) ? 'has link' : 'no link',
    emoji: emoji === 0 ? 'no emoji' : emoji <= 3 ? '1–3 emoji' : '4+ emoji',
  };
}

/** Build a scorer for one platform (falls back to all platforms pooled when thin). */
export function fitScorer(rows: Analyzed[], platform: string): (text: string) => Fit {
  const mine = rows.filter(r => r.source === platform);
  const pooled = mine.length < 20;
  const lib: PatternRow[] = pooled
    ? patternLibrary(rows.map(r => ({ ...r, source: 'all' })))
    : patternLibrary(mine);
  const basis = pooled ? `all platforms (${rows.length} posts — ${platform} has ${mine.length})` : `${platform} (${mine.length} posts)`;
  const idx = new Map(lib.map(p => [p.trait + '|' + p.value, p]));
  return (text: string) => {
    const fp = fingerprint(text);
    const factors: FitFactor[] = [];
    for (const [trait, value] of Object.entries(fp)) {
      const p = idx.get(trait + '|' + value);
      if (!p) continue;
      const weight = Math.min(1, p.n / 30);
      factors.push({ trait, value, lift: p.lift, n: p.n, weight: Math.round(weight * 100) / 100 });
    }
    const logSum = factors.reduce((s, f) => s + Math.log(1 + (f.lift - 1) * f.weight), 0);
    const score = factors.length ? Math.exp(logSum / factors.length) : 1;
    return { score: Math.round(score * 100) / 100, basis, factors, evidence: factors.reduce((s, f) => s + f.n, 0) };
  };
}
