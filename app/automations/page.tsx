'use client';
// Automations — scheduled AI pipelines. Each automation is a chain of steps;
// a step calls a worker (Generate, a Toolkit tool, a Workflow agent, your own
// prompt, or a collector) for a platform, with your prompt and model, and can
// take the previous step's output. Run it by hand or on a schedule (once,
// daily, weekly, every N hours). The chain is drawn on a PanelUI Flow canvas;
// click a step there to edit it. Every run lands on Activity.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHead, btn, btnPrimary, inputCls, notifyActivity } from '@/components/panel';
import { Segmented, FilterChip, Stats, Empty, SNAME, PLAT_ORDER } from '@/components/kit';
import { Flow } from '@/components/panelui/flow';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { Sel } from '@/components/sel';
import { Spinner } from '@/components/panelui/spinner';
import { toast } from '@/components/toaster';
import { DAY_SHORT, describeSchedule, nextRunOf, untilText, type Schedule } from '@/lib/schedule';
import { ArrowDown, ArrowUp, ArrowUpRight, CalendarClock, Clock, Play, Plus, Power, Save, Trash2, X as XIcon } from 'lucide-react';

type Worker = 'generate' | 'tool' | 'agent' | 'prompt' | 'collect';
type Step = { id: string; worker: Worker; platform: string; prompt: string; usePrev: boolean; tool?: string; agent?: string; format?: string; tone?: string; withData?: boolean; model?: { providerID: string; id: string } | null };
type RunRec = { at: number; status: string; runId: string; ms: number | null; error?: string; trigger: string };
type Auto = { id: string; name: string; description: string; enabled: boolean; steps: Step[]; schedule: Schedule; nextRun: number | null; lastRun: number | null; history: RunRec[]; running?: boolean };
type Catalog = {
  workers: { key: Worker; label: string; hint: string }[];
  tools: { key: string; name: string; platforms: string[]; field: string }[];
  agents: { kind: string; name: string; tagline: string }[];
  formats: Record<string, { key: string; label: string }[]>;
};
type Draft = Omit<Auto, 'id' | 'nextRun' | 'lastRun' | 'history'> & { id?: string };

const sid = () => 'st' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
const blankStep = (i: number): Step => ({ id: sid(), worker: i ? 'prompt' : 'generate', platform: 'x', prompt: '', usePrev: i > 0 });
const TOOL_PLATS = ['instagram', 'threads', 'x', 'linkedin', 'youtube'];
const TONES = ['casual', 'professional', 'witty', 'educational', 'bold', 'inspirational'];
const WORKER_SHORT: Record<Worker, string> = { generate: 'Generate', tool: 'Toolkit', agent: 'Agent', prompt: 'Prompt', collect: 'Collect' };

/** Ready-made automations to start from. */
const TEMPLATES: { key: string; label: string; make: () => Draft }[] = [
  { key: 'blank', label: 'Blank', make: () => ({ name: 'New automation', description: '', enabled: true, steps: [blankStep(0)], schedule: { type: 'manual' } }) },
  {
    key: 'monday', label: 'Monday content plan', make: () => ({
      name: 'Monday content plan', description: 'A 7-day plan on my best hours, first 3 posts written.', enabled: true,
      schedule: { type: 'weekly', days: [1], time: '08:00' },
      steps: [{ ...blankStep(0), worker: 'agent', agent: 'calendar', prompt: 'mobile app security and building my app in public' }],
    }),
  },
  {
    key: 'hooks', label: 'Daily hooks on X', make: () => ({
      name: 'Daily hooks', description: '10 fresh first lines every weekday morning.', enabled: true,
      schedule: { type: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30' },
      steps: [{ ...blankStep(0), worker: 'tool', tool: 'hooks', platform: 'x', prompt: 'something I learned this week hunting bugs in mobile apps' }],
    }),
  },
  {
    key: 'chain', label: 'Idea → post → Threads', make: () => ({
      name: 'Idea to post, twice', description: 'Pick an angle from my data, write it for X, then adapt it for Threads.', enabled: true,
      schedule: { type: 'daily', time: '10:00' },
      steps: [
        { ...blankStep(0), worker: 'prompt', withData: true, prompt: 'Today is {{weekday}}. From my data, pick ONE specific angle on mobile/app security that is trending and that I have not covered. Answer in 2 sentences: the angle, and why now.' },
        { ...blankStep(1), worker: 'generate', platform: 'x', prompt: 'Write about this angle: {{prev}}' },
        { ...blankStep(2), worker: 'tool', tool: 'repurpose', platform: 'threads', prompt: 'Adapt the best of these drafts for Threads:\n{{prev}}' },
      ],
    }),
  },
  {
    key: 'collect', label: 'Weekly Threads collection', make: () => ({
      name: 'Weekly Threads collection', description: 'Refresh Threads posts every Sunday night (uses Apify credit).', enabled: true,
      schedule: { type: 'weekly', days: [0], time: '22:00' },
      steps: [{ ...blankStep(0), worker: 'collect', platform: 'threads', prompt: '' }],
    }),
  },
];

export default function Automations() {
  const [list, setList] = useState<Auto[] | null>(null);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stepIx, setStepIx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const j = await fetch('/api/automations').then(r => r.json()).catch(() => null);
    if (j) { setList(j.automations || []); setCat(j.catalog); }
    return (j?.automations || []) as Auto[];
  }, []);
  useEffect(() => {
    load().then(l => {
      const id = new URLSearchParams(location.search).get('id');
      const a = l.find(x => x.id === id) || l[0];
      if (a) edit(a);
    });
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  const anyRunning = !!list?.some(a => a.running);
  useEffect(() => { const t = setInterval(load, anyRunning ? 3000 : 20000); return () => clearInterval(t); }, [load, anyRunning]);

  const edit = (a: Auto) => {
    setDraft({ id: a.id, name: a.name, description: a.description, enabled: a.enabled, steps: a.steps.map(s => ({ ...s })), schedule: { ...a.schedule } });
    setStepIx(0);
    const u = new URL(location.href); u.searchParams.set('id', a.id); history.replaceState(null, '', u);
  };
  const saved = list?.find(a => a.id === draft?.id) || null;
  const isDirty = useMemo(() => !!draft && (!saved || JSON.stringify({ n: saved.name, d: saved.description, e: saved.enabled, s: saved.steps, c: saved.schedule }) !== JSON.stringify({ n: draft.name, d: draft.description, e: draft.enabled, s: draft.steps, c: draft.schedule })), [draft, saved]);

  const call = (body: unknown) => fetch('/api/automations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const save = async () => {
    if (!draft) return null;
    setSaving(true);
    const j = await call({ action: 'save', automation: draft }).catch(e => ({ error: e.message }));
    setSaving(false);
    if (j.error) { toast('Could not save', { description: j.error, type: 'destructive' }); return null; }
    await load();
    edit(j.automation);
    toast('Automation saved', { description: j.automation.nextRun ? `Next run ${new Date(j.automation.nextRun).toLocaleString()}` : describeSchedule(j.automation.schedule), type: 'success' });
    return j.automation as Auto;
  };
  const runNow = async () => {
    const a = isDirty ? await save() : saved;
    if (!a) return;
    const j = await call({ action: 'run', id: a.id });
    if (j.error) { toast('Could not start', { description: j.error, type: 'destructive' }); return; }
    notifyActivity();
    toast(`${a.name} started`, { description: 'Follow it on Activity', type: 'info', action: { label: 'Open', onClick: () => { location.href = '/activity?filter=active'; } } });
    setTimeout(load, 800);
  };
  const toggle = async (a: Auto) => { await call({ action: 'toggle', id: a.id, enabled: !a.enabled }); const l = await load(); if (draft?.id === a.id) { const x = l.find(y => y.id === a.id); if (x) setDraft(d => (d ? { ...d, enabled: x.enabled } : d)); } };
  const remove = async () => {
    if (!draft?.id || !confirm(`Delete "${draft.name}"? Past runs stay on Activity.`)) return;
    await call({ action: 'delete', id: draft.id });
    const l = await load();
    if (l[0]) edit(l[0]); else setDraft(null);
  };

  const setStep = (i: number, p: Partial<Step>) => setDraft(d => (d ? { ...d, steps: d.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) } : d));
  const addStep = () => { if (!draft || draft.steps.length >= 6) return; setDraft({ ...draft, steps: [...draft.steps, blankStep(draft.steps.length)] }); setStepIx(draft.steps.length); };
  const moveStep = (i: number, by: number) => setDraft(d => {
    if (!d) return d; const j = i + by; if (j < 0 || j >= d.steps.length) return d;
    const s = [...d.steps]; [s[i], s[j]] = [s[j], s[i]]; setStepIx(j); return { ...d, steps: s };
  });
  const delStep = (i: number) => setDraft(d => (d && d.steps.length > 1 ? { ...d, steps: d.steps.filter((_, k) => k !== i) } : d));

  // stats
  const enabled = (list || []).filter(a => a.enabled && a.nextRun);
  const nextUp = [...enabled].sort((a, b) => (a.nextRun! - b.nextRun!))[0];
  const weekRuns = (list || []).flatMap(a => a.history).filter(h => now && h.at > now - 7 * 864e5);
  const ok = weekRuns.filter(h => h.status === 'done').length;

  return (
    <div className="space-y-4">
      <PageHead title="Automations" sub="Chain AI workers into a pipeline, give each step your own prompt and platform, and let it run on a schedule. Results land on Activity."
        right={<Sel aria-label="New automation" value="" onChange={e => { const t = TEMPLATES.find(x => x.key === e.target.value); if (t) { setDraft(t.make()); setStepIx(0); } }} size="sm" className="w-56">
          <option value="">+ New automation…</option>
          {TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Sel>} />

      <Stats items={[
        { label: 'Scheduled', value: enabled.length, hint: `${(list || []).length} automations in total` },
        { label: 'Next run', value: nextUp ? untilText(nextUp.nextRun, now || undefined) : '—', hint: nextUp ? nextUp.name : 'nothing scheduled' },
        { label: 'Runs, 7 days', value: weekRuns.length, hint: weekRuns.length ? `${ok} succeeded` : 'none yet' },
        { label: 'Running now', value: (list || []).filter(a => a.running).length, hint: anyRunning ? 'see Activity' : 'idle' },
      ]} />

      <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* list */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {list === null ? <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
            : !list.length ? <Empty title="No automations yet">Pick a template in “New automation” to start.</Empty>
            : (
              <ul className="divide-y divide-border">
                {list.map(a => (
                  <li key={a.id}>
                    <div className={`flex gap-3 px-4 py-3 ${draft?.id === a.id ? 'bg-muted' : 'hover:bg-muted/50'}`}>
                      <button onClick={() => edit(a)} className="min-w-0 flex-1 text-left">
                        <span className="flex items-center gap-2">
                          {a.running && <Spinner className="size-3.5" />}
                          <span className={`truncate text-[13px] font-medium ${a.enabled ? '' : 'text-muted-foreground'}`}>{a.name}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{describeSchedule(a.schedule)}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {a.steps.map((s, i) => <span key={s.id} className="rounded bg-background px-1.5 py-px text-[10px] text-muted-foreground ring-1 ring-border">{i + 1}. {WORKER_SHORT[s.worker]} · {SNAME[s.platform] || s.platform}</span>)}
                        </span>
                        <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                          {a.enabled && a.nextRun ? <>Next {untilText(a.nextRun, now || undefined)}</> : a.enabled ? 'Manual' : 'Paused'}
                          {a.history[0] && <> · last {a.history[0].status}</>}
                        </span>
                      </button>
                      <button onClick={() => toggle(a)} role="switch" aria-checked={a.enabled} aria-label={a.enabled ? 'Pause' : 'Turn on'} title={a.enabled ? 'On — click to pause' : 'Paused — click to turn on'}
                        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${a.enabled ? 'bg-foreground' : 'bg-muted-foreground/30'}`}>
                        <span className={`block size-4 rounded-full bg-background transition-transform ${a.enabled ? 'translate-x-4' : ''}`} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>

        {/* editor */}
        {!draft || !cat ? (
          <div className="rounded-xl border border-border bg-card"><Empty title="Pick an automation, or start a new one">Templates: a Monday content plan, daily hooks, an idea → post → Threads chain, or a weekly collection.</Empty></div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} aria-label="Automation name"
                    className="w-full rounded-md border border-transparent bg-transparent px-1 text-[16px] font-semibold outline-none hover:border-border focus:border-foreground/40" />
                  <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What it's for (optional)" aria-label="Description"
                    className="w-full rounded-md border border-transparent bg-transparent px-1 text-[13px] text-muted-foreground outline-none hover:border-border focus:border-foreground/40" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {isDirty && <span className="text-[11px] text-muted-foreground">Unsaved changes</span>}
                  <button onClick={runNow} disabled={!!saved?.running} className={btn + ' h-8 px-3 text-xs'}>{saved?.running ? <Spinner className="size-3.5" /> : <Play className="size-3.5" aria-hidden="true" />} Run now</button>
                  <button onClick={save} disabled={saving || !isDirty} className={btnPrimary + ' h-8 px-3 text-xs disabled:opacity-50'}>{saving ? <Spinner className="size-3.5" /> : <Save className="size-3.5" aria-hidden="true" />} Save</button>
                  {draft.id && <button onClick={remove} className={btn + ' h-8 px-2.5'} aria-label="Delete automation" title="Delete automation"><Trash2 className="size-3.5" aria-hidden="true" /></button>}
                </div>
              </div>

              {/* the chain, as a flow */}
              <div className="p-4">
                <ChainFlow draft={draft} sel={stepIx} onSelect={setStepIx} onAdd={addStep} cat={cat} />
              </div>
            </div>

            <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
              <StepEditor key={draft.steps[stepIx]?.id} i={stepIx} s={draft.steps[Math.min(stepIx, draft.steps.length - 1)]} count={draft.steps.length} cat={cat}
                onChange={p => setStep(stepIx, p)} onMove={by => moveStep(stepIx, by)} onDelete={() => { delStep(stepIx); setStepIx(i => Math.max(0, i - 1)); }} />
              <div className="space-y-4">
                <ScheduleEditor s={draft.schedule} enabled={draft.enabled} now={now} onChange={schedule => setDraft({ ...draft, schedule })} onEnabled={en => setDraft({ ...draft, enabled: en })} />
                {saved && <History items={saved.history} />}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- chain flow ----------------
function ChainFlow({ draft, sel, onSelect, onAdd, cat }: { draft: Draft; sel: number; onSelect: (i: number) => void; onAdd: () => void; cat: Catalog }) {
  const X = 240;
  const label = (s: Step) => s.worker === 'tool' ? cat.tools.find(t => t.key === s.tool)?.name || 'Pick a tool'
    : s.worker === 'agent' ? cat.agents.find(a => a.kind === s.agent)?.name || 'Pick an agent'
    : cat.workers.find(w => w.key === s.worker)?.label || s.worker;
  const shape = draft.steps.map(s => `${s.worker}${s.tool}${s.agent}${s.platform}`).join('|');
  return (
    <Flow key={`${draft.id}-${draft.steps.length}-${shape}`} className="h-52 rounded-xl" fitViewOnMount fitViewPadding={20} maxZoom={1} label="Automation steps">
      <Flow.Background variant="dots" />
      <Flow.Node id="trigger" position={{ x: 0, y: 10 }} className="w-44">
        <Flow.NodeHeader><span className="text-[11px] text-muted-foreground">Trigger</span><Flow.NodeBadge color={draft.enabled ? 'primary' : 'muted'}>{draft.enabled ? 'on' : 'paused'}</Flow.NodeBadge></Flow.NodeHeader>
        <Flow.NodeContent>
          <Flow.NodeTitle className="flex items-center gap-1.5 text-[13px]"><CalendarClock className="size-3.5" aria-hidden="true" />Schedule</Flow.NodeTitle>
          <Flow.NodeDescription className="text-[12px] line-clamp-2">{describeSchedule(draft.schedule)}</Flow.NodeDescription>
        </Flow.NodeContent>
      </Flow.Node>
      {draft.steps.map((s, i) => (
        <Flow.Node key={s.id} id={s.id} position={{ x: X * (i + 1), y: i % 2 ? 30 : 0 }} selected={i === sel} onPress={() => onSelect(i)} className="w-48 cursor-pointer">
          <Flow.NodeHeader><span className="text-[11px] text-muted-foreground">Step {i + 1}</span><Flow.NodeBadge>{SNAME[s.platform] || s.platform}</Flow.NodeBadge></Flow.NodeHeader>
          <Flow.NodeContent>
            <Flow.NodeTitle className="text-[13px]">{label(s)}</Flow.NodeTitle>
            <Flow.NodeDescription className="text-[12px] line-clamp-2">{s.worker === 'collect' ? 'Runs the collector' : s.prompt || 'No prompt yet'}</Flow.NodeDescription>
          </Flow.NodeContent>
        </Flow.Node>
      ))}
      <Flow.Node id="add" position={{ x: X * (draft.steps.length + 1), y: 30 }} draggable={false} onPress={draft.steps.length < 6 ? onAdd : undefined}
        className="w-36 cursor-pointer border-dashed bg-transparent">
        <div className="flex items-center justify-center gap-1.5 px-3 py-4 text-[12px] text-muted-foreground"><Plus className="size-3.5" aria-hidden="true" />{draft.steps.length < 6 ? 'Add a step' : 'Max 6 steps'}</div>
      </Flow.Node>
      <Flow.Node id="out" position={{ x: X * (draft.steps.length + 1) + 180, y: 0 }} className="w-40">
        <Flow.NodeContent>
          <Flow.NodeTitle className="text-[13px]">Activity</Flow.NodeTitle>
          <Flow.NodeDescription className="text-[12px]">result saved there</Flow.NodeDescription>
        </Flow.NodeContent>
      </Flow.Node>
      <Flow.Edge from="trigger" to={draft.steps[0]?.id || 'add'} variant="smoothstep" arrow color="primary" />
      {draft.steps.slice(1).map((s, i) => <Flow.Edge key={s.id} from={draft.steps[i].id} to={s.id} variant="smoothstep" arrow dashed={!s.usePrev && !/\{\{\s*prev\s*\}\}/i.test(s.prompt)} />)}
      <Flow.Edge from={draft.steps[draft.steps.length - 1].id} to="out" variant="smoothstep" arrow />
    </Flow>
  );
}

// ---------------- step editor ----------------
function StepEditor({ i, s, count, cat, onChange, onMove, onDelete }: { i: number; s: Step; count: number; cat: Catalog; onChange: (p: Partial<Step>) => void; onMove: (by: number) => void; onDelete: () => void }) {
  const [model, setModel] = useState(s.model ? `${s.model.providerID}|${s.model.id}` : '');
  const w = cat.workers.find(x => x.key === s.worker);
  const plats = s.worker === 'tool' ? TOOL_PLATS.filter(p => !s.tool || cat.tools.find(t => t.key === s.tool)?.platforms.includes(p)) : PLAT_ORDER;
  const tools = cat.tools.filter(t => t.platforms.includes(s.platform) || !TOOL_PLATS.includes(s.platform));
  const field = s.worker === 'tool' ? cat.tools.find(t => t.key === s.tool)?.field || 'Input'
    : s.worker === 'agent' ? 'Topic' : s.worker === 'generate' ? 'Your idea' : 'Your prompt';
  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold">Step {i + 1}</h3>
        <span className="text-[12px] text-muted-foreground">{w?.hint}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={i === 0} className={btn + ' h-7 px-2'} aria-label="Move step up"><ArrowUp className="size-3.5" aria-hidden="true" /></button>
          <button onClick={() => onMove(1)} disabled={i === count - 1} className={btn + ' h-7 px-2'} aria-label="Move step down"><ArrowDown className="size-3.5" aria-hidden="true" /></button>
          <button onClick={onDelete} disabled={count === 1} className={btn + ' h-7 px-2'} aria-label="Remove step"><XIcon className="size-3.5" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <div>
          <span className={label}>Worker</span>
          <Segmented ariaLabel="Worker" value={s.worker} size="sm" onChange={k => onChange({ worker: k as Worker, ...(k === 'tool' && !TOOL_PLATS.includes(s.platform) ? { platform: 'x' } : {}) })}
            options={cat.workers.map(x => ({ key: x.key, label: x.label, title: x.hint }))} />
        </div>
        <div>
          <span className={label}>Platform</span>
          <Segmented ariaLabel="Platform" value={s.platform} size="sm" onChange={k => onChange({ platform: k, format: undefined })} options={plats.map(p => ({ key: p, label: SNAME[p] }))} />
        </div>

        {s.worker === 'tool' && (
          <div><span className={label}>Tool</span>
            <Sel aria-label="Toolkit tool" value={s.tool || ''} onChange={e => onChange({ tool: e.target.value })} size="sm" className="w-72">
              <option value="">Pick a tool…</option>
              {tools.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
            </Sel>
          </div>
        )}
        {s.worker === 'agent' && (
          <div><span className={label}>Agent</span>
            <Sel aria-label="Workflow agent" value={s.agent || ''} onChange={e => onChange({ agent: e.target.value })} size="sm" className="w-72">
              <option value="">Pick an agent…</option>
              {cat.agents.map(a => <option key={a.kind} value={a.kind}>{a.name} — {a.tagline}</option>)}
            </Sel>
          </div>
        )}
        {s.worker === 'generate' && (
          <div className="flex flex-wrap gap-3">
            <div><span className={label}>Format</span>
              <Sel aria-label="Format" value={s.format || ''} onChange={e => onChange({ format: e.target.value || undefined })} size="sm" className="w-48">
                <option value="">Default for platform</option>
                {(cat.formats[s.platform] || []).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </Sel>
            </div>
            <div><span className={label}>Tone</span>
              <Sel aria-label="Tone" value={s.tone || ''} onChange={e => onChange({ tone: e.target.value || undefined })} size="sm" className="w-40">
                <option value="">Casual (default)</option>
                {TONES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </Sel>
            </div>
          </div>
        )}

        {s.worker !== 'collect' ? (
          <>
            <div>
              <label className={label} htmlFor={`p-${s.id}`}>{field}</label>
              <textarea id={`p-${s.id}`} rows={5} value={s.prompt} onChange={e => onChange({ prompt: e.target.value })} className={inputCls + ' resize-y font-mono text-[13px]'}
                placeholder={i ? 'e.g. Turn this into a LinkedIn post: {{prev}}' : 'e.g. One lesson from a bug I found in a fintech app'} />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Fill-ins: <code className="rounded bg-muted px-1">{'{{prev}}'}</code> previous step's output · <code className="rounded bg-muted px-1">{'{{date}}'}</code> · <code className="rounded bg-muted px-1">{'{{weekday}}'}</code>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {i > 0 && <FilterChip on={s.usePrev} onClick={() => onChange({ usePrev: !s.usePrev })} title="Append the previous step's output when the prompt has no {{prev}}">Use previous output</FilterChip>}
              {s.worker === 'prompt' && <FilterChip on={!!s.withData} onClick={() => onChange({ withData: !s.withData })} title="Add your data digest: winners, patterns, rising topics">Include my data</FilterChip>}
            </div>
            <div className="max-w-sm">
              <ModelPicker value={model} remember={false} compact label="Model for this step"
                onChange={v => { setModel(v); onChange({ model: pickedModel(v) }); }} />
            </div>
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] text-muted-foreground">
            Starts the {SNAME[s.platform]} collector with the accounts on <Link href="/sources" className="underline">Sources</Link>. It costs Apify credit and stops at your spend limit.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------- schedule ----------------
function ScheduleEditor({ s, enabled, now, onChange, onEnabled }: { s: Schedule; enabled: boolean; now: number; onChange: (s: Schedule) => void; onEnabled: (on: boolean) => void }) {
  const next = enabled ? nextRunOf(s, now || undefined) : null;
  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
  const input = 'h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-foreground/40';
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Clock className="size-4" aria-hidden="true" /><h3 className="text-sm font-semibold">When it runs</h3>
        <button onClick={() => onEnabled(!enabled)} className={`ml-auto inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ${enabled ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>
          <Power className="size-3.5" aria-hidden="true" />{enabled ? 'On' : 'Paused'}
        </button>
      </div>
      <div className="space-y-4 p-5">
        <Segmented ariaLabel="Schedule" value={s.type} size="sm" onChange={k => onChange({ type: k as Schedule['type'], time: s.time || '09:00', days: s.days?.length ? s.days : [1], everyHours: s.everyHours || 24, at: s.at })}
          options={[{ key: 'manual', label: 'Manual' }, { key: 'once', label: 'Once' }, { key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' }, { key: 'interval', label: 'Every N h' }]} />
        {s.type === 'once' && <div><label className={label} htmlFor="sch-at">Date and time</label><input id="sch-at" type="datetime-local" value={s.at || ''} onChange={e => onChange({ ...s, at: e.target.value })} className={input} /></div>}
        {(s.type === 'daily' || s.type === 'weekly') && <div><label className={label} htmlFor="sch-time">Time</label><input id="sch-time" type="time" value={s.time || '09:00'} onChange={e => onChange({ ...s, time: e.target.value })} className={input} /></div>}
        {s.type === 'weekly' && (
          <div><span className={label}>Days</span>
            <div className="flex flex-wrap gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map(d => (
                <FilterChip key={d} on={!!s.days?.includes(d)} onClick={() => onChange({ ...s, days: s.days?.includes(d) ? s.days.filter(x => x !== d) : [...(s.days || []), d] })}>{DAY_SHORT[d]}</FilterChip>
              ))}
            </div>
          </div>
        )}
        {s.type === 'interval' && <div><label className={label} htmlFor="sch-h">Every (hours)</label><input id="sch-h" type="number" min={1} max={168} value={s.everyHours || 24} onChange={e => onChange({ ...s, everyHours: Number(e.target.value) })} className={input + ' w-24'} /></div>}
        <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-[13px]">
          <div className="font-medium">{describeSchedule(s)}</div>
          <div className="text-[12px] text-muted-foreground">
            {!enabled ? 'Paused: it only runs when you press Run now.' : next ? `Next run ${new Date(next).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${untilText(next, now || undefined)})` : s.type === 'manual' ? 'Runs when you press Run now.' : s.type === 'once' ? 'Pick a time in the future.' : 'Pick at least one day.'}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Times are this computer's local time. Reticle has to be running; a run missed while it was off happens once when it starts again.</p>
      </div>
    </div>
  );
}

function History({ items }: { items: RunRec[] }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3 text-sm font-semibold">Recent runs</div>
      {!items.length ? <p className="px-5 py-4 text-[13px] text-muted-foreground">Not run yet.</p> : (
        <ul className="divide-y divide-border">
          {items.slice(0, 8).map(h => (
            <li key={h.runId + h.at} className="flex items-center gap-3 px-5 py-2.5 text-[12px]">
              <span className={`size-2 shrink-0 rounded-full ${h.status === 'done' ? 'bg-foreground' : h.status === 'running' ? 'animate-pulse bg-foreground' : 'border border-foreground'}`} />
              <span className="min-w-0 flex-1">
                <span className="block">{new Date(h.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {h.status}{h.ms ? ` · ${Math.round(h.ms / 1000)}s` : ''}</span>
                <span className="block truncate text-muted-foreground">{h.error || (h.trigger === 'schedule' ? 'by schedule' : 'run by you')}</span>
              </span>
              {h.runId && <Link href={`/activity?id=${h.runId}`} className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground">Open <ArrowUpRight className="size-3" aria-hidden="true" /></Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
