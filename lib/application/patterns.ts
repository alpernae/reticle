// lib/application/patterns.ts — the winners & patterns page's read model.
//
// The page used to run the whole analyzer over the whole corpus on every
// request. Now it reads the materialized read model (ADR-004): the per-post
// facts and the breakout scores are columns, so the pattern library and the
// winner list are computed from a table scan instead of a re-analysis.
//
// If the read model has never run (a fresh database), the columns are empty
// and the page says so rather than inventing numbers.
import 'server-only';
import { getStore } from '../db';
import { readTimezone } from '../timezone-store';
import { engagement, hookType, patternLibrary, winners, HOOK_LABEL, type Analyzed, type HookType } from '../domain/patterns';
import { findRecycled } from '../domain/recycle';
import { hourInTz, weekdayInTz } from '../domain/timezone';
import { CATEGORIES, inCategory, categoryCounts } from '../categories';

const safeList = (s: string | null | undefined): string[] => {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** The corpus as the domain sees it — read from the derived columns. */
export function analyzedRows(): Analyzed[] {
  const store = getStore();
  const tz = readTimezone();
  const rows = store.analyzedPostRows();
  const out: Analyzed[] = [];
  for (const r of rows) {
    const topics = safeList(r.topics);
    const hashtags = safeList(r.hashtags);
    const eng = r.eng ?? r.score + 2 * r.comments + 3 * (r.shares || 0) + 2 * (r.saves || 0);
    const hookLine = r.hookLine ?? r.title ?? '';
    out.push({
      id: r.id, source: r.source, title: r.title, text: r.text, url: '', link: r.link,
      score: r.score, comments: r.comments, created: r.created,
      topics, aiCats: safeList(r.aiCats), security: !!r.security, dev: !!r.dev,
      views: r.views != null ? Number(r.views) : undefined,
      author: r.author || undefined,
      authorFollowers: r.authorFollowers != null ? Number(r.authorFollowers) : undefined,
      authorLocation: r.authorLocation || undefined,
      shares: r.shares != null ? Number(r.shares) : undefined,
      saves: r.saves != null ? Number(r.saves) : undefined,
      media: r.media || undefined,
      hashtags, body: r.body || undefined,
      durationSec: r.durationSec != null ? Number(r.durationSec) : undefined,
      eng,
      er: r.views ? eng / r.views : r.authorFollowers ? eng / r.authorFollowers : null,
      outlier: r.outlier ?? 0,
      baseline: (r.baseline as Analyzed['baseline']) || 'platform',
      hook: (r.hook as HookType) || hookType(hookLine),
      hookLine,
      words: r.words ?? 0,
      lengthBucket: (r.lengthBucket as Analyzed['lengthBucket']) || 'short',
      hasLink: !!r.hasLink,
      emojiCount: r.emojiCount ?? 0,
      hour: hourInTz(r.created, tz),
      weekday: weekdayInTz(r.created, tz),
      niche: !!(r.security || r.dev),
    });
  }
  return out;
}

/** The winners & patterns payload for the given filters. */
export function buildPatterns(opts: { platform?: string; niche?: boolean; cat?: string } = {}) {
  const platform = (opts.platform || '').trim();
  const nicheOnly = !!opts.niche;
  const cat = (opts.cat || '').trim();
  // the baselines are computed over ALL posts, then filtered — a category
  // filter must not change what "normal" is for a creator
  const all = analyzedRows();
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
  for (const p of Object.keys(perPlatform)) {
    perPlatform[p].authors = new Set(rows.filter(r => r.source === p && r.author).map(r => r.author)).size;
  }
  return {
    total: rows.length, perPlatform, winners: wins,
    categories: CATEGORIES.map(c => ({ key: c.key, label: c.label, n: catCounts[c.key] || 0 })),
    patterns: lib.filter(x => !platform || x.platform === platform),
    recycled: findRecycled(scope).slice(0, 30),
  };
}
