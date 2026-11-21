// lib/derive-post.ts — write the derived facts of ONE post (ADR-004).
//
// The read model has two halves:
//
//   • the per-post facts (engagement, hook, length, emoji) — cheap, and
//     written the moment a post is imported;
//   • the outlier — how far the post beat its creator's normal — which needs
//     the yardsticks, so it is measured against the stored baselines and
//     refined by the rebuild task a couple of seconds later.
//
// This module lives in the infrastructure layer (not lib/application/) because
// the import path (lib/normalize.ts) must not depend on the application layer.
import 'server-only';
import { getStore } from './db';
import { derive, outlierOf, type Baselines } from './domain/patterns';
import type { Post } from './domain/post';

/** The stored yardsticks, in the shape the domain expects. */
export function storedBaselines(): Baselines {
  const store = getStore();
  const b: Baselines = {
    authorMed: new Map(), authorN: new Map(),
    platMed: new Map(), platN: new Map(), pfMed: new Map(),
  };
  for (const r of store.readAuthorBaselines()) {
    const key = r.source + '|' + r.author.toLowerCase();
    b.authorMed.set(key, r.medianEng);
    b.authorN.set(key, r.n);
  }
  for (const r of store.readPlatformBaselines()) {
    b.platMed.set(r.source, r.medianEng);
    b.platN.set(r.source, r.n);
    if (r.medianPerFollower > 0) b.pfMed.set(r.source, r.medianPerFollower);
  }
  return b;
}

/**
 * Write one post's derived facts.
 *
 * The outlier is only written when a yardstick exists — before the first
 * rebuild there is none, and a made-up one would call every post a winner.
 * The rebuild fills it in a moment later.
 */
export function derivePost(p: Post, baselines?: Baselines) {
  const store = getStore();
  const d = derive(p);
  const b = baselines ?? storedBaselines();
  const key = p.author ? p.source + '|' + p.author.toLowerCase() : '';
  const hasYardstick = (!!key && (b.authorN.get(key) ?? 0) >= 3) || b.platMed.has(p.source);
  let outlier: number | null = null;
  let baseline: string | null = null;
  if (hasYardstick) {
    const o = outlierOf({ ...p, eng: d.eng }, b);
    outlier = Math.round(o.outlier * 100) / 100;
    baseline = o.baseline;
  }
  store.setPostDerived(p.id, {
    eng: d.eng, hook: d.hook, hookLine: d.hookLine, words: d.words, lengthBucket: d.lengthBucket,
    hasLink: d.hasLink ? 1 : 0, emojiCount: d.emojiCount,
    outlier, baseline, analyzedAt: Date.now(),
  });
  return { ...d, outlier, baseline };
}
