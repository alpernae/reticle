'use client';
// Feed — every collected post, as a readable list. One toolbar holds all
// filters; a stat strip says what the current view contains; each row puts
// who/where/when on one quiet line, the post itself in the middle, and the
// numbers in fixed right-hand columns so they line up and compare at a glance.
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { PageHead, useApiState, AGO } from '@/components/panel';
import { Toolbar, ToolRow, Segmented, FilterChip, Stats, PlatTag, Empty, OutlierBadge, PLAT_ORDER, SNAME, num } from '@/components/kit';
import { ArrowUpRight, Search, ShieldCheck, X } from 'lucide-react';
import { Sel } from '@/components/sel';

type Post = {
  id: string; title: string; link: string; score: number; comments: number;
  created: number; source: string; security?: boolean; topics?: string[];
  T?: string; views?: number | null; author?: string; authorFollowers?: number; media?: string;
};
type Sort = 'new' | 'outlier' | 'eng' | 'views';
const PAGE = 100;
const GRID = 'grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)] items-start gap-x-3';

const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function FeedView() {
  const { data: d } = useApiState();
  const params = useSearchParams();
  const [src, setSrc] = useState('');
  const [topic, setTopic] = useState(params.get('topic') || '');
  const [sort, setSort] = useState<Sort>('new');
  const [secOnly, setSecOnly] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setTopic(params.get('topic') || ''), [params]);
  useEffect(() => setLimit(PAGE), [src, topic, sort, secOnly, q]);

  const out: Record<string, number> = d?.outliers || {};
  const all: Post[] = d?.posts || [];

  const filtered = useMemo<Post[]>(() => {
    let r = [...all];
    if (src) r = r.filter(p => p.source === src);
    if (topic) r = r.filter(p => p.topics?.includes(topic));
    if (secOnly) r = r.filter(p => p.security);
    if (q) { const s = q.toLowerCase(); r = r.filter(p => (p.T || p.title.toLowerCase()).includes(s) || (p.author || '').toLowerCase().includes(s)); }
    const eng = (p: Post) => p.score + p.comments * 2;
    r.sort((a, b) =>
      sort === 'new' ? b.created - a.created
        : sort === 'outlier' ? (out[b.id] ?? 0) - (out[a.id] ?? 0)
        : sort === 'views' ? (b.views ?? -1) - (a.views ?? -1) || eng(b) - eng(a)
        : eng(b) - eng(a));
    return r;
  }, [all, out, src, topic, secOnly, sort, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of all) c[p.source] = (c[p.source] || 0) + 1;
    return c;
  }, [all]);

  if (!d) return <div className="py-24 text-center text-muted-foreground">Loading feed…</div>;

  const rows = filtered.slice(0, limit);
  const filtering = Boolean(src || topic || q || secOnly);
  const clear = () => { setSrc(''); setTopic(''); setSecOnly(false); setQ(''); };
  const topics: string[] = d.topics.map((t: { name: string }) => t.name);

  // what the current view contains
  const likes = filtered.map(p => p.score).sort((a, b) => a - b);
  const median = likes.length ? likes[likes.length >> 1] : 0;
  const winners = filtered.filter(p => (out[p.id] ?? 0) >= 2).length;
  const sec = filtered.filter(p => p.security).length;
  const newest = filtered.reduce((m, p) => Math.max(m, p.created), 0);
  const oldest = filtered.reduce((m, p) => (m === 0 || p.created < m ? p.created : m), 0);

  return (
    <div className="space-y-4">
      <PageHead
        title="Feed"
        sub="Every post collected from the creators on Sources. Sort by breakout to see which ones beat their creator's normal."
      />

      <Toolbar>
        <ToolRow>
          <Segmented ariaLabel="Platform" value={src} onChange={setSrc}
            options={[{ key: '', label: 'All', count: all.length }, ...PLAT_ORDER.filter(p => counts[p]).map(p => ({ key: p, label: SNAME[p], count: counts[p] }))]} />
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search posts or @author" aria-label="Search posts"
              className="h-8 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground/40" />
          </div>
        </ToolRow>
        <ToolRow>
          <Sel value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort" size="sm" className="w-44">
            <option value="new">Newest first</option>
            <option value="outlier">Biggest breakout</option>
            <option value="eng">Most engagement</option>
            <option value="views">Most views</option>
          </Sel>
          <Sel value={topic} onChange={e => setTopic(e.target.value)} aria-label="Topic" size="sm" className="w-48">
            <option value="">All topics</option>{topics.map(t => <option key={t}>{t}</option>)}
          </Sel>
          <FilterChip on={secOnly} onClick={() => setSecOnly(v => !v)} title="Only posts about security">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Security
          </FilterChip>
          {filtering && (
            <button onClick={clear} className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] text-muted-foreground hover:text-foreground">
              <X className="size-3.5" aria-hidden="true" /> Clear filters
            </button>
          )}
          <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">{filtered.length.toLocaleString('en-US')} of {all.length.toLocaleString('en-US')} posts</span>
        </ToolRow>
      </Toolbar>

      <Stats items={[
        { label: 'Posts', value: filtered.length.toLocaleString('en-US'), hint: newest ? `${when(oldest).split(',')[0]} – ${when(newest).split(',')[0]}` : undefined },
        { label: 'Median likes', value: num(median), hint: 'half the posts got more' },
        { label: 'Breakouts', value: winners, hint: `${filtered.length ? Math.round((winners / filtered.length) * 100) : 0}% beat their creator's normal 2×+`, title: "Posts with 2× or more of their creator's usual engagement" },
        { label: 'Security', value: `${filtered.length ? Math.round((sec / filtered.length) * 100) : 0}%`, hint: `${sec} posts on security topics` },
      ]} />

      <div className="rounded-xl border border-border bg-card">
        {/* column labels, once */}
        <div className={`${GRID} border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground`}>
          <span>Post</span>
          <span className="text-right" title="Engagement vs this creator's normal">Breakout</span>
          <span className="text-right">Likes</span>
          <span className="hidden sm:block text-right">Comments</span>
          <span className="hidden sm:block text-right" title="Public view count, when the platform shows one">Views</span>
        </div>

        {!rows.length ? (
          <Empty title="Nothing matches these filters">Clear the filters, or run a collector on Sources.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(p => (
              <li key={p.id} className={`${GRID} group px-4 py-3 hover:bg-muted/40`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                    <PlatTag source={p.source} onClick={() => setSrc(p.source)} />
                    {p.author && <span className="font-medium text-foreground/80">@{p.author}</span>}
                    {p.authorFollowers ? <span>{num(p.authorFollowers)} followers</span> : null}
                    <span aria-hidden="true">·</span>
                    <span title={new Date(p.created).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}>{when(p.created)} · {AGO(p.created)} ago</span>
                    {p.media && p.media !== 'text' && <><span aria-hidden="true">·</span><span>{p.media}</span></>}
                  </div>
                  <a href={p.link} target="_blank" rel="noreferrer" title={p.title}
                    className="mt-1 line-clamp-2 text-[14px] font-medium leading-snug text-foreground hover:underline">
                    {p.title || '(no text)'}
                    <ArrowUpRight className="ml-1 inline size-3.5 align-[-2px] text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden="true" />
                  </a>
                  {(p.topics?.length || p.security) ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(p.topics || []).slice(0, 3).map(t => (
                        <button key={t} onClick={() => setTopic(t)} title={`Show only ${t}`}
                          className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">{t}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="pt-5 text-right"><OutlierBadge value={out[p.id]} /></div>
                <div className="pt-5 text-right text-sm font-semibold tabular-nums">{num(p.score)}</div>
                <div className="hidden sm:block pt-5 text-right text-sm tabular-nums text-muted-foreground">{num(p.comments)}</div>
                <div className="hidden sm:block pt-5 text-right text-sm tabular-nums text-muted-foreground">{p.views != null ? num(p.views) : '—'}</div>
              </li>
            ))}
          </ul>
        )}

        {filtered.length > limit && (
          <div className="border-t border-border p-3 text-center">
            <button onClick={() => setLimit(l => l + PAGE)} className="h-8 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              Show {Math.min(PAGE, filtered.length - limit)} more · {(filtered.length - limit).toLocaleString('en-US')} left
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Feed() {
  return <Suspense fallback={<div className="py-24 text-center text-muted-foreground">Loading…</div>}><FeedView /></Suspense>;
}
