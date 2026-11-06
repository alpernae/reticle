import { NextResponse } from 'next/server';
import { allPayload } from '@/lib/engine';
import { analyze, patternLibrary, winners, HOOK_LABEL } from '@/lib/patterns';
import { findRecycled } from '@/lib/recycle';
import { CATEGORIES, inCategory, categoryCounts } from '@/lib/categories';

/** GET ?platform=x&niche=1 — outlier winners + the pattern library (deterministic, no AI). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const platform = u.searchParams.get('platform') || '';
  const nicheOnly = u.searchParams.get('niche') === '1';
  const cat = u.searchParams.get('cat') || '';
  // outlier baselines are computed over ALL posts, then filtered — a category filter must not change what "normal" is for a creator
  const all = analyze(allPayload().posts);
  const catCounts = categoryCounts(all.filter(r => !platform || r.source === platform));
  const rows = cat ? all.filter(r => inCategory(r, cat)) : all;
  const lib = patternLibrary(rows);
  const scope = rows.filter(r => !platform || r.source === platform);
  const wins = winners(scope, { limit: 40, nicheOnly }).map(a => ({
    id: a.id, source: a.source, author: a.author || null, authorFollowers: a.authorFollowers ?? null,
    link: a.link, hookLine: a.hookLine, hook: a.hook, hookLabel: HOOK_LABEL[a.hook], media: a.media || 'text',
    likes: a.score, comments: a.comments, shares: a.shares ?? null, saves: a.saves ?? null, views: a.views ?? null,
    eng: a.eng, er: a.er, outlier: a.outlier, baseline: a.baseline, words: a.words, created: a.created,
    niche: a.niche, topics: a.topics || [], hashtags: a.hashtags || [], durationSec: a.durationSec ?? null,
    body: (a.body || a.text || '').slice(0, 1200),
  }));
  const perPlatform: Record<string, { n: number; authors: number; winners: number; rich: number }> = {};
  for (const r of rows) {
    const s = (perPlatform[r.source] ||= { n: 0, authors: 0, winners: 0, rich: 0 });
    s.n++; if (r.outlier >= 2) s.winners++; if (r.author) s.rich++;
  }
  for (const p of Object.keys(perPlatform)) perPlatform[p].authors = new Set(rows.filter(r => r.source === p && r.author).map(r => r.author)).size;
  return NextResponse.json({
    total: rows.length, perPlatform, winners: wins, categories: CATEGORIES.map(c => ({ key: c.key, label: c.label, n: catCounts[c.key] || 0 })),
    patterns: lib.filter(x => !platform || x.platform === platform),
    recycled: findRecycled(scope).slice(0, 30),
  });
}
