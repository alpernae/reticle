// lib/recycle.ts — finds posts that keep coming back.
//
// Many creators re-post the SAME text (or the same template with one word
// swapped) every few days/weeks — "Drop your SaaS 👇 I'll check them out",
// "What are you building this weekend?", the same hot take on loop — and it
// keeps working because each time a mostly-new slice of followers sees it.
//
// Two kinds of clusters:
//   • self-repost — one author, near-identical text posted ≥ 2 times
//   • template    — ≥ 2 different authors using the same skeleton
//
// Similarity: text is normalized (case, URLs, @handles, numbers, emoji,
// punctuation stripped), cut into word 3-grams (shingles), compared with
// Jaccard. An inverted index over shingles keeps it fast — only posts that
// share a reasonably rare shingle are ever compared. Very short posts are
// compared on their whole normalized text instead.
import 'server-only';
import type { Analyzed } from './patterns';

export type RecycledCopy = {
  id: string; author: string | null; created: number; link: string;
  outlier: number; eng: number; likes: number; comments: number; views: number | null; sim: number;
};
export type RecycledCluster = {
  key: string;
  kind: 'self-repost' | 'template';
  platform: string;
  authors: string[];
  count: number;
  sample: string;           // the text, from the best-performing copy
  firstSeen: number;
  lastSeen: number;
  medianGapDays: number | null; // typical time between re-posts
  avgOutlier: number;       // mean outlier across copies
  stillWorks: number;       // share of copies AFTER the first that beat the creator's median (outlier ≥ 1)
  copies: RecycledCopy[];
};

const SIM = 0.6;           // Jaccard threshold on 3-gram shingles
const MAX_SHINGLE_DF = 40; // ignore shingles shared by too many posts (boilerplate)

export function normText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\w.]+/g, ' ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, ' ')
    .replace(/\d+([.,]\d+)?/g, ' 0 ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shingles(norm: string): Set<string> {
  const w = norm.split(' ').filter(Boolean);
  const out = new Set<string>();
  if (w.length < 6) { if (norm) out.add('§' + norm); return out; } // short posts: whole-text key
  for (let i = 0; i + 3 <= w.length; i++) out.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of s) if (l.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function findRecycled(rows: Analyzed[]): RecycledCluster[] {
  const out: RecycledCluster[] = [];
  for (const platform of new Set(rows.map(r => r.source))) {
    const posts = rows.filter(r => r.source === platform);
    const sh = posts.map(p => shingles(normText(p.body || p.text || p.title)));

    // inverted index → candidate pairs that share a not-too-common shingle
    const index = new Map<string, number[]>();
    sh.forEach((set, i) => { for (const s of set) (index.get(s) || index.set(s, []).get(s)!).push(i); });
    const parent = posts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const simOf = new Map<string, number>();
    const tried = new Set<string>();
    for (const ids of index.values()) {
      if (ids.length < 2 || ids.length > MAX_SHINGLE_DF) continue;
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        const i = ids[a], j = ids[b], k = i + ':' + j;
        if (tried.has(k)) continue;
        tried.add(k);
        const s = jaccard(sh[i], sh[j]);
        if (s >= SIM) { parent[find(i)] = find(j); simOf.set(k, s); }
      }
    }

    const groups = new Map<number, number[]>();
    posts.forEach((_, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)!).push(i); });
    for (const idx of groups.values()) {
      if (idx.length < 2) continue;
      const g = idx.map(i => ({ i, p: posts[i] })).sort((a, b) => a.p.created - b.p.created);
      // drop exact duplicates of the same post id that some actors return twice
      const ug = g.filter((x, k) => g.findIndex(y => y.p.id === x.p.id) === k);
      const uniq = ug.map(x => x.p);
      if (uniq.length < 2) continue;
      const authors = [...new Set(uniq.map(p => (p.author || '?').toLowerCase()))];
      const gaps = uniq.slice(1).map((p, i) => (p.created - uniq[i].created) / 864e5).filter(d => d > 0.04); // ignore same-hour dupes
      const later = uniq.slice(1);
      const best = [...uniq].sort((a, b) => b.outlier - a.outlier)[0];
      const avgSim = (i: number) => {
        let s = 0, n = 0;
        for (const j of idx) if (j !== i) { const v = simOf.get(Math.min(i, j) + ':' + Math.max(i, j)); if (v) { s += v; n++; } }
        return n ? s / n : SIM;
      };
      out.push({
        key: platform + ':' + best.id,
        kind: authors.length > 1 ? 'template' : 'self-repost',
        platform,
        authors,
        count: uniq.length,
        sample: (best.body || best.text || best.title || '').slice(0, 900),
        firstSeen: uniq[0].created,
        lastSeen: uniq[uniq.length - 1].created,
        medianGapDays: gaps.length ? Math.round(median(gaps) * 10) / 10 : null,
        avgOutlier: Math.round((uniq.reduce((s, p) => s + p.outlier, 0) / uniq.length) * 100) / 100,
        stillWorks: later.length ? Math.round((later.filter(p => p.outlier >= 1).length / later.length) * 100) : 0,
        copies: ug.map(({ i, p }) => ({
          id: p.id, author: p.author || null, created: p.created, link: p.link, outlier: p.outlier, eng: p.eng,
          likes: p.score, comments: p.comments, views: p.views ?? null,
          sim: Math.round(avgSim(i) * 100) / 100,
        })),
      });
    }
  }
  // most useful first: repeated often AND still pulling above-normal engagement
  return out.sort((a, b) => b.count * Math.max(0.2, b.avgOutlier) - a.count * Math.max(0.2, a.avgOutlier));
}

/** Compact AI-ready summary of recycled formats. */
export function recycledText(cs: RecycledCluster[], limit = 5): string {
  if (!cs.length) return '';
  return cs.slice(0, limit).map((c, i) => [
    `R${i + 1} [${c.platform.toUpperCase()} · ${c.kind}] posted ${c.count}× by ${c.authors.map(a => '@' + a).join(', ')}${c.medianGapDays != null ? `, every ~${c.medianGapDays} days` : ''} · avg outlier ${c.avgOutlier}× · repeats that still beat normal: ${c.stillWorks}%`,
    `   TEXT: ${c.sample.replace(/\s+/g, ' ').slice(0, 300)}`,
  ].join('\n')).join('\n');
}
