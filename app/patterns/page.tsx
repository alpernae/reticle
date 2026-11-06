'use client';
// Winners & patterns — the core of the product. Every collected post is scored
// against its own creator's baseline (outlier ×), so a breakout from a small
// account outranks an ordinary post from a giant one.
// Layout: one toolbar → a one-line "how to read this" → three tabs:
//   Winners     the ranked breakouts
//   What works  the traits that lift (or sink) results, per platform, as bars
//   Recycled    the same text posted again, and whether repeats still win
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PageHead, AGO, btnPrimary } from '@/components/panel';
import { Toolbar, ToolRow, Segmented, FilterChip, Tabs, PlatTag, Empty, OutlierBadge, PLAT_ORDER, SNAME, num } from '@/components/kit';
import { CategorizeButton } from '@/components/categorize-button';
import { ArrowUpRight, ChevronDown, Info, Sparkles } from 'lucide-react';
import { Sel } from '@/components/sel';

type Win = {
  id: string; source: string; author: string | null; authorFollowers: number | null; link: string;
  hookLine: string; hookLabel: string; media: string; likes: number; comments: number;
  shares: number | null; saves: number | null; views: number | null; eng: number; er: number | null;
  outlier: number; baseline: 'author' | 'audience' | 'platform'; words: number; created: number; niche: boolean;
  topics: string[]; hashtags: string[]; durationSec: number | null; body: string;
};
type Pattern = { platform: string; trait: string; value: string; n: number; medianOutlier: number; lift: number; winRate: number };
type Copy = { id: string; author: string | null; created: number; link: string; outlier: number; eng: number; likes: number; comments: number; views: number | null; sim: number };
type Recycled = { key: string; kind: 'self-repost' | 'template'; platform: string; authors: string[]; count: number; sample: string; firstSeen: number; lastSeen: number; medianGapDays: number | null; avgOutlier: number; stillWorks: number; copies: Copy[] };
type Data = { categories?: { key: string; label: string; n: number }[]; total: number; perPlatform: Record<string, { n: number; authors: number; winners: number; rich: number }>; winners: Win[]; patterns: Pattern[]; recycled: Recycled[] };
type Tab = 'winners' | 'patterns' | 'recycled';

const BASE: Record<Win['baseline'], string> = { author: "vs this creator's normal", audience: 'vs their audience size', platform: 'vs the platform typical' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** trait + value → a plain sentence fragment */
function traitText(trait: string, value: string): string {
  switch (trait) {
    case 'format': return `${cap(value)} posts`;
    case 'hook': return `Opens with: ${value}`;
    case 'length': return `${cap(value)} length`;
    case 'link in post': return value === 'has link' ? 'Has a link' : 'No link';
    case 'time': return `Posted ${value.replace('–', ':00–')}:00`;
    case 'day': return `Posted on a ${value}`;
    default: return cap(value);
  }
}

export default function Patterns() {
  const [plat, setPlat] = useState('');
  const [niche, setNiche] = useState(false);
  const [cat, setCat] = useState('');
  const [rev, setRev] = useState(0);
  const [tab, setTab] = useState<Tab>('winners');
  const [d, setD] = useState<Data | null>(null);

  useEffect(() => {
    setD(null);
    fetch(`/api/patterns?platform=${plat}&niche=${niche ? 1 : 0}&cat=${cat}`).then(r => r.json()).then(setD).catch(() => {});
  }, [plat, niche, cat, rev]);

  const byPlatform = useMemo(() => {
    const m: Record<string, Pattern[]> = {};
    for (const p of d?.patterns || []) (m[p.platform] ||= []).push(p);
    return m;
  }, [d]);
  const total = Object.values(d?.perPlatform || {}).reduce((s, p) => s + p.n, 0);

  return (
    <div className="space-y-4">
      <PageHead
        title="Winners & patterns"
        sub="The posts that beat their creator's normal, and the traits they have in common."
        right={<Link href="/generate" className={btnPrimary}><Sparkles className="size-4" aria-hidden="true" /> Draft from winners</Link>}
      />

      <Toolbar>
        <ToolRow>
          <Segmented ariaLabel="Platform" value={plat} onChange={setPlat}
            options={[{ key: '', label: 'All', count: plat ? null : total || null },
              ...PLAT_ORDER.filter(p => d?.perPlatform?.[p] || p === plat).map(p => ({ key: p, label: SNAME[p], count: d?.perPlatform?.[p]?.n ?? null }))]} />
        </ToolRow>
        <ToolRow>
          <Sel aria-label="Category" value={cat} onChange={e => setCat(e.target.value)} size="sm" className="w-56">
            <option value="">All categories</option>
            {(d?.categories || []).map(c => <option key={c.key} value={c.key}>{c.label} · {c.n}</option>)}
          </Sel>
          <FilterChip on={niche} onClick={() => setNiche(v => !v)} title="Only posts about dev and security topics">Dev & security only</FilterChip>
          <div className="ml-auto"><CategorizeButton onDone={() => setRev(v => v + 1)} /></div>
        </ToolRow>
      </Toolbar>

      <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span><b className="text-foreground">3.0×</b> means the post got 3 times the engagement its creator usually gets (comments count 2×, shares 3×, saves 2×). <b className="text-foreground">Winners</b> are 2× or more.</span>
      </p>

      {d && d.total < 30 && (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground">
          Only <b className="text-foreground">{d.total}</b> posts so far. Scores get reliable at <b className="text-foreground">3+ posts per creator</b> and <b className="text-foreground">30+ per platform</b>. Add creators on <Link className="underline" href="/sources">Sources</Link>.
        </div>
      )}

      <Tabs value={tab} onChange={k => setTab(k as Tab)} tabs={[
        { key: 'winners', label: 'Winners', count: d?.winners.length ?? null },
        { key: 'patterns', label: 'What works', count: d ? Object.keys(byPlatform).length || 0 : null },
        { key: 'recycled', label: 'Recycled', count: d?.recycled.length ?? null },
      ]} />

      {!d ? <div className="py-16 text-center text-sm text-muted-foreground">Scoring posts…</div>
        : tab === 'winners' ? <WinnerList items={d.winners} />
        : tab === 'patterns' ? <PatternGrid byPlatform={byPlatform} per={d.perPlatform} />
        : <RecycledList items={d.recycled} />}
    </div>
  );
}

// ---------------- Winners ----------------
function WinnerList({ items }: { items: Win[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return <div className="rounded-xl border border-border bg-card"><Empty title="No posts for this filter">Run a collector on Sources, or loosen the filters.</Empty></div>;
  return (
    <ol className="divide-y divide-border rounded-xl border border-border bg-card">
      {items.map((w, i) => {
        const isOpen = open === w.id;
        const stats: [string, number | null][] = [['likes', w.likes], ['comments', w.comments], ['shares', w.shares], ['saves', w.saves], ['views', w.views]];
        return (
          <li key={w.id} className="flex gap-4 px-4 py-4 sm:px-5">
            <div className="w-20 shrink-0 text-center">
              <div className="text-[11px] tabular-nums text-muted-foreground">#{i + 1}</div>
              <div className="mt-1"><OutlierBadge value={w.outlier} size="lg" /></div>
              <div className="mt-1 text-[10px] leading-tight text-muted-foreground">{BASE[w.baseline]}</div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                <PlatTag source={w.source} />
                <span className="font-medium text-foreground/80">{w.author ? '@' + w.author : 'unknown author'}</span>
                {w.authorFollowers ? <span>{num(w.authorFollowers)} followers</span> : null}
                <span aria-hidden="true">·</span><span>{AGO(w.created)} ago</span>
              </div>

              <p className={`mt-1.5 text-[15px] font-medium leading-snug ${isOpen ? '' : 'line-clamp-3'}`}>{w.hookLine || '(no text)'}</p>
              {isOpen && w.body && w.body !== w.hookLine && (
                <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-[13px] leading-relaxed text-foreground/80">{w.body}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{w.media}{w.durationSec ? ` · ${w.durationSec}s` : ''}</span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{w.hookLabel}</span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{w.words} words</span>
                {!w.niche && <span className="rounded-md border border-border px-1.5 py-0.5 text-muted-foreground" title="Different topic: study the format, not the subject">off-niche</span>}
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
                {stats.filter(([, v]) => v != null).map(([k, v]) => <span key={k}><b className="font-semibold text-foreground">{num(v)}</b> {k}</span>)}
                {w.er != null && <span title="Engagement rate"><b className="font-semibold text-foreground">{(w.er * 100).toFixed(1)}%</b> ER</span>}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link href={`/generate?ref=${encodeURIComponent(w.id)}&platform=${w.source}`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:opacity-90">
                  <Sparkles className="size-3.5" aria-hidden="true" /> Use this structure
                </Link>
                {w.body && w.body !== w.hookLine && (
                  <button onClick={() => setOpen(isOpen ? null : w.id)} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
                    <ChevronDown className={`size-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />{isOpen ? 'Hide full post' : 'Full post'}
                  </button>
                )}
                {w.link && <a href={w.link} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">Open <ArrowUpRight className="size-3.5" aria-hidden="true" /></a>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------- What works ----------------
function PatternGrid({ byPlatform, per }: { byPlatform: Record<string, Pattern[]>; per: Data['perPlatform'] }) {
  const plats = PLAT_ORDER.filter(p => byPlatform[p]).concat(Object.keys(byPlatform).filter(p => !PLAT_ORDER.includes(p)));
  if (!plats.length) return <div className="rounded-xl border border-border bg-card"><Empty title="Not enough posts yet">Patterns appear once a platform has 6+ posts with at least two different values per trait.</Empty></div>;
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">Bars compare posts with a trait to the platform's typical post (1×). Only traits seen in 5+ posts are shown; <i>n</i> is how many posts back it up.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {plats.map(p => {
          const rows = byPlatform[p];
          const up = rows.filter(r => r.lift >= 1.15).sort((a, b) => b.lift - a.lift).slice(0, 7);
          const down = rows.filter(r => r.lift < 0.85).sort((a, b) => a.lift - b.lift).slice(0, 4);
          const max = Math.max(2, ...rows.map(r => r.lift));
          return (
            <section key={p} className="rounded-xl border border-border bg-card">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <PlatTag source={p} />
                <span className="text-[12px] tabular-nums text-muted-foreground">{per[p]?.n ?? 0} posts · {per[p]?.authors ?? 0} creators · {per[p]?.winners ?? 0} winners</span>
              </header>
              <div className="space-y-4 p-4">
                <TraitBlock title="Works better" rows={up} max={max} empty="No trait clearly lifts results yet." />
                {down.length > 0 && <TraitBlock title="Works worse" rows={down} max={max} />}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TraitBlock({ title, rows, max, empty }: { title: string; rows: Pattern[]; max: number; empty?: string }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {!rows.length ? <p className="text-[12px] text-muted-foreground">{empty}</p> : (
        <ul className="space-y-2">
          {rows.map(r => {
            const good = r.lift >= 1;
            return (
              <li key={r.trait + r.value} className="grid grid-cols-[minmax(0,1fr)_5.5rem_3rem] items-center gap-3 text-[13px]"
                title={`${r.n} posts · ${r.winRate}% of them were winners (2×+) · median ${r.medianOutlier.toFixed(2)}×`}>
                <span className="min-w-0 truncate">{traitText(r.trait, r.value)} <span className="text-[11px] text-muted-foreground">n{r.n}</span></span>
                <span className="h-2 overflow-hidden rounded-full bg-muted">
                  <span className={`block h-full rounded-full ${good ? 'bg-foreground' : 'bg-muted-foreground/50'}`} style={{ width: `${Math.max(6, Math.min(100, (r.lift / max) * 100))}%` }} />
                </span>
                <span className={`text-right font-semibold tabular-nums ${good ? '' : 'text-muted-foreground'}`}>{r.lift.toFixed(2)}×</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------- Recycled ----------------
const fmtD = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function RecycledList({ items }: { items: Recycled[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return (
    <div className="rounded-xl border border-border bg-card">
      <Empty title="No repeated posts found yet">Detection needs several posts per creator inside the collection window. Put accounts you've seen re-posting on Sources, ideally alone in a run with a higher Max results.</Empty>
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">The same text posted more than once, by one creator (self-repost) or by many (template). If repeats keep beating normal, it's an evergreen format worth your own version.</p>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {items.map(c => {
          const isOpen = open === c.key;
          return (
            <li key={c.key} className="flex gap-4 px-4 py-4 sm:px-5">
              <div className="w-20 shrink-0 text-center">
                <div className="text-lg font-semibold tabular-nums">{c.count}×</div>
                <div className="text-[10px] text-muted-foreground">posted</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                  <PlatTag source={c.platform} />
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">{c.kind === 'self-repost' ? 'Self-repost' : `Template · ${c.authors.length} creators`}</span>
                  <span>{c.authors.slice(0, 3).map(a => '@' + a).join(', ')}{c.authors.length > 3 ? ` +${c.authors.length - 3}` : ''}</span>
                  <span aria-hidden="true">·</span>
                  <span>{fmtD(c.firstSeen)} → {fmtD(c.lastSeen)}{c.medianGapDays != null ? `, every ~${c.medianGapDays}d` : ''}</span>
                </div>
                <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[14px] leading-snug">{c.sample}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 text-[12px] tabular-nums text-muted-foreground">
                  <span><b className="font-semibold text-foreground">{c.avgOutlier.toFixed(2)}×</b> average vs normal</span>
                  <span><b className="font-semibold text-foreground">{c.stillWorks}%</b> of repeats still beat normal</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link href={`/generate?ref=${encodeURIComponent(c.copies[0].id)}&platform=${c.platform}`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:opacity-90">
                    <Sparkles className="size-3.5" aria-hidden="true" /> Make my evergreen version
                  </Link>
                  <button onClick={() => setOpen(isOpen ? null : c.key)} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
                    <ChevronDown className={`size-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />{isOpen ? 'Hide copies' : `All ${c.copies.length} copies`}
                  </button>
                </div>
                {isOpen && (
                  <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-[12px] tabular-nums">
                      <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
                        <tr><th className="px-3 py-1.5 font-medium">Posted</th><th className="px-3 py-1.5 font-medium">Author</th><th className="px-3 py-1.5 text-right font-medium">vs normal</th><th className="px-3 py-1.5 text-right font-medium">Likes</th><th className="px-3 py-1.5 text-right font-medium">Comments</th><th className="px-3 py-1.5 text-right font-medium">Same text</th><th /></tr>
                      </thead>
                      <tbody>
                        {c.copies.map(p => (
                          <tr key={p.id} className="border-t border-border">
                            <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{new Date(p.created).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })}</td>
                            <td className="px-3 py-1.5">{p.author ? '@' + p.author : '—'}</td>
                            <td className="px-3 py-1.5 text-right"><OutlierBadge value={p.outlier} /></td>
                            <td className="px-3 py-1.5 text-right">{num(p.likes)}</td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">{num(p.comments)}</td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">{Math.round(p.sim * 100)}%</td>
                            <td className="px-3 py-1.5 text-right">{p.link && <a href={p.link} target="_blank" rel="noreferrer" aria-label="Open post" className="text-muted-foreground hover:text-foreground"><ArrowUpRight className="inline size-3.5" aria-hidden="true" /></a>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
