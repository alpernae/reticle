'use client';
// Recommendations — winning posts (your logged winners + top collected posts)
// ranked by a deterministic scorer. Layout: one toolbar with three labelled
// rows (where the winners come from · which topics · which platform you're
// writing for), then one ranked list. Each row: the post, why it ranks
// (two reasons, more on demand), how to run it on your platform, and the
// numbers + Generate on the right.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHead, btnPrimary } from '@/components/panel';
import { Toolbar, ToolRow, Segmented, FilterChip, PlatTag, Empty, PLAT_ORDER, SNAME, num } from '@/components/kit';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, CircleCheck, Lightbulb } from 'lucide-react';
import { Spinner } from '@/components/panelui/spinner';

type Target = 'x' | 'linkedin' | 'instagram' | 'threads';
type Rec = {
  id: string; kind: 'own' | 'public'; origin: string; originLabel: string; title: string; link: string | null;
  eng: number; engDetail: string; likes: number | null; comments: number | null;
  topics: string[]; whenLabel: string; because: string[];
  fit: Record<Target, string>; score: number; scorePct: number;
};
type Data = { recs: Rec[]; topicOptions: { name: string; fresh: number; pct: number }[]; winnersByPlatform: Record<string, number>; note: string };

const TARGETS: { key: Target; label: string }[] = [
  { key: 'x', label: 'X' }, { key: 'linkedin', label: 'LinkedIn' }, { key: 'instagram', label: 'Instagram' }, { key: 'threads', label: 'Threads' },
];

export default function Recs() {
  const router = useRouter();
  const [topics, setTopics] = useState<string[]>([]);
  const [src, setSrc] = useState('all');
  const [target, setTarget] = useState<Target>('x');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async (t: string[], s: string) => {
    setLoading(true);
    try {
      const q = `topics=${t.map(x => encodeURIComponent(x)).join('|')}&src=${s}`;
      setData(await (await fetch(`/api/recs?${q}`)).json());
    } catch { setData(null); }
    setLoading(false);
  }, []);
  useEffect(() => { load(topics, src); }, [topics, src, load]);
  // picking a writable platform as the source also makes it the target
  useEffect(() => { if (TARGETS.some(t => t.key === src)) setTarget(src as Target); }, [src]);

  const toggleTopic = (name: string) =>
    setTopics(prev => prev.includes(name) ? prev.filter(t => t !== name) : prev.length >= 2 ? [prev[1], name] : [...prev, name]);

  const send = (r: Rec) => {
    const t = TARGETS.find(x => x.key === target)!;
    const body = [
      `WINNER (from ${r.originLabel}, ${r.engDetail}, ${r.whenLabel}):`,
      r.title, r.link || '', '',
      `Why it won: ${r.because.join(' ')}`,
      `Run it as ${t.label}: ${r.fit[target]}`,
    ].join('\n');
    try {
      sessionStorage.setItem('sc-studio-brief', JSON.stringify({ from: 'Recommendations', topic: topics[0] || r.topics[0] || '', text: body.replace(/\n{3,}/g, '\n\n').trim() }));
    } catch {}
    setSent(r.id);
    router.push(`/generate?platform=${target}`);
  };

  const recs = data?.recs || [];
  const own = recs.filter(r => r.kind === 'own').length;

  return (
    <div className="space-y-4">
      <PageHead
        title="Recommendations"
        sub="The posts most worth remaking right now, ranked by engagement on their platform, freshness, proven hooks and trending topics. Every reason is computed from your data."
      />

      <Toolbar>
        <ToolRow label="From">
          <Segmented ariaLabel="Where the winners come from" value={src} onChange={setSrc}
            options={[{ key: 'all', label: 'All platforms' }, ...PLAT_ORDER.map(p => ({ key: p, label: SNAME[p] }))]} />
        </ToolRow>
        <ToolRow label="Topics">
          {loading && !data && <span className="text-[12px] text-muted-foreground">Loading topics…</span>}
          {data?.topicOptions.map(t => (
            <FilterChip key={t.name} on={topics.includes(t.name)} onClick={() => toggleTopic(t.name)} title={`${t.fresh} fresh posts${t.pct > 0 ? `, +${t.pct}% vs the previous 48h` : ''}`}>
              {t.name}<span className="tabular-nums opacity-60">{t.fresh}</span>{t.pct > 0 && <span className="tabular-nums">↑{t.pct}%</span>}
            </FilterChip>
          ))}
          {data && !data.topicOptions.length && <span className="text-[12px] text-muted-foreground">No trending topics yet. Run the collectors on Sources.</span>}
          <span className="ml-auto text-[11px] text-muted-foreground">{topics.length ? <button onClick={() => setTopics([])} className="hover:text-foreground underline">Clear ({topics.length}/2)</button> : 'Pick up to 2'}</span>
        </ToolRow>
        <ToolRow label="Write for">
          <Segmented ariaLabel="Platform you are writing for" value={target} onChange={k => setTarget(k as Target)} size="sm" options={TARGETS} />
          <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">{data ? `${recs.length} ranked${own ? ` · ${own} of yours` : ''}` : ''}</span>
        </ToolRow>
      </Toolbar>

      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Spinner className="size-4" /> Ranking posts…</div>
        ) : data?.note ? (
          <Empty title="Nothing to rank here">{data.note}</Empty>
        ) : !recs.length ? (
          <Empty title="No posts match">{!data?.topicOptions.length ? 'Run the collectors on Sources and log your own posts on Winners.' : 'Loosen the topics or pick another platform.'}</Empty>
        ) : (
          <ol className="divide-y divide-border">
            {recs.map((r, i) => (
              <RecRow key={r.id} r={r} rank={i + 1} target={target} sending={sent === r.id} onSend={() => send(r)} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function RecRow({ r, rank, target, sending, onSend }: { r: Rec; rank: number; target: Target; sending: boolean; onSend: () => void }) {
  const [more, setMore] = useState(false);
  const [fit, setFit] = useState(false);
  const why = more ? r.because : r.because.slice(0, 2);
  const tLabel = TARGETS.find(t => t.key === target)!.label;
  return (
    <li className="grid gap-4 px-4 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_10rem] sm:px-5">
      <div className={`hidden text-xl font-semibold tabular-nums sm:block ${rank <= 3 ? 'text-foreground' : 'text-muted-foreground/50'}`}>{rank}</div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
          <span className="sm:hidden font-semibold text-foreground">#{rank}</span>
          {r.kind === 'own'
            ? <span className="rounded-md bg-foreground px-1.5 py-0.5 text-[11px] font-medium text-background" title="From your logged winners: numbers you measured">Your post</span>
            : SNAME[r.origin] ? <PlatTag source={r.origin} /> : <span>{r.originLabel}</span>}
          <span aria-hidden="true">·</span><span>{r.whenLabel}</span>
        </div>

        <p className={`mt-1.5 text-[15px] font-medium leading-snug ${r.link ? '' : 'whitespace-pre-line'}`}>
          {r.link ? <Link href={r.link} target="_blank" rel="noreferrer" className="hover:underline">{r.title}</Link> : r.title}
        </p>
        {r.topics.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">{r.topics.slice(0, 3).map(t => <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t}</span>)}</div>
        )}

        <ul className="mt-3 space-y-1">
          {why.map((b, k) => (
            <li key={k} className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden="true" /><span>{b}</span>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {r.because.length > 2 && (
            <button onClick={() => setMore(v => !v)} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
              <ChevronDown className={`size-3.5 transition-transform ${more ? 'rotate-180' : ''}`} aria-hidden="true" />{more ? 'Fewer reasons' : `${r.because.length - 2} more reason${r.because.length - 2 === 1 ? '' : 's'}`}
            </button>
          )}
          <button onClick={() => setFit(v => !v)} aria-expanded={fit} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
            <Lightbulb className="size-3.5" aria-hidden="true" /> How to run it on {tLabel}
          </button>
        </div>
        {fit && <p className="mt-2 rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] leading-relaxed">{r.fit[target]}</p>}
      </div>

      <div className="flex flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
        <div className="sm:text-right">
          <div className="text-2xl font-semibold tabular-nums tracking-tight">{num(r.eng)}</div>
          <div className="text-[11px] text-muted-foreground" title="Engagement = likes + 2 × comments">
            {r.likes != null ? `${num(r.likes)} likes · ${num(r.comments)} comments` : 'engagement you logged'}
          </div>
          <div className="mt-2 flex items-center gap-2 sm:justify-end" title={`Ranking score: ${r.scorePct}% of the #1 recommendation`}>
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground" style={{ width: `${r.scorePct}%` }} /></span>
            <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{r.scorePct}%</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onSend} className={btnPrimary + ' h-8 px-3 text-xs'} aria-label={`Write a ${tLabel} post from this`}>
            {sending ? <Check className="size-3.5" aria-hidden="true" /> : <ArrowRight className="size-3.5" aria-hidden="true" />}
            {sending ? 'Opening…' : 'Generate'}
          </button>
          {r.link && (
            <Link href={r.link} target="_blank" rel="noreferrer" aria-label="Open original post"
              className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
