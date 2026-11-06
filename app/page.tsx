'use client';
// Overview — dashboard layout in the classic monitoring shape: a top bar with
// status chips, a welcome row with the page's primary action, a filter row,
// four KPI cards with trend chips + sparklines + inspect links, one hero
// trend with a range switcher, then the day-by-day table and the signal cards.
// All colour still comes from theme tokens — monochrome by construction.
import Link from 'next/link';
import { Card, CardHead, Chip, Bars, TrendChart, StackBar, btn, btnPrimary, inputCls, useApiState, notifyRefresh, notifyActivity, kfmt, AGO } from '@/components/panel';
import { Kpi } from '@/components/panelui/kpi';
import { Sparkles, RefreshCw, ArrowRight, TrendingUp, Info, Search, Download } from 'lucide-react';
import { useState } from 'react';
import { CATEGORIES, inCategory, categoryCounts } from '@/lib/categories';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { BestTimeCard } from '@/components/best-time';
import { PostPlanet } from '@/components/post-planet';
import { Sel } from '@/components/sel';
import { Spinner } from '@/components/panelui/spinner';

const SNAME: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube' };
const hour12 = (i: number) => `${i % 12 || 12}:00 ${i < 12 ? 'AM' : 'PM'}`;
const hour12c = (i: number) => `${i % 12 || 12}${i < 12 ? 'a' : 'p'}`;
const DAY = 864e5;

type TopicSpike = {
  name: string;
  fresh: number;
  prev: number;
  pct: number;
  top: { title: string; source: string; link: string; score: number }[];
};
type PostRow = { created: number; score: number; comments: number; source: string; title: string; link: string; security?: boolean; topics?: string[]; aiCats?: string[] };
type Plat = 'all' | 'x' | 'linkedin' | 'instagram' | 'threads' | 'tiktok' | 'youtube';
type Win = 7 | 30 | 90;

/** Trend chip for a KPI header — the reference layout's "+5%" pill. */
function DeltaChip({ value, caption }: { value: number | null; caption?: string }) {
  if (value === null || !Number.isFinite(value)) return <Chip tone="a">new window</Chip>;
  return (
    <span title={caption}>
      <Kpi.Trend
        value={value}
        variant="badge"
        goodDirection="up"
        format={(v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}%`}
      />
    </span>
  );
}

export default function Overview() {
  const { data: d, reload } = useApiState();
  const [analyzing, setAnalyzing] = useState(false);
  const [plat, setPlat] = useState<Plat>('all');
  const [cat, setCat] = useState('');
  const [aiPick, setAiPick] = useState('');
  const [win, setWin] = useState<Win>(30);
  const [tableLimit, setTableLimit] = useState<14 | 30>(14);
  const [query, setQuery] = useState('');
  if (!d) return <EmptyState text="Loading radar…" />;
  const analysis = d.lastAnalysis ?? null;

  const runAnalyze = async () => {
    setAnalyzing(true);
    setTimeout(notifyActivity, 300);
    try { await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: pickedModel(aiPick) }) }); notifyRefresh(); } catch {}
    setAnalyzing(false);
  };

  const platPosts: PostRow[] = plat === 'all' ? d.posts : d.posts.filter((p: PostRow) => p.source === plat);
  const catCounts = categoryCounts(platPosts);
  const posts: PostRow[] = cat ? platPosts.filter(p => inCategory(p, cat)) : platPosts;
  const now = Date.now();
  const N = 30; // base window: KPIs, sparklines and the day-by-day table stay on it

  /** Day buckets over `days` ending `shift` days ago (shift=0 → the live window). */
  const mkWin = (days: number, shift = 0) => {
    const vol: number[] = new Array(days).fill(0);
    const eng: number[] = new Array(days).fill(0);
    const labels: string[] = [];
    const labelsFull: string[] = [];
    const byDay: PostRow[][] = Array.from({ length: days }, () => []);
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now - (i + shift) * DAY);
      labels.push(day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      labelsFull.push(day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
    }
    for (const p of posts) {
      if (p.created <= 0) continue;
      const ago = Math.floor((now - p.created) / DAY) - shift;
      if (ago >= 0 && ago < days) {
        const idx = days - 1 - ago;
        vol[idx] += 1;
        eng[idx] += p.score + 2 * p.comments;
        byDay[idx].push(p);
      }
    }
    const engSum = eng.reduce((s: number, v: number) => s + v, 0);
    const volSum = vol.reduce((s: number, v: number) => s + v, 0);
    return { vol, eng, labels, labelsFull, byDay, engSum, volSum };
  };

  const base = mkWin(N);       // KPIs, sparklines, day-by-day table
  const chart = mkWin(win);    // the hero trend follows the range switcher
  const prev30 = mkWin(N, N);  // the 30 days before that, for KPI deltas

  const pctDelta = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

  // ---- topic spikes (server-computed; unaffected by the client filter) ----
  const t0: TopicSpike | undefined = d.topics[0];
  const topics: TopicSpike[] = d.topics;
  const active = topics.filter((t: TopicSpike) => t.fresh || t.prev);
  const maxT = active.reduce((m: number, t: TopicSpike) => Math.max(m, t.fresh, t.prev), 1);

  // ---- hours (server-computed) ----
  const counts: number[] = d.hours.counts ?? [];
  const tops = [...counts.keys()].filter((i: number) => counts[i] > 0).sort((a: number, b: number) => counts[b] - counts[a]);
  const peak = tops[0] ?? 0;
  const hourSummary = counts.some((n: number) => n > 0)
    ? `peaks ${tops.slice(0, 3).map((i: number) => `${hour12(i)} — ${counts[i]} top posts`).join(' · ')}`
    : 'no top-scoring posts yet — run the collectors on Sources';
  const ha = d.hooks.agg;
  const tick = (i: number) => (i % 3 === 0 ? hour12c(i) : '');

  // ---- hero chart scale (mirrors TrendChart's own max, so ticks are honest) ----
  const hi = Math.max(...chart.eng, ...(chart.vol ?? []), 1);
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((f: number) => kfmt(Math.round(hi * f)));
  const chartEngPeak = chart.eng.reduce((b: number, v: number, i: number) => (v > chart.eng[b] ? i : b), 0);
  const momentumSummary = chart.engSum > 0
    ? `peak ${chart.labelsFull[chartEngPeak]} · ${kfmt(chart.eng[chartEngPeak])} engagement on the day · avg ${kfmt(Math.round(chart.engSum / win))}/day over ${win} days`
    : 'no posts in the window yet — run the collectors on Sources';
  const chartDelta = pctDelta(chart.engSum, mkWin(win, win).engSum);

  // ---- collected mix ----
  const bySrc: Record<string, number> = { x: 0, linkedin: 0, instagram: 0, threads: 0 };
  let sec = 0;
  for (const p of posts) {
    if (p.source in bySrc) bySrc[p.source]++;
    if (p.security) sec++;
  }
  const total = posts.length || 1;

  // ---- winners ----
  const manual: { platform: string; eng: number; text: string; ts?: number }[] = d.manual || [];
  const manualEng = manual.reduce((s: number, m: { eng: number }) => s + (m.eng || 0), 0);

  // ---- day-by-day rows for the table (search + limit live here) ----
  type TableRow = { i: number; e: number; dayPosts: PostRow[] };
  const tableRows = base.eng
    .map((e: number, i: number): TableRow => ({ i, e, dayPosts: base.byDay[i] }))
    .filter((r: TableRow) => r.dayPosts.length)
    .reverse()
    .filter((r: TableRow) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      const stamp = new Date(now - (N - 1 - r.i) * DAY);
      const hay = `${stamp.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${r.dayPosts.map((p: PostRow) => p.title).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  const shownRows = tableRows.slice(0, tableLimit);

  const exportCsv = () => {
    const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = ['date,posts,engagement,score,comments,peak_post,source,posted_at'];
    for (const r of shownRows) {
      const stamp = new Date(now - (N - 1 - r.i) * DAY);
      const best = [...r.dayPosts].sort((a: PostRow, b: PostRow) => (b.score + 2 * b.comments) - (a.score + 2 * a.comments))[0];
      lines.push([
        stamp.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
        r.dayPosts.length,
        r.e,
        r.dayPosts.reduce((s: number, p: PostRow) => s + p.score, 0),
        r.dayPosts.reduce((s: number, p: PostRow) => s + p.comments, 0),
        best.title.replace(/\s+/g, ' '),
        best.source,
        new Date(best.created).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'day-by-day.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- platform tabs + segmented range share one style ----
  const segBtn = (on: boolean) =>
    `h-8 rounded-md px-3.5 text-[13px] font-medium transition-colors ${on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`;
  const rangeBtn = (on: boolean) =>
    `h-7 rounded-md px-3 text-xs font-medium transition-colors ${on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`;

  const filteredNote = <Chip tone="a" title="this card is computed server-side over all sources — the tabs above filter the cards built from raw posts">all sources</Chip>;

  return (
    <div>
      {/* ---- top bar: page title + status chips (reference: title / bell / user) ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="a">{posts.length} posts in play</Chip>
          {analysis && <Chip tone={analysis.mode === 'ai' ? 'g' : 'a'} title={analysis.mode === 'ai' ? 'AI brief saved on the last run' : 'stats-only brief saved on the last run'}>{analysis.mode === 'ai' ? 'AI brief ready' : 'stats brief ready'}</Chip>}
        </div>
      </div>

      {/* ---- welcome row: big heading + the page's primary action ---- */}
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Your content radar</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-xl">
            {kfmt(base.volSum)} posts and {kfmt(base.engSum)} engagement in the last 30 days — topic spikes, exact posting hours, hooks and momentum below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModelPicker compact value={aiPick} onChange={setAiPick} label="AI for the brief" disabled={analyzing} />
          <button onClick={runAnalyze} disabled={analyzing} className={btnPrimary + ' h-10 shrink-0 whitespace-nowrap'} title="Generate the growth brief from the full SQLite digest">
            {analyzing ? <Spinner className="size-4" /> : <Sparkles className="size-4" aria-hidden="true" />}
            {analyzing ? 'Writing brief…' : 'Run AI brief'}
          </button>
        </div>
      </div>

      {/* ---- quick actions: the four places you create from ---- */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { href: '/patterns', t: 'Winners & patterns', s: 'what beat its creator’s normal, and why' },
          { href: '/generate', t: 'Generate', s: '3 drafts borrowing a winning structure' },
          { href: '/toolkit', t: 'Toolkit', s: 'bios, threads, thumbnails, carousels, hashtags' },
          { href: '/formats', t: 'Formats', s: 'daily series + quick conversation starters' },
        ].map(q => (
          <Link key={q.href} href={q.href} className="rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted transition-colors">
            <div className="text-[13px] font-semibold flex items-center justify-between">{q.t}<ArrowRight className="size-3.5" aria-hidden="true" /></div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{q.s}</div>
          </Link>
        ))}
      </div>

      {/* ---- filter row: platform tabs left, solid collect right ---- */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Platform filter">
          {(['all', 'x', 'linkedin', 'instagram', 'threads', 'tiktok', 'youtube'] as Plat[]).filter(p => p === 'all' || p === plat || d.posts.some((x: PostRow) => x.source === p)).map(p => (
            <button key={p} role="tab" aria-selected={plat === p} onClick={() => setPlat(p)} className={segBtn(plat === p)}>
              {p === 'all' ? 'All' : SNAME[p]}
            </button>
          ))}
        </div>
        <CategorySelect value={cat} onChange={setCat} counts={catCounts} total={platPosts.length} />
        <div className="flex-1" />
        <Link href="/sources" className={btnPrimary} title="Collectors for every platform live on the Sources page">
          <RefreshCw className="size-4" aria-hidden="true" />
          Collectors
        </Link>
      </div>

      {/* ---- KPI row: label + trend chip · big value + sparkline · caption · inspect ---- */}
      <div className="mt-5">
        <PostPlanet geo={d.geo} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi surface className="gap-3 rounded-xl">
          <Kpi.Header>
            <Kpi.Title className="text-[13px] font-medium text-foreground">Posts collected</Kpi.Title>
            <Kpi.Actions><DeltaChip value={pctDelta(base.volSum, prev30.volSum)} caption="posts last 30 days vs the previous 30 days" /></Kpi.Actions>
          </Kpi.Header>
          <Kpi.Content layout="inline">
            <Kpi.Stat>
              <Kpi.Value className="text-3xl">{base.volSum.toLocaleString('en-US')}</Kpi.Value>
              <Kpi.Footer className="text-xs">vs previous 30 days</Kpi.Footer>
            </Kpi.Stat>
            <Kpi.Chart data={base.vol.slice(-14)} inline />
          </Kpi.Content>
          <Link href="/feed" className={`${btn} mt-1 h-9 w-full justify-center`}>Open feed <ArrowRight className="size-4" aria-hidden="true" /></Link>
        </Kpi>

        <Kpi surface className="gap-3 rounded-xl">
          <Kpi.Header>
            <Kpi.Title className="text-[13px] font-medium text-foreground">Engagement</Kpi.Title>
            <Kpi.Actions><DeltaChip value={pctDelta(base.engSum, prev30.engSum)} caption="engagement last 30 days vs the previous 30 days" /></Kpi.Actions>
          </Kpi.Header>
          <Kpi.Content layout="inline">
            <Kpi.Stat>
              <Kpi.Value className="text-3xl">{kfmt(base.engSum)}</Kpi.Value>
              <Kpi.Footer className="text-xs">score + 2×comments · 30 days</Kpi.Footer>
            </Kpi.Stat>
            <Kpi.Chart data={base.eng.slice(-14)} inline />
          </Kpi.Content>
          <Link href="/feed" className={`${btn} mt-1 h-9 w-full justify-center`}>Open feed <ArrowRight className="size-4" aria-hidden="true" /></Link>
        </Kpi>

        <Kpi surface className="gap-3 rounded-xl">
          <Kpi.Header>
            <Kpi.Title className="text-[13px] font-medium text-foreground">Hottest topic · 48h</Kpi.Title>
            <Kpi.Actions><DeltaChip value={t0 ? t0.pct : null} caption={t0 ? `${t0.name}: ${t0.fresh} fresh posts vs ${t0.prev} in the previous 48h` : 'run the collectors on Sources to populate topics'} /></Kpi.Actions>
          </Kpi.Header>
          <Kpi.Content layout="inline">
            <Kpi.Stat>
              <Kpi.Value className="text-3xl truncate">{t0 ? t0.fresh : 0}</Kpi.Value>
              <Kpi.Footer className="truncate text-xs">{t0 ? t0.name : 'run collectors to populate'}</Kpi.Footer>
            </Kpi.Stat>
            <Kpi.Chart data={active.slice(0, 4).map((t: TopicSpike) => t.fresh)} inline />
          </Kpi.Content>
          <Link href={t0 ? `/feed?topic=${encodeURIComponent(t0.name)}` : '/feed'} className={`${btn} mt-1 h-9 w-full justify-center`}>See topic posts <ArrowRight className="size-4" aria-hidden="true" /></Link>
        </Kpi>

        <Kpi surface className="gap-3 rounded-xl">
          <Kpi.Header>
            <Kpi.Title className="text-[13px] font-medium text-foreground">Winners logged</Kpi.Title>
            <Kpi.Actions><Chip tone="z" title="your own posts, logged by you on the Winners page">yours</Chip></Kpi.Actions>
          </Kpi.Header>
          <Kpi.Content layout="inline">
            <Kpi.Stat>
              <Kpi.Value className="text-3xl">{manual.length.toLocaleString('en-US')}</Kpi.Value>
              <Kpi.Footer className="truncate text-xs">{kfmt(manualEng)} engagement · own posts</Kpi.Footer>
            </Kpi.Stat>
          </Kpi.Content>
          <Link href="/winners" className={`${btn} mt-1 h-9 w-full justify-center`}>Winners page <ArrowRight className="size-4" aria-hidden="true" /></Link>
        </Kpi>
      </div>

      {/* ---- hero trend: big value, legend with sums, range switcher, honest y-axis ---- */}
      <Card className="mt-5">
        <div className="px-5 pt-5 pb-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-muted">
                <TrendingUp className="size-5 text-foreground" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">Momentum</span>
                  <span title="daily engagement (score + 2×comments) against post volume, from the SQLite digest" className="grid place-items-center">
                    <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-2.5">
                  <span className="text-3xl font-bold tabular-nums tracking-tight">{kfmt(chart.engSum)}</span>
                  <span className="text-sm font-medium text-muted-foreground">eng · {chart.volSum} posts</span>
                  <DeltaChip value={chartDelta} caption={`engagement this ${win}-day window vs the previous one`} />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-foreground" /> eng <span className="font-medium tabular-nums text-foreground">{kfmt(chart.engSum)}</span></span>
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-foreground opacity-35" /> posts <span className="font-medium tabular-nums text-foreground">{chart.volSum}</span></span>
                </div>
              </div>
            </div>
            <div className="inline-flex rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Chart range">
              {([7, 30, 90] as Win[]).map(w => (
                <button key={w} role="tab" aria-selected={win === w} onClick={() => setWin(w)} className={rangeBtn(win === w)}>{w}D</button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-1 px-5 pt-3 pb-6">
          {/* y-axis: same scale TrendChart draws — top = its own max */}
          <div aria-hidden="true" className="w-10 shrink-0">
            <div className="flex h-[188px] flex-col justify-between pt-[18px] text-end text-[10px] tabular-nums text-muted-foreground">
              {yTicks.map((t: string, i: number) => <span key={i}>{t}</span>)}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <TrendChart
              labels={chart.labels}
              values={chart.eng}
              secondary={chart.vol}
              unit=" eng"
              ariaLabel={`Daily engagement and post volume over the last ${win} days`}
              height={170}
              tickEvery={win === 7 ? 1 : win === 30 ? 5 : 15}
              tickFormat={(i: number) => chart.labels[i]}
              hoverFormat={(i: number) => `${chart.labelsFull[i]} — ${kfmt(chart.eng[i])} eng · ${chart.vol[i]} post${chart.vol[i] === 1 ? '' : 's'}`}
              summary={momentumSummary}
            />
          </div>
        </div>
      </Card>

      {/* ---- day-by-day table: date rows, search, window limit, CSV export ---- */}
      <Card className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-semibold tracking-tight">Day by day</h2>
            <Link href="/feed" className="text-[13px] font-medium text-muted-foreground hover:text-foreground hover:underline">See all posts</Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search days</span>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search days…" className={`${inputCls} h-9 w-48 ps-8`} />
            </label>
            <Sel
              value={tableLimit}
              onChange={e => setTableLimit(Number(e.target.value) === 30 ? 30 : 14)}
              className={`${inputCls} h-9 w-36`}
              aria-label="Days shown"
            >
              <option value={14}>Recent 14 days</option>
              <option value={30}>Full 30 days</option>
            </Sel>
            <button onClick={exportCsv} className={`${btn} h-9`} title="Download the visible rows as CSV">
              <Download className="size-4" aria-hidden="true" /> CSV
            </button>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-2 py-2.5 font-medium">Posts</th>
                <th className="px-2 py-2.5 font-medium">Engagement</th>
                <th className="px-5 py-2.5 font-medium">Peak post of the day</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r: TableRow) => {
                const stamp = new Date(now - (N - 1 - r.i) * DAY);
                const dateLabel = stamp.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const scoreSum = r.dayPosts.reduce((s: number, p: PostRow) => s + p.score, 0);
                const cSum = r.dayPosts.reduce((s: number, p: PostRow) => s + p.comments, 0);
                const best = [...r.dayPosts].sort((a: PostRow, b: PostRow) => (b.score + 2 * b.comments) - (a.score + 2 * a.comments))[0];
                const bestTime = new Date(best.created).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return (
                  <tr key={r.i} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-2 whitespace-nowrap font-medium">{dateLabel}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{r.dayPosts.length}</td>
                    <td className="px-2 py-2 tabular-nums" title={`${scoreSum} score + 2×${cSum} comments = ${scoreSum + 2 * cSum}`}>
                      {kfmt(r.e)}
                    </td>
                    <td className="px-5 py-2 max-w-[420px]">
                      <a href={best.link} target="_blank" rel="noreferrer" className="hover:underline line-clamp-1">{best.title}</a>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {SNAME[best.source] || best.source} · posted {bestTime} · {kfmt(best.score)} score · {kfmt(best.comments)} comments
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!tableRows.length && (
                <tr><td colSpan={4} className="py-14 text-center text-muted-foreground">{query ? 'no day matches that search' : 'no posts in the last 30 days yet — run the collectors on Sources'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---- signals: everything that sits below the reference fold ---- */}
      <div className="mt-8 grid grid-cols-1 xl:grid-cols-[1.35fr_.65fr] gap-5">
        <Card>
          <CardHead
            title="Topic spikes"
            sub="fresh 48h vs the previous 48h — paired bars show the move"
            right={<div className="flex items-center gap-2">{plat !== 'all' && filteredNote}<Chip tone="a">48h window</Chip></div>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="px-5 py-2.5 font-medium">Topic</th>
                  <th className="px-2 py-2.5 font-medium">48h</th>
                  <th className="px-2 py-2.5 font-medium">prev</th>
                  <th className="px-2 py-2.5 font-medium">Δ</th>
                  <th className="px-5 py-2.5 font-medium">Top post</th>
                </tr>
              </thead>
              <tbody>
                {active.map((t: TopicSpike) => (
                  <tr key={t.name} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-2 font-medium">
                      <a href={`/feed?topic=${encodeURIComponent(t.name)}`} className="hover:underline">{t.name}</a>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{t.fresh}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{t.prev}</td>
                    <td className="px-2 py-2">
                      {/* the trend as a tiny paired bar: solid = fresh, dim = previous */}
                      <div
                        className="flex items-center gap-2"
                        title={`${t.fresh} fresh (48h) vs ${t.prev} previous (48h) — ${t.pct >= 0 ? '+' : ''}${t.pct}%`}
                      >
                        <span aria-hidden="true" className="flex w-14 shrink-0 flex-col gap-[3px]">
                          <span className="block h-1 rounded-full bg-foreground" style={{ width: `${Math.max(6, (t.fresh / maxT) * 100)}%` }} />
                          <span className="block h-1 rounded-full bg-foreground/20" style={{ width: `${Math.max(6, (t.prev / maxT) * 100)}%` }} />
                        </span>
                        <span className={`w-11 shrink-0 text-right text-xs font-semibold tabular-nums ${t.pct >= 0 ? '' : 'text-muted-foreground'}`}>
                          {t.pct >= 0 ? '+' : ''}{t.pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-2 max-w-[360px]">
                      {t.top[0] ? (
                        <>
                          <a href={t.top[0].link} target="_blank" rel="noreferrer" className="hover:underline line-clamp-1">{t.top[0].title}</a>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{SNAME[t.top[0].source] || t.top[0].source} · {kfmt(t.top[0].score)}</div>
                        </>
                      ) : <span className="text-muted-foreground/50">—</span>}
                    </td>
                  </tr>
                ))}
                {!active.length && (
                  <tr><td colSpan={5} className="py-14 text-center text-muted-foreground">no spikes yet — run the collectors on Sources</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Best posting hours"
            sub={`local day · ${Intl.DateTimeFormat().resolvedOptions().timeZone} · hour of posting for top-scoring posts`}
            right={plat !== 'all' ? filteredNote : undefined}
          />
          <div className="pt-5 pb-6">
            <Bars
              data={counts}
              unit=" top posts"
              ariaLabel={`Posts that scored, by hour of day${counts.some((n: number) => n > 0) ? `, peak around ${hour12(peak)}` : ''}`}
              height={150}
              labelTop={3}
              tickEvery={3}
              tickFormat={tick}
              tooltipFormat={(i: number) => `${hour12(i)} — ${counts[i]} top-scoring posts`}
              summary={hourSummary}
            />
          </div>
        </Card>
      </div>

      <div className="mt-5">
        <BestTimeCard timing={d.timing ?? []} platform={plat} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="Hook patterns" sub="characteristics of top-quartile posts by score" right={plat !== 'all' ? filteredNote : undefined} />
          <div className="px-5 pb-5 pt-4 space-y-3">
            {/* Real PanelUI progress parts — the bar itself is a progressbar with ARIA values */}
            <Kpi.Progress value={ha.numbers} label="contain a number" showValueLabel />
            <Kpi.Progress value={ha.how} label="start with How / Why / What / Stop / The" showValueLabel />
            <Kpi.Progress value={ha.questions} label="are questions" showValueLabel />
            <Kpi.Progress value={ha.colon} label="use a “title: subtitle” colon" showValueLabel />
            <div className="text-xs text-muted-foreground pt-1">avg winning title ≈ {ha.avgLen || '—'} chars (sweet spot 45–85)</div>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Collected mix"
            sub="share of the posts the current tab filters to"
            right={<Chip tone="a">{Math.round((sec / total) * 100)}% security</Chip>}
          />
          <div className="grid gap-5 px-5 pb-5 pt-4">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By source</div>
              <StackBar segments={[
                { label: 'X', value: bySrc.x },
                { label: 'LinkedIn', value: bySrc.linkedin },
                { label: 'Instagram', value: bySrc.instagram },
                { label: 'Threads', value: bySrc.threads },
              ]} />
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Security vs general</div>
              <StackBar segments={[
                { label: 'security', value: sec },
                { label: 'general', value: posts.length - sec },
              ]} />
            </div>
          </div>
        </Card>
      </div>

      {/* AI analysis: the welcome-row button runs it; the brief and its honesty chip live here */}
      <Card className="mt-5">
        <CardHead
          title="AI analysis"
          sub="a short growth brief, generated from the full SQLite digest — on demand, saved between runs"
          right={analysis ? (
            analysis.mode === 'ai'
              ? <Chip tone="g" title="generated by the AI on this run">via {analysis.via ? `${analysis.via.providerID}/${analysis.via.id}` : 'AI'} · {AGO(analysis.ts)} ago</Chip>
              : <Chip tone="a" title="rules-based summary because every AI lane was out of quota">stats only · {AGO(analysis.ts)} ago</Chip>
          ) : <Chip tone="a">not run yet</Chip>}
        />
        <div className="px-5 pb-5 pt-4">
          {analysis ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{analysis.text}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Hit <b className="font-semibold text-foreground">Run AI brief</b> up top to get a written brief grounded in your whole database — topic spikes, engagement mix, posting hours and hook patterns. Honest mode: when AI is out of quota it says so and falls back to a stats-only summary.</p>
          )}
          <div className="text-[11px] text-muted-foreground mt-3">reads every table in data.sqlite · never invents numbers outside it</div>
        </div>
      </Card>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="py-24 text-center text-muted-foreground">{text}</div>;
}

/** Audience-category filter — groups classifier topics (lib/categories.ts). */
function CategorySelect({ value, onChange, counts, total }: { value: string; onChange: (v: string) => void; counts: Record<string, number>; total: number }) {
  return (
    <Sel aria-label="Category filter" value={value} onChange={e => onChange(e.target.value)}
      className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-foreground/40">
      <option value="">All categories · {total}</option>
      {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label} · {counts[c.key] ?? 0}</option>)}
    </Sel>
  );
}
