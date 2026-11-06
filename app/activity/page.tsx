'use client';
// Activity — everything the AI has done for you: Generate, Toolkit, Formats,
// briefs, the categorizer, Workflows, Automations and Mind maps. Live status,
// the steps it went through (drawn as a pipeline on a PanelUI Flow canvas),
// which provider/model answered, how long it took and its full result.
// Start something, go do other work, come back here to pick it up.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHead, btn, btnPrimary } from '@/components/panel';
import { Toolbar, ToolRow, Segmented, Stats, Tabs, Empty } from '@/components/kit';
import { RunFlow } from '@/components/run-flow';
import { FitBadge } from '@/components/fit-badge';
import { TOOLS } from '@/lib/tools';
import { QUICK_FORMATS } from '@/lib/formats';
import { QuickPostCard } from '@/components/code-shot';
import { FirstReply, LengthBadge } from '@/components/length-info';
import { Check, Copy, Square, Trash2, ArrowUpRight, X as XIcon, CircleCheck, CircleX, CircleSlash, CircleDashed, Pause, Search } from 'lucide-react';
import { Sel } from '@/components/sel';
import { Spinner } from '@/components/panelui/spinner';

type Step = { label: string; at: number; state: string };
type Run = {
  id: string; kind: string; title: string; page: string; platform: string; status: string; steps: Step[];
  provider: string; model: string; error: string; created: number; finished: number | null; ms: number | null;
};
type Detail = { run: Run & { input?: any; output?: any }; job?: { result: string } };

const KIND: Record<string, string> = {
  generate: 'Generate', tool: 'Toolkit', 'format-quick': 'Quick posts', 'format-polish': 'Series polish',
  brief: 'AI brief', categorize: 'Categorize', workflow: 'Workflow', refine: 'Polish', automation: 'Automation', mindmap: 'Mind map',
};
const ACTIVE = new Set(['running', 'queued', 'paused']);
const FAILED = ['failed', 'cancelled', 'stopped', 'interrupted'];
const FILTERS: { key: string; label: string; match: (r: Run) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'active', label: 'Running', match: r => ACTIVE.has(r.status) },
  { key: 'done', label: 'Done', match: r => r.status === 'done' },
  { key: 'problems', label: 'Failed', match: r => FAILED.includes(r.status) },
];

const dur = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
const when = (t: number) => {
  const d = new Date(t), today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const dayLabel = (t: number) => {
  const d = new Date(t); const today = new Date(); const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};

function StatusIcon({ s }: { s: string }) {
  if (s === 'running' || s === 'queued') return <Spinner className="size-4" label={s} />;
  if (s === 'paused') return <Pause className="size-4" aria-label="paused" />;
  if (s === 'done') return <CircleCheck className="size-4" aria-label="done" />;
  if (s === 'failed') return <CircleX className="size-4" aria-label="failed" />;
  if (s === 'cancelled' || s === 'stopped') return <CircleSlash className="size-4 text-muted-foreground" aria-label={s} />;
  return <CircleDashed className="size-4 text-muted-foreground" aria-label={s} />;
}
function StatusPill({ s }: { s: string }) {
  const tone = s === 'done' ? 'bg-foreground text-background' : ACTIVE.has(s) ? 'border border-foreground text-foreground' : 'bg-muted text-muted-foreground';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{ACTIVE.has(s) && <span className="size-1.5 animate-pulse rounded-full bg-foreground" />}{s}</span>;
}

export default function Activity() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try { const j = await fetch('/api/activity').then(r => r.json()); setRuns(j.runs || []); } catch {}
  }, []);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get('id');
    if (id) setSel(id);
    if (sp.get('filter') && FILTERS.some(f => f.key === sp.get('filter'))) setFilter(sp.get('filter')!);
    load();
  }, [load]);
  const anyActive = !!runs?.some(r => ACTIVE.has(r.status));
  useEffect(() => { const t = setInterval(load, anyActive ? 2000 : 10000); return () => clearInterval(t); }, [load, anyActive]);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // open the newest run when nothing is picked, so the right side is never empty
  useEffect(() => { if (!sel && runs?.length && window.innerWidth >= 1280) setSel(runs[0].id); }, [runs, sel]);

  const selRun = runs?.find(r => r.id === sel) || null;
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    fetch('/api/activity?id=' + encodeURIComponent(sel)).then(r => r.json()).then(j => setDetail(j.run ? j : null)).catch(() => {});
    const u = new URL(window.location.href); u.searchParams.set('id', sel); window.history.replaceState(null, '', u);
  }, [sel, selRun?.status, selRun?.steps.length]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (runs || []).filter(r => (FILTERS.find(f => f.key === filter) || FILTERS[0]).match(r) && (!kind || r.kind === kind) && (!s || r.title.toLowerCase().includes(s)));
  }, [runs, filter, kind, q]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.key, (runs || []).filter(f.match).length])), [runs]);
  const kinds = useMemo(() => [...new Set((runs || []).map(r => r.kind))], [runs]);

  // stats
  // `now` is 0 until mounted, so nothing time-based runs during prerender
  const dayStart = now ? new Date(now).setHours(0, 0, 0, 0) : 0;
  const today = now ? (runs || []).filter(r => r.created >= dayStart) : [];
  const week = now ? (runs || []).filter(r => r.created >= now - 7 * 864e5 && !ACTIVE.has(r.status)) : [];
  const times = week.filter(r => r.status === 'done' && r.ms).map(r => r.ms!).sort((a, b) => a - b);
  const okPct = week.length ? Math.round((week.filter(r => r.status === 'done').length / week.length) * 100) : null;

  const act = async (action: 'cancel' | 'delete', id: string) => {
    await fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }) }).catch(() => {});
    if (action === 'delete' && sel === id) setSel(null);
    load();
  };
  const clear = async () => { await fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear' }) }); setSel(null); load(); };
  const close = () => { setSel(null); const u = new URL(window.location.href); u.searchParams.delete('id'); window.history.replaceState(null, '', u); };

  // group the list by day
  const groups: { day: string; items: Run[] }[] = [];
  for (const r of shown) { const d = dayLabel(r.created); const g = groups[groups.length - 1]; if (g?.day === d) g.items.push(r); else groups.push({ day: d, items: [r] }); }

  return (
    <div className="space-y-4">
      <PageHead title="Activity" sub="Every AI run you start: drafts, toolkit, formats, briefs, workflows, automations and mind maps. Start something, switch to other work, come back here for the result."
        right={<button onClick={clear} className={btn + ' h-8 px-3 text-xs'} title="Remove finished, failed and cancelled runs (Workflows are kept — delete them one by one)"><Trash2 className="size-3.5" aria-hidden="true" /> Clear finished</button>} />

      <Stats items={[
        { label: 'Running now', value: counts.active ?? 0, hint: counts.active ? 'live below' : 'nothing in progress' },
        { label: 'Today', value: today.length, hint: `${today.filter(r => r.status === 'done').length} done` },
        { label: 'Success, 7 days', value: okPct == null ? '—' : `${okPct}%`, hint: `${week.length} finished runs` },
        { label: 'Typical run', value: times.length ? dur(times[times.length >> 1]) : '—', hint: 'median, successful runs' },
      ]} />

      <Toolbar>
        <ToolRow>
          <Segmented ariaLabel="Status" value={filter} onChange={setFilter} options={FILTERS.map(f => ({ key: f.key, label: f.label, count: counts[f.key] ?? 0 }))} />
          <Sel aria-label="Feature" value={kind} onChange={e => setKind(e.target.value)} size="sm" className="w-44">
            <option value="">All features</option>
            {kinds.map(k => <option key={k} value={k}>{KIND[k] || k}</option>)}
          </Sel>
          <div className="relative ml-auto w-full sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search runs" aria-label="Search runs"
              className="h-8 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground/40" />
          </div>
        </ToolRow>
      </Toolbar>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(320px,400px)_1fr]">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {runs === null ? <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
            : !shown.length ? <Empty title={runs.length ? 'Nothing matches' : 'No AI runs yet'}>{runs.length ? 'Change the filters above.' : 'Generate something, run a workflow or an automation, and it shows up here.'}</Empty>
            : (
              <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
                {groups.map(g => (
                  <div key={g.day}>
                    <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">{g.day}</div>
                    <ul className="divide-y divide-border">
                      {g.items.map(r => {
                        const active = ACTIVE.has(r.status);
                        const elapsed = active ? (now || Date.now()) - r.created : r.ms ?? (r.finished ? r.finished - r.created : 0);
                        const cur = r.steps.filter(s => s.state === 'active').pop();
                        const done = r.steps.filter(s => s.state === 'done').length;
                        return (
                          <li key={r.id}>
                            <button onClick={() => setSel(r.id)} className={`flex w-full gap-3 px-4 py-3 text-left ${sel === r.id ? 'bg-muted' : 'hover:bg-muted/50'}`}>
                              <span className="mt-0.5"><StatusIcon s={r.status} /></span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">{r.title}</span>
                                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                  {KIND[r.kind] || r.kind} · {when(r.created)}{r.model ? ` · ${r.model.split('/').pop()}` : ''}
                                </span>
                                {active && (
                                  <span className="mt-1.5 flex items-center gap-2">
                                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground transition-all" style={{ width: `${Math.max(8, (done / Math.max(1, r.steps.length)) * 100)}%` }} /></span>
                                    <span className="max-w-[55%] truncate text-[11px]">{cur?.label || 'starting'}</span>
                                  </span>
                                )}
                                {!active && r.error && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{r.error}</span>}
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{elapsed ? dur(elapsed) : ''}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
        </div>

        <div className="xl:sticky xl:top-20">
          {!sel || !selRun
            ? <div className="rounded-xl border border-border bg-card"><Empty title="Pick a run">Its pipeline, what you asked for and the full result appear here.</Empty></div>
            : <RunDetail run={selRun} detail={detail} now={now} onCancel={() => act('cancel', selRun.id)} onDelete={() => act('delete', selRun.id)} onClose={close} />}
        </div>
      </div>
    </div>
  );
}

function RunDetail({ run, detail, now, onCancel, onDelete, onClose }: { run: Run; detail: Detail | null; now: number; onCancel: () => void; onDelete: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<'result' | 'input'>('result');
  const active = ACTIVE.has(run.status);
  const out = detail?.run.output;
  const openHref = run.kind === 'generate' ? `/generate?run=${run.id}` : run.kind === 'tool' ? `${run.page}&run=${run.id}` : run.page;
  const fields = detail?.run.input && typeof detail.run.input === 'object' ? askedFor(run.kind, detail.run.input) : [];
  const main = fields.find(([l]) => /idea|topic|angle|their post|original post|draft|step 1/i.test(l)) || fields[0];
  const inputLabel = main?.[1]?.slice(0, 70) || KIND[run.kind] || run.kind;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill s={run.status} />
            <span className="text-[12px] text-muted-foreground">{KIND[run.kind] || run.kind}</span>
            <span className="text-[12px] tabular-nums text-muted-foreground">· {active ? `${dur((now || Date.now()) - run.created)} so far` : run.ms != null ? `took ${dur(run.ms)}` : ''}</span>
          </div>
          <h2 className="mt-1.5 text-[15px] font-semibold leading-snug">{run.title}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Started {new Date(run.created).toLocaleString()}{run.provider ? ` · ${run.provider}${run.model ? ' · ' + run.model : ''}` : ''}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {active && <button onClick={onCancel} className={btn + ' h-8 px-3 text-xs'}><Square className="size-3.5" aria-hidden="true" /> {run.kind === 'workflow' ? 'Stop' : 'Cancel'}</button>}
          {!active && run.page && <Link href={openHref} className={btnPrimary + ' h-8 px-3 text-xs'}><ArrowUpRight className="size-3.5" aria-hidden="true" /> Open in {KIND[run.kind] || 'page'}</Link>}
          {!active && <button onClick={onDelete} className={btn + ' h-8 px-2.5'} aria-label="Delete run" title="Delete run"><Trash2 className="size-3.5" aria-hidden="true" /></button>}
          <button onClick={onClose} className={btn + ' h-8 px-2.5'} aria-label="Close"><XIcon className="size-4" aria-hidden="true" /></button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <RunFlow steps={run.steps} status={run.status} created={run.created} finished={run.finished} now={now || Date.now()} inputLabel={inputLabel} />
        {run.error && <div className="rounded-lg border border-border px-3 py-2 text-[12px]"><b>{run.status === 'cancelled' ? 'Cancelled' : 'Problem'}:</b> {run.error}</div>}

        <Tabs value={tab} onChange={k => setTab(k as 'result' | 'input')} tabs={[{ key: 'result', label: 'Result' }, { key: 'input', label: 'What you asked', count: fields.length || null }]} />
        {tab === 'input'
          ? (fields.length ? (
            <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-[13px]">
              {fields.map(([label, v]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{v.slice(0, 1200)}</dd></div>)}
            </dl>
          ) : <p className="text-[13px] text-muted-foreground">No inputs recorded for this run.</p>)
          : active ? <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Spinner className="size-4" /> Still working. You can leave this page; the result is saved here when it finishes.</p>
          : <Output kind={run.kind} out={out} job={detail?.job} platform={run.platform} />}
      </div>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button className={btn + ' h-7 px-2.5 text-[11px]'} onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>{ok ? <><Check className="size-3" aria-hidden="true" /> Copied</> : <><Copy className="size-3" aria-hidden="true" /> Copy</>}</button>;
}
function TextBlock({ text, title, fit, platform, firstReply }: { text: string; title?: string; fit?: any; platform?: string; firstReply?: string }) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      {title && <div className="text-[12px] font-semibold">{title}</div>}
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{text}</p>
      <FirstReply link={firstReply} />
      <div className="flex items-center gap-2"><CopyBtn text={text} /><FitBadge fit={fit} />{platform && <span className="ml-auto"><LengthBadge platform={platform} text={text} /></span>}</div>
    </div>
  );
}

function Output({ kind, out, job, platform }: { kind: string; out: any; job?: { result: string }; platform?: string }) {
  if (kind === 'automation' && out && Array.isArray(out.steps)) return (
    <div className="space-y-3">
      {out.steps.map((s: any, i: number) => <TextBlock key={i} title={`Step ${i + 1} · ${s.label}`} text={s.text} />)}
      {out.automation && <Link href={`/automations?id=${out.automation}`} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">Edit this automation <ArrowUpRight className="size-3.5" aria-hidden="true" /></Link>}
    </div>
  );
  if (kind === 'mindmap' && out && Array.isArray(out.ideas)) return <ul className="space-y-1.5 text-[13px]">{out.ideas.map((x: any, i: number) => <li key={i} className="rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground">{x.kind}</span> · {x.text}</li>)}</ul>;
  if (kind === 'workflow') return job?.result ? <TextBlock text={job.result} title="Result" /> : <p className="text-[13px] text-muted-foreground">No result.</p>;
  if (!out || typeof out !== 'object') return <p className="text-[13px] text-muted-foreground">No saved result.</p>;
  if (kind === 'generate') return (
    <div className="space-y-3">
      {out.insight && <TextBlock text={out.insight} title="Pattern being borrowed" />}
      {(out.variants || []).map((v: any, i: number) => <TextBlock key={i} title={`Variant ${i + 1} — ${v.angle || ''}`} text={v.text + (v.hashtags?.length ? '\n\n' + v.hashtags.join(' ') : '')} fit={v.fit} platform={platform} firstReply={v.firstReply} />)}
    </div>
  );
  if (kind === 'format-quick') return (
    <div className="grid md:grid-cols-2 gap-2">
      {(out.posts || []).map((p: string, i: number) => <QuickPostCard key={i} raw={p} idx={i} fit={out.fits?.[i]} saved={false} onSave={() => {}} />)}
    </div>
  );
  if (out.slides) return <div className="space-y-2">{out.slides.map((s: any, i: number) => <TextBlock key={i} title={`Slide ${i + 1}: ${s.title}`} text={s.body} />)}<p className="text-[11px] text-muted-foreground">Open in Toolkit to render these slides as images.</p></div>;
  if (out.items) return <div className="space-y-2">{out.items.map((t: string, i: number) => <TextBlock key={i} text={t} fit={out.fits?.[i]} platform={out.tool && ['caption', 'pinned', 'repurpose', 'replies'].includes(out.tool) ? platform : undefined} firstReply={out.lengths?.[i]?.firstReply} />)}</div>;
  if (typeof out.text === 'string') return <TextBlock text={out.text} fit={out.fit} title={kind === 'brief' ? 'Brief' : undefined} platform={kind === 'refine' ? platform : undefined} firstReply={out.firstReply} />;
  if (kind === 'categorize') return <p className="text-[13px]">Sorted <b>{out.done ?? 0}</b> posts · {out.remaining ?? 0} still uncategorized.</p>;
  if (out.error) return <p className="text-[13px] text-muted-foreground">{out.error}</p>;
  return <pre className="text-[11px] whitespace-pre-wrap rounded-lg bg-muted p-3 overflow-x-auto">{JSON.stringify(out, null, 2).slice(0, 8000)}</pre>;
}

/** The inputs that actually belong to this run, with readable labels.
 *  Toolkit runs show only their tool's own fields (older runs could carry stray
 *  fields from another tool); other features show their known inputs. */
const INPUT_LABELS: Record<string, string> = {
  platform: 'Platform', format: 'Format', idea: 'Your idea', topic: 'Topic', tone: 'Tone', notes: 'Notes', postRef: 'Borrowed structure from',
  text: 'Draft', instruction: 'What to change', brief: 'Your original brief', count: 'How many', audience: 'Audience', posts: 'Posts analysed', left: 'Uncategorized posts',
};
function askedFor(kind: string, input: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  if (kind === 'tool') {
    const tool = TOOLS.find(t => t.key === input.tool);
    if (!tool) return out;
    for (const f of tool.fields) {
      const v = str(input[f.key]);
      if (!v.trim()) continue;
      out.push([f.label, f.kind === 'select' ? (f.options?.find(o => o.value === v)?.label || v) : v]);
    }
    return out;
  }
  if (kind === 'automation') {
    if (input.trigger) out.push(['Started by', input.trigger === 'schedule' ? 'its schedule' : 'you (Run now)']);
    (Array.isArray(input.steps) ? input.steps : []).forEach((st: any, i: number) => out.push([`Step ${i + 1}: ${st.worker}`, String(st.prompt || '(no prompt)')]));
    return out;
  }
  if (kind === 'format-quick') {
    const fmt = QUICK_FORMATS.find(f => f.key === input.format);
    if (fmt) out.push(['Format', fmt.name]);
    for (const k of ['audience', 'platform', 'count', 'idea'] as const) { const v = str(input[k]); if (v.trim()) out.push([k === 'idea' ? 'Angle' : INPUT_LABELS[k] || k, v]); }
    return out;
  }
  for (const [k, v] of Object.entries(input)) {
    if (k === 'model' || k === 'mode' || typeof v === 'object') continue;
    const s = str(v);
    if (s.trim()) out.push([INPUT_LABELS[k] || k, s]);
  }
  return out;
}
