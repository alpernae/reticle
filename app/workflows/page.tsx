'use client';
// Studio — async AI agent runs. Launch agents as background jobs, watch their
// step-by-step process live, pause/resume/stop mid-run, and send finished
// results to the Generate page. All state comes from /api/jobs polling.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHead, Chip, PageHead, useApiState, btn, btnPrimary, inputCls, labelCls, AGO } from '@/components/panel';
import {
  Bot, Telescope, Crosshair, CalendarDays, ScanEye, Microscope, Play, Pause, Square,
  Trash2, Check, X, Minus, Copy, ArrowUpRight,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { Sel } from '@/components/sel';
import { Spinner } from '@/components/panelui/spinner';

const selCls = inputCls;

type Step = { name: string; label: string; state: 'pending' | 'active' | 'done' | 'failed' | 'skipped'; note?: string; dur?: number };
type Job = {
  id: string; kind: string; topic: string; platform: string; model?: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'stopped' | 'interrupted';
  steps: Step[]; result: string; err: string;
  created: number; started: number | null; finished: number | null;
};
type CatalogItem = { kind: string; name: string; tagline: string; explain?: string; stepLabels?: string[]; needsAccount?: boolean; needsWinners?: boolean; steps: number };

const KIND_ICON: Record<string, ComponentType<{ className?: string }>> = {
  dive: Telescope, hooks: Crosshair, calendar: CalendarDays, rival: ScanEye, autopsy: Microscope,
};

const STATUS_CHIP: Record<Job['status'], { tone: 'z' | 'g' | 'r' | 'a'; label: string; title?: string }> = {
  running: { tone: 'g', label: 'running' },
  queued: { tone: 'a', label: 'queued' },
  paused: { tone: 'r', label: 'paused', title: 'holds after the current AI call finishes — Resume to continue' },
  done: { tone: 'z', label: 'done' },
  failed: { tone: 'r', label: 'failed' },
  stopped: { tone: 'a', label: 'stopped' },
  interrupted: { tone: 'a', label: 'interrupted', title: 'the dev server restarted mid-run — delete and re-run' },
};

const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);

function StepRow({ s }: { s: Step }) {
  const icon = (() => {
    switch (s.state) {
      case 'active': return <Spinner className="size-3.5 text-foreground" />;
      case 'done': return <Check className="size-3.5 text-foreground" aria-hidden="true" />;
      case 'failed': return <X className="size-3.5 text-foreground" aria-hidden="true" />;
      case 'skipped': return <Minus className="size-3.5 text-muted-foreground" aria-hidden="true" />;
      default: return <span className="block size-2 rounded-full border border-border" aria-hidden="true" />;
    }
  })();
  return (
    <div className="flex items-baseline gap-3">
      <span className="grid size-5 shrink-0 place-items-center self-center">{icon}</span>
      <span className={`text-sm shrink-0 ${s.state === 'pending' || s.state === 'skipped' ? 'text-muted-foreground' : 'text-foreground font-medium'}`}>{s.label}</span>
      {s.note && <span className="text-[11px] text-muted-foreground truncate">{s.note}</span>}
      {typeof s.dur === 'number' && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground shrink-0">{s.dur}s</span>}
    </div>
  );
}

export default function Studio() {
  const router = useRouter();
  const { data: d } = useApiState();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [kind, setKind] = useState('dive');
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState('x');
  const [model, setModel] = useState('');
  const [showHow, setShowHow] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchErr, setLaunchErr] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const j = await (await fetch('/api/jobs')).json();
      setCatalog(j.catalog || []);
      setJobs(j.jobs || []);
    } catch { /* transient — next tick retries */ }
  }, []);

  useEffect(() => { poll(); const t = setInterval(poll, 1500); return () => clearInterval(t); }, [poll]);
  useEffect(() => { if (!topic && d?.topics?.length) setTopic(d.topics.find((t: any) => t.fresh > 0)?.name || ''); }, [d?.topics?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = catalog.find(c => c.kind === kind);
  const winnersCount = d?.manual?.length || 0;
  const blocked = def?.needsWinners && !winnersCount;
  const active = (jobs || []).filter(j => ['queued', 'running', 'paused'].includes(j.status));

  const launch = async () => {
    setLaunching(true); setLaunchErr('');
    try {
      const r = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, topic, platform, model: pickedModel(model) }) });
      const j = await r.json();
      if (j.error) setLaunchErr(j.error);
    } catch (e: any) { setLaunchErr(e.message); }
    setLaunching(false);
    poll();
  };
  const act = async (id: string, action: string) => { await fetch(`/api/jobs/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => {}); poll(); };
  const del = async (id: string) => { await fetch(`/api/jobs/${id}`, { method: 'DELETE' }).catch(() => {}); poll(); };

  const stageBrief = (job: Job) => {
    try { sessionStorage.setItem('sc-studio-brief', JSON.stringify({ from: catalog.find(c => c.kind === job.kind)?.name || job.kind, topic: job.topic, text: job.result })); } catch {}
    router.push('/generate');
  };
  const copy = (t: string, id: string) => { navigator.clipboard.writeText(t); setCopied(id); setTimeout(() => setCopied(null), 1800); };

  const headChip = (() => {
    const r = active.filter(j => j.status === 'running').length, p = active.filter(j => j.status === 'paused').length, q = active.filter(j => j.status === 'queued').length;
    const parts = [r && `${r} running`, p && `${p} paused`, q && `${q} queued`].filter(Boolean);
    return parts.length ? <Chip tone="g">{parts.join(' · ')}</Chip> : <Chip tone="a">idle</Chip>;
  })();

  return (
    <div>
      <div className="space-y-5">
        <PageHead
          title="Workflows"
          sub="Multi-step AI jobs that run in the background. Each step is one AI call that builds on the previous one — you watch them land, can pause or stop, and send the result to Generate."
          right={headChip}
        />

        {/* ---- how it works ---- */}
        <Card>
          <button type="button" onClick={() => setShowHow(v => !v)} className="w-full text-left px-5 py-3.5 flex items-center justify-between gap-3">
            <span>
              <span className="text-[13px] font-semibold tracking-wide uppercase">How workflows work</span>
              <span className="block text-xs text-muted-foreground mt-0.5">Generate = one AI call, 3 drafts. An agent = a chain of calls that research → decide → write. Slower, deeper.</span>
            </span>
            <span className="text-xs text-muted-foreground shrink-0">{showHow ? 'hide' : 'show'}</span>
          </button>
          {showHow && (
            <div className="px-5 pb-5 space-y-4 text-[13px] leading-relaxed">
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li><b className="text-foreground">Pick an agent, a topic and a platform.</b> Every agent reads the same data digest: your outlier winners, the pattern table, recycled posts, rising topics and best hours — plus your creator profile.</li>
                <li><b className="text-foreground">Pick a provider & model</b> (or Auto = the order on Settings). Opus is best for the final writing step, Sonnet/Haiku are faster for research steps.</li>
                <li><b className="text-foreground">It runs in the background.</b> Each step is one AI call; its output feeds the next step. You can leave the page — progress is saved in SQLite.</li>
                <li><b className="text-foreground">Pause</b> holds after the current call, <b className="text-foreground">Stop</b> aborts it. Restarting the dev server marks running jobs “interrupted”.</li>
                <li><b className="text-foreground">Send to Generate</b> loads the result into Generate’s notes so you can turn it into 3 platform-ready posts.</li>
              </ol>
              <div className="grid md:grid-cols-2 gap-3">
                {catalog.map(a => (
                  <div key={a.kind} className="rounded-lg border border-border p-3">
                    <div className="font-semibold">{a.name}</div>
                    <p className="text-muted-foreground text-[12px] mt-1">{a.explain || a.tagline}</p>
                    {a.stepLabels?.length ? <p className="text-[11px] mt-1.5"><span className="text-muted-foreground">steps:</span> {a.stepLabels.join(' → ')}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* ---- launch ---- */}
        <Card>
          <CardHead title="Launch an agent" sub="each agent runs as a sequence of transparent AI steps, logged to SQLite" />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
              {(catalog.length ? catalog : [{ kind: 'dive' }, { kind: 'hooks' }, { kind: 'calendar' }, { kind: 'rival' }, { kind: 'autopsy' }] as CatalogItem[]).map(a => {
                const Icon = KIND_ICON[a.kind] || Bot;
                const sel = a.kind === kind;
                return (
                  <button key={a.kind} type="button" onClick={() => setKind(a.kind)} aria-pressed={sel}
                    title={a.tagline || undefined}
                    className={`text-left rounded-lg border p-3 transition-colors ${sel ? 'bg-primary text-primary-foreground border-transparent font-medium' : 'border-border bg-card text-foreground hover:bg-muted'}`}>
                    <Icon className="size-4 mb-1.5" aria-hidden="true" />
                    <div className="text-[13px] leading-tight">{a.name || a.kind}</div>
                    {a.tagline && <div className={`text-[11px] mt-0.5 leading-snug ${sel ? 'opacity-75' : 'text-muted-foreground'}`}>{a.tagline}</div>}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_170px_260px_auto] gap-3 items-end">
              <div>
                <label className={labelCls} htmlFor="j-topic">Topic</label>
                <input id="j-topic" className={selCls} placeholder="e.g. AI & LLMs — or anything" value={topic} onChange={e => setTopic(e.target.value)} list="j-topics" />
                <datalist id="j-topics">{(d?.topics || []).filter((t: any) => t.fresh > 0).map((t: any) => <option key={t.name} value={t.name} />)}</datalist>
              </div>
              <div>
                <label className={labelCls} htmlFor="j-platform">Platform</label>
                <Sel id="j-platform" className={selCls} value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="x">X / Twitter</option><option value="linkedin">LinkedIn</option><option value="instagram">Instagram</option><option value="threads">Threads</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option>
                </Sel>
              </div>
              <ModelPicker value={model} onChange={setModel} />
              <button onClick={launch} disabled={launching || blocked || !def} className={btnPrimary} title={blocked ? 'log a result on the Winners page first' : undefined}>
                {launching ? <Spinner className="size-4" /> : <Play className="size-4" aria-hidden="true" />}
                Run agent
              </button>
            </div>
            {launchErr && <Chip tone="r">{launchErr}</Chip>}
            {def?.needsWinners && !winnersCount && <p className="text-[11px] text-muted-foreground"> Winners autopsy needs at least one stored result — Generate saves its outputs to Winners automatically.</p>}
          </div>
        </Card>
      </div>

      {/* ---- runs ---- */}
      <div className="mt-10 space-y-4">
        <h2 className="text-[13px] font-semibold tracking-wide uppercase text-muted-foreground">Workflow runs</h2>
        {jobs === null && <Card><div className="p-6 text-sm text-muted-foreground">Loading runs…</div></Card>}
        {jobs?.length === 0 && (
          <Card><div className="py-14 text-center text-muted-foreground">
            <Bot className="size-7 mx-auto mb-3 text-foreground/40" aria-hidden="true" />
            <b className="text-foreground font-semibold">No agent runs yet</b>
            <p className="text-sm mt-1">Pick an agent above and hit Run — it appears here the moment it queues, and you can watch every step.</p>
          </div></Card>
        )}
        {(jobs || []).map(job => {
          const Icon = KIND_ICON[job.kind] || Bot;
          const chip = STATUS_CHIP[job.status] || STATUS_CHIP.stopped;
          const elapsed = (() => {
            const end = job.finished || Date.now();
            const t0 = job.started || job.created;
            const s = Math.max(0, (end - t0) / 1000);
            return job.finished ? (job.started ? `finished · ${fmtDur(s)} total` : `finished · ${AGO(job.finished)} ago`) : `${fmtDur(s)} elapsed`;
          })();
          const isActive = ['queued', 'running', 'paused'].includes(job.status);
          return (
            <Card key={job.id}>
              <CardHead
                title={catalog.find(c => c.kind === job.kind)?.name || job.kind}
                sub={`${job.topic || 'auto topic'} · ${job.platform} · ${job.model ? job.model.replace('|', ' · ') : 'auto model'} · ${elapsed}`}
                right={
                  <div className="flex items-center gap-2">
                    <Chip tone={chip.tone} title={chip.title}>{chip.label}</Chip>
                    {job.status === 'running' && <button onClick={() => act(job.id, 'pause')} className={btn + ' px-2.5'} title="Pause after the current AI call" aria-label="pause job"><Pause className="size-4" aria-hidden="true" /></button>}
                    {job.status === 'paused' && <button onClick={() => act(job.id, 'resume')} className={btn + ' px-2.5'} title="Resume" aria-label="resume job"><Play className="size-4" aria-hidden="true" /></button>}
                    {isActive && <button onClick={() => act(job.id, 'stop')} className={btn + ' px-2.5'} title="Stop — aborts the current AI call" aria-label="stop job"><Square className="size-4" aria-hidden="true" /></button>}
                    {!isActive && <button onClick={() => del(job.id)} className={btn + ' px-2.5'} title="Delete run" aria-label="delete job"><Trash2 className="size-4" aria-hidden="true" /></button>}
                  </div>
                }
              />
              <div className="px-5 py-4 space-y-2.5">
                {job.steps.map(s => <StepRow key={s.name} s={s} />)}
              </div>
              {job.err && (
                <div className="mx-5 mb-4 px-3 py-2.5 rounded-lg border border-border text-xs text-muted-foreground">
                  <b className="text-foreground font-semibold">{chip.label === 'interrupted' ? 'Interrupted' : 'Failed'}:</b> {job.err}
                </div>
              )}
              {job.status === 'done' && job.result && (
                <div className="border-t border-border px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <Chip tone="z">result</Chip>
                    <div className="flex gap-2">
                      <button onClick={() => stageBrief(job)} className={btn + ' h-8 px-3 text-xs'} aria-label="send result to generate">
                        <ArrowUpRight className="size-3.5" aria-hidden="true" /> Send to Generate
                      </button>
                      <button onClick={() => copy(job.result, job.id)} className={btn + ' h-8 px-3 text-xs'}>
                        {copied === job.id ? <><Check className="size-3.5" aria-hidden="true" /> Copied</> : <><Copy className="size-3.5" aria-hidden="true" /> Copy</>}
                      </button>
                    </div>
                  </div>
                  <pre className="font-sans whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{job.result}</pre>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
