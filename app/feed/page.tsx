'use client';
// Feed — every collected post, as a readable list. One toolbar holds all
// filters; a stat strip says what the current view contains; each row puts
// who/where/when on one quiet line, the post itself in the middle, and the
// numbers in fixed right-hand columns so they line up and compare at a glance.
//
// The filtering, the sorting and the paging happen on the server (ADR-004):
// the browser asks for one page of rows at a time and gets the stats for the
// whole filtered set alongside them.
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHead, AGO, notifyRefresh } from '@/components/panel';
import { Toolbar, ToolRow, Segmented, FilterChip, Stats, PlatTag, Empty, OutlierBadge, PLAT_ORDER, SNAME, num } from '@/components/kit';
import { ArrowUpRight, Search, ShieldCheck, X } from 'lucide-react';
import { Sel } from '@/components/sel';

type FeedPost = {
  id: string; title: string; link: string; score: number; comments: number;
  created: number; source: string; security: boolean; topics: string[];
  views: number | null; author: string | null; authorFollowers: number | null;
  media: string | null; outlier: number;
};
type FeedResponse = {
  posts: FeedPost[];
  total: number;
  grandTotal: number;
  next: string | null;
  bySource: Record<string, number>;
  topics: string[];
  stats: { medianLikes: number; breakouts: number; security: number; newest: number; oldest: number };
};
type Sort = 'new' | 'outlier' | 'eng' | 'views';
const PAGE = 100;
const GRID = 'grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] sm:grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)] items-start gap-x-3';

const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function FeedView() {
  const params = useSearchParams();
  const [src, setSrc] = useState('');
  const [topic, setTopic] = useState(params.get('topic') || '');
  const [sort, setSort] = useState<Sort>('new');
  const [secOnly, setSecOnly] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState<FeedResponse | null>(null);
  const [rows, setRows] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTopic(params.get('topic') || ''), [params]);
  // the search runs on the server — debounce it so every keystroke is not a query
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);

  const base = useMemo(() => {
    const p = new URLSearchParams();
    if (src) p.set('platform', src);
    if (topic) p.set('topic', topic);
    if (secOnly) p.set('security', '1');
    if (dq) p.set('q', dq);
    p.set('sort', sort);
    p.set('limit', String(PAGE));
    return '/api/posts?' + p.toString();
  }, [src, topic, secOnly, dq, sort]);

  // first page — and again whenever the app asks for a refresh
  useEffect(() => {
    let alive = true;
    const load = () => fetch(base).then(r => r.json()).then(j => {
      if (!alive) return;
      setPage(j); setRows(j.posts || []); setCursor(j.next || null);
    }).catch(() => {});
    load();
    const h = () => load();
    window.addEventListener('sc-refresh', h);
    return () => { alive = false; window.removeEventListener('sc-refresh', h); };
  }, [base]);

  const loadMore = useCallback(async () => {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const j = await fetch(base + '&cursor=' + encodeURIComponent(cursor)).then(r => r.json());
      setRows(prev => [...prev, ...(j.posts || [])]);
      setCursor(j.next || null);
    } catch {}
    setBusy(false);
  }, [base, cursor, busy]);

  if (!page) return <div className="py-24 text-center text-muted-foreground">Loading feed…</div>;

  const filtering = Boolean(src || topic || q || secOnly);
  const clear = () => { setSrc(''); setTopic(''); setSecOnly(false); setQ(''); };
  const topics: string[] = page.topics || [];
  const stats = page.stats;
  const total = page.total;
  const remaining = Math.max(0, total - rows.length);

  return (
    <div className="space-y-4">
      <PageHead
        title="Feed"
        sub="Every post collected from the creators on Sources. Sort by breakout to see which ones beat their creator's normal."
      />

      <Toolbar>
        <ToolRow>
          <Segmented ariaLabel="Platform" value={src} onChange={setSrc}
            options={[{ key: '', label: 'All', count: page.grandTotal }, ...PLAT_ORDER.filter(p => page.bySource[p]).map(p => ({ key: p, label: SNAME[p], count: page.bySource[p] }))]} />
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
          <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">{total.toLocaleString('en-US')} of {page.grandTotal.toLocaleString('en-US')} posts</span>
        </ToolRow>
      </Toolbar>

      <Stats items={[
        { label: 'Posts', value: total.toLocaleString('en-US'), hint: stats.newest ? `${when(stats.oldest).split(',')[0]} – ${when(stats.newest).split(',')[0]}` : undefined },
        { label: 'Median likes', value: num(stats.medianLikes), hint: 'half the posts got more' },
        { label: 'Breakouts', value: stats.breakouts, hint: `${total ? Math.round((stats.breakouts / total) * 100) : 0}% beat their creator's normal 2×+`, title: "Posts with 2× or more of their creator's usual engagement" },
        { label: 'Security', value: `${total ? Math.round((stats.security / total) * 100) : 0}%`, hint: `${stats.security} posts on security topics` },
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
                <div className="pt-5 text-right"><OutlierBadge value={p.outlier} /></div>
                <div className="pt-5 text-right text-sm font-semibold tabular-nums">{num(p.score)}</div>
                <div className="hidden sm:block pt-5 text-right text-sm tabular-nums text-muted-foreground">{num(p.comments)}</div>
                <div className="hidden sm:block pt-5 text-right text-sm tabular-nums text-muted-foreground">{p.views != null ? num(p.views) : '—'}</div>
              </li>
            ))}
          </ul>
        )}

        {remaining > 0 && (
          <div className="border-t border-border p-3 text-center">
            <button onClick={loadMore} disabled={busy} className="h-8 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
              {busy ? 'Loading…' : `Show ${Math.min(PAGE, remaining)} more · ${remaining.toLocaleString('en-US')} left`}
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
