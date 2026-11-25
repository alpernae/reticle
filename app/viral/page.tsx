'use client';
// Viral — the corpus ranked by how far each post beat its own yardstick.
//
// "Viral" here is relative, never absolute: a post is measured against its
// author's usual engagement, the platform's median, or the audience's normal
// rate — the same yardstick the rest of the app uses — and the lift is then
// weighted by how recent the post is. That makes a 40-like Threads post and
// a 4k-like X post comparable.
//
// Every card says WHY it ranked (the lift, the hook, the slot, the mix, the
// age) and carries the post's STRUCTURE — the recipe a new post can copy.
// The wording never travels: "Make one like this" hands the generator the
// shape, not the sentences.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHead, Card, Chip } from '@/components/panel';
import { Toolbar, ToolRow, Segmented, Stats, PlatTag, Empty, ViralBadge, PLAT_ORDER, SNAME, num } from '@/components/kit';
import { Sel } from '@/components/sel';
import { ArrowUpRight, Sparkles, Loader } from 'lucide-react';

type Card_ = {
  id: string; source: string; title: string; body: string; link: string;
  author: string | null; authorFollowers: number | null; created: number; ageDays: number;
  likes: number; comments: number; shares: number | null; saves: number | null; views: number | null;
  eng: number; outlier: number; baseline: string;
  viralScore: number; verdict: 'viral' | 'breakout' | 'normal' | 'under'; headline: string;
  hook: string; hookLabel: string; words: number; lengthBucket: string;
  media: string | null; hashtags: string[]; topics: string[]; durationSec: number | null;
  reasons: string[]; recipe: string[];
};

type ViralResponse = {
  posts: Card_[]; next: string | null; total: number;
  bySource: Record<string, number>; sources: string[];
  filters: { platform: string; days: number; minLift: number };
  corpus: { posts: number; analyzed: number };
  verdicts: { viral: number; breakout: number; normal: number; under: number };
  top: number; generatedAt: number;
};

const PAGE = 20;
const DAYS: { key: string; label: string }[] = [
  { key: '14', label: 'Last 14 days' }, { key: '30', label: 'Last 30 days' },
  { key: '60', label: 'Last 60 days' }, { key: '90', label: 'Last 90 days' },
  { key: '180', label: 'Last 180 days' },
];
const LIFTS: { key: string; label: string }[] = [
  { key: '1.5', label: 'Any hit (1.5×+)' }, { key: '2', label: 'Breakout (2×+)' },
  { key: '3', label: 'Viral (3×+)' }, { key: '5', label: 'Huge (5×+)' },
];

const ago = (d: number) => (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`);

/** One viral post: what it did, why it ranked, and the recipe to imitate. */
function ViralRow({ c, onPlatform }: { c: Card_; onPlatform: (p: string) => void }) {
  const verdictTone = c.verdict === 'viral' ? 'r' : c.verdict === 'breakout' ? 'a' : 'z';
  return (
    <Card className="overflow-hidden">
      <div className="p-4 sm:p-5">
        {/* who / where / when + the score */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          <PlatTag source={c.source} onClick={() => onPlatform(c.source)} />
          {c.author && <span className="font-medium text-foreground/80">@{c.author}</span>}
          {c.authorFollowers ? <span>{num(c.authorFollowers)} followers</span> : null}
          <span aria-hidden="true">·</span>
          <span>{ago(c.ageDays)}</span>
          {c.media && c.media !== 'text' && <><span aria-hidden="true">·</span><span>{c.media}</span></>}
          <span className="ml-auto flex items-center gap-2">
            <Chip tone={verdictTone} title={`${c.outlier}× its baseline`}>{c.headline}</Chip>
            <ViralBadge value={c.viralScore} size="lg" />
          </span>
        </div>

        {/* the post itself */}
        <a href={c.link} target="_blank" rel="noreferrer" title={c.title}
          className="mt-1.5 block text-[15px] font-medium leading-snug text-foreground hover:underline">
          {c.title || '(no text)'}
          <ArrowUpRight className="ml-1 inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden="true" />
        </a>
        {c.body && c.body !== c.title && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{c.body}</p>
        )}

        {/* the numbers */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
          <span title="Weighted engagement: likes + 2×comments + 3×shares + 2×saves"><b className="font-semibold text-foreground">{num(c.eng)}</b> eng</span>
          <span>{num(c.likes)} likes</span>
          <span>{num(c.comments)} comments</span>
          {c.shares != null && <span>{num(c.shares)} shares</span>}
          {c.saves != null && <span>{num(c.saves)} saves</span>}
          {c.views != null && <span>{num(c.views)} views</span>}
        </div>

        {/* why it ranked + the recipe */}
        <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Why it ranked</div>
            <ul className="mt-1 space-y-0.5 text-[12px] leading-relaxed text-foreground/85">
              {c.reasons.map((r, i) => <li key={i} className="flex gap-1.5"><span aria-hidden="true" className="text-muted-foreground/60">—</span><span>{r}</span></li>)}
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Structure to copy</div>
            <ul className="mt-1 space-y-0.5 text-[12px] leading-relaxed text-foreground/85">
              {c.recipe.map((r, i) => <li key={i} className="flex gap-1.5"><span aria-hidden="true" className="text-muted-foreground/60">—</span><span>{r}</span></li>)}
            </ul>
          </div>
        </div>
      </div>

      {/* the action */}
      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2.5 sm:px-5">
        <span className="truncate text-[11px] text-muted-foreground">Copy the shape, write your own words.</span>
        <Link href={`/generate?inspire=${encodeURIComponent(c.id)}&platform=${encodeURIComponent(c.source)}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-85">
          <Sparkles className="size-3.5" aria-hidden="true" /> Make one like this
        </Link>
      </div>
    </Card>
  );
}

export default function Viral() {
  const [plat, setPlat] = useState('');
  const [days, setDays] = useState('60');
  const [minLift, setMinLift] = useState('1.5');
  const [page, setPage] = useState<ViralResponse | null>(null);
  const [rows, setRows] = useState<Card_[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = useMemo(() => {
    const p = new URLSearchParams();
    if (plat) p.set('platform', plat);
    p.set('days', days);
    p.set('minLift', minLift);
    p.set('limit', String(PAGE));
    return '/api/viral?' + p.toString();
  }, [plat, days, minLift]);

  // first page — and again whenever the app asks for a refresh
  useEffect(() => {
    let alive = true;
    const load = () => fetch(base).then(r => r.json()).then(j => {
      if (!alive) return;
      if (j?.error) return;
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

  if (!page) return <div className="py-24 text-center text-muted-foreground">Ranking the corpus…</div>;

  const platforms = PLAT_ORDER.filter(p => page.bySource[p]);
  const v = page.verdicts || { viral: 0, breakout: 0, normal: 0, under: 0 };
  const remaining = Math.max(0, page.total - rows.length);

  return (
    <div className="space-y-4">
      <PageHead
        title="Viral finder"
        sub="The corpus ranked by how many times each post beat its own baseline — its author's usual, the platform's median, or the audience's rate — weighted by recency. Every card says why it ranked."
      />

      <Toolbar>
        <ToolRow>
          <Segmented ariaLabel="Platform" value={plat} onChange={setPlat}
            options={[{ key: '', label: 'All', count: page.total }, ...platforms.map(p => ({ key: p, label: SNAME[p], count: page.bySource[p] }))]} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Sel value={days} onChange={e => setDays(e.target.value)} aria-label="Age window" size="sm" className="w-40">
              {DAYS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </Sel>
            <Sel value={minLift} onChange={e => setMinLift(e.target.value)} aria-label="Minimum lift" size="sm" className="w-40">
              {LIFTS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
            </Sel>
          </div>
        </ToolRow>
      </Toolbar>

      <Stats items={[
        { label: 'Matching posts', value: page.total.toLocaleString('en-US'), hint: `of ${page.corpus.posts.toLocaleString('en-US')} in the corpus` },
        { label: 'Viral', value: v.viral.toLocaleString('en-US'), hint: '3× their baseline or more', title: 'Posts that beat their own baseline by 3× or more' },
        { label: 'Breakouts', value: v.breakout.toLocaleString('en-US'), hint: '2×–3× their baseline' },
        { label: 'Top score', value: page.top ? `${page.top >= 10 ? page.top.toFixed(0) : page.top.toFixed(1)}×` : '—', hint: 'lift, weighted by recency' },
      ]} />

      {!rows.length ? (
        <Card><Empty title="Nothing matches these filters">Widen the age window, lower the minimum lift, or run a collector on Sources.</Empty></Card>
      ) : (
        <div className="space-y-3">
          {rows.map(c => <ViralRow key={c.id} c={c} onPlatform={p => setPlat(p === plat ? '' : p)} />)}
        </div>
      )}

      {remaining > 0 && (
        <div className="flex justify-center pb-2">
          <button onClick={loadMore} disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
            {busy ? <><Loader className="size-4 animate-spin" aria-hidden="true" /> Loading…</> : `Show ${Math.min(PAGE, remaining)} more · ${remaining.toLocaleString('en-US')} left`}
          </button>
        </div>
      )}
    </div>
  );
}
