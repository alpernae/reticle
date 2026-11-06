'use client';
// Formats — repeatable post formats that win on reach:
//  • Series trackers: the "Day N/365" daily log, filled from numbers YOU log
//    (the day counts itself, totals carry over, AI polish never touches numbers).
//  • Quick posts: AI-written conversation starters (poll, "convince me", ask the
//    crowd, connect call, hot-take question, mini challenge) for your audiences.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardHead, Chip, PageHead, btn, btnPrimary, inputCls, labelCls, notifyActivity } from '@/components/panel';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { QuickPostCard } from '@/components/code-shot';
import { AUDIENCES, QUICK_FORMATS, TRACKER_PRESETS, dayNumber, newTracker, renderTracker, type Tracker, type TrackerField } from '@/lib/formats';
import { Check, Copy, Plus, Save, Sparkles, Trash2, CalendarCheck, X as XIcon } from 'lucide-react';
import { Sel } from '@/components/sel';
import { Spinner } from '@/components/panelui/spinner';

const post = (body: unknown) => fetch('/api/formats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const saveToWinners = (platform: string, text: string) =>
  fetch('/api/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform, text, eng: 0, when: '' }) });

function useCopy() {
  const [k, setK] = useState<string | null>(null);
  return { copied: k, copy: (t: string, key: string) => { navigator.clipboard.writeText(t); setK(key); setTimeout(() => setK(null), 1600); } };
}

export default function Formats() {
  const [model, setModel] = useState('');
  return (
    <div className="space-y-5">
      <PageHead title="Formats" sub="Repeatable formats that keep pulling engagement: a daily series you log in 30 seconds, and AI-written conversation starters for your three audiences." />
      <div className="max-w-sm"><ModelPicker value={model} onChange={setModel} label="AI for this page (polish + quick posts)" /></div>
      <Trackers model={model} />
      <QuickPosts model={model} />
    </div>
  );
}

// ---------------- series trackers ----------------
function Trackers({ model }: { model: string }) {
  const [list, setList] = useState<Tracker[] | null>(null);
  const [sel, setSel] = useState<string>('');
  const [preset, setPreset] = useState('bounty');
  const [project, setProject] = useState('');
  const [text, setText] = useState('');          // editable final text (after optional polish)
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => { fetch('/api/formats').then(r => r.json()).then(j => { setList(j.trackers || []); setSel(j.trackers?.[0]?.id || ''); }).catch(() => setList([])); }, []);
  const t = list?.find(x => x.id === sel) || null;
  const day = t ? dayNumber(t.startDate) : 1;
  const rendered = useMemo(() => (t ? renderTracker(t, day) : ''), [t, day]);
  useEffect(() => { setText(rendered); }, [rendered]);

  const persist = useCallback(async (next: Tracker[]) => {
    setList(next); setDirty(false);
    await post({ action: 'save', trackers: next });
  }, []);
  const patch = (p: Partial<Tracker>) => { if (!t || !list) return; setList(list.map(x => (x.id === t.id ? { ...x, ...p } : x))); setDirty(true); };
  const patchField = (i: number, p: Partial<TrackerField>) => t && patch({ fields: t.fields.map((f, k) => (k === i ? { ...f, ...p } : f)) });

  const create = () => {
    const n = newTracker(preset, project.trim());
    const next = [...(list || []), n];
    setSel(n.id); persist(next); setProject('');
  };
  // No confirm() popup (embedded browsers can auto-dismiss it). A series with no
  // logged days deletes at once; one with history needs a second click within 4s.
  const [armed, setArmed] = useState<string | null>(null);
  const remove = (id = t?.id) => {
    const x = list?.find(y => y.id === id);
    if (!x || !list) return;
    if (x.log.length && armed !== x.id) { setArmed(x.id); setTimeout(() => setArmed(a => (a === x.id ? null : a)), 4000); return; }
    const next = list.filter(y => y.id !== x.id);
    setArmed(null);
    if (sel === x.id) setSel(next[0]?.id || '');
    persist(next);
    setMsg(`Deleted “${x.name}”.`);
  };;
  const polish = async () => {
    setBusy(true); setMsg('');
    const r = await post({ action: 'polish', text, model: pickedModel(model) }).catch((e: any) => ({ error: e.message }));
    if (r.text && !r.error) { setText(r.text); setMsg(`✓ polished via ${r.via?.providerID} · ${r.via?.id} — numbers verified unchanged`); }
    else setMsg('✗ ' + (r.error || 'failed'));
    setBusy(false);
  };
  const logToday = async () => {
    if (!t || !list) return;
    // text fields reset for tomorrow; cumulative numbers carry over; daily numbers reset
    const values: Record<string, string> = {};
    for (const f of t.fields) if (f.cumulative) values[f.key] = t.values[f.key] ?? '';
    const today = new Date().toISOString().slice(0, 10);
    const log = [{ day, date: today, text }, ...t.log.filter(l => l.day !== day)].slice(0, 400);
    await persist(list.map(x => (x.id === t.id ? { ...x, values, log } : x)));
    await saveToWinners('x', text).catch(() => {});
    setMsg(`✓ Day ${day} logged — also saved to Winners so you can record its real numbers later`);
  };

  return (
    <Card>
      <CardHead title="Series trackers" sub="your “Day N/365” post — the day counts itself, totals carry over, you only type today’s numbers"
        right={<CalendarCheck className="size-4" aria-hidden="true" />} />
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          {list?.length ? (
            <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1 mr-2">
              {list.map(x => (
                <span key={x.id} className={`inline-flex items-center rounded-md ${x.id === sel ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                  <button onClick={() => setSel(x.id)} className="h-8 pl-3 pr-1.5 text-[13px] font-medium">{x.name}</button>
                  <button onClick={() => remove(x.id)} title={armed === x.id ? 'click again to delete (has logged days)' : x.log.length ? `delete (${x.log.length} logged days)` : 'delete'} aria-label={`delete ${x.name}`}
                    className={`h-8 pr-2 pl-0.5 opacity-70 hover:opacity-100 ${armed === x.id ? 'font-semibold' : ''}`}>
                    {armed === x.id ? 'sure?' : <XIcon className="size-3.5" aria-hidden="true" />}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="w-52"><label className={labelCls}>New series</label>
            <Sel className={inputCls} value={preset} onChange={e => setPreset(e.target.value)}>
              {TRACKER_PRESETS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </Sel></div>
          {preset !== 'bounty' && <div className="w-44"><label className={labelCls}>App / project name</label><input className={inputCls} value={project} onChange={e => setProject(e.target.value)} placeholder="e.g. my app" /></div>}
          <button className={btn} onClick={create}><Plus className="size-4" aria-hidden="true" /> Create</button>
        </div>

        {list && !list.length && <p className="text-[13px] text-muted-foreground">No series yet. “Bug bounty grind” mirrors the format you saw — with a focus line and a lesson line added, which is what makes people follow a series instead of just liking it once.</p>}

        {t && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="col-span-2"><label className={labelCls}>Series name</label><input className={inputCls} value={t.name} onChange={e => patch({ name: e.target.value })} /></div>
                <div><label className={labelCls}>Day 1 date</label><input className={inputCls} type="date" value={t.startDate} onChange={e => patch({ startDate: e.target.value })} /></div>
                <div><label className={labelCls}>Total days</label><input className={inputCls} type="number" min={7} max={1000} value={t.totalDays} onChange={e => patch({ totalDays: Number(e.target.value) || 365 })} /></div>
              </div>
              <div><label className={labelCls}>Headline <span className="normal-case font-normal">— {'{day}'} {'{total}'} {'{project}'} fill in automatically</span></label><input className={inputCls} value={t.headline} onChange={e => patch({ headline: e.target.value })} /></div>
              {t.headline.includes('{project}') && <div><label className={labelCls}>Project</label><input className={inputCls} value={t.project} onChange={e => patch({ project: e.target.value })} /></div>}
              <div className="space-y-1.5">
                <label className={labelCls}>Today’s numbers <span className="normal-case font-normal">— ↻ = running total, kept after you log the day</span></label>
                {t.fields.map((f, i) => (
                  <div key={f.key} className="flex items-center gap-1.5">
                    <input className={inputCls + ' w-12 text-center px-1'} value={f.emoji} onChange={e => patchField(i, { emoji: e.target.value })} aria-label="emoji" />
                    <input className={inputCls + ' w-44'} value={f.label} onChange={e => patchField(i, { label: e.target.value })} aria-label="label" />
                    <input className={inputCls + ' flex-1'} value={t.values[f.key] ?? ''} placeholder={f.kind === 'text' ? 'optional — left out when empty' : f.kind === 'money' ? '$? if unknown' : '0'}
                      onChange={e => patch({ values: { ...t.values, [f.key]: e.target.value } })} aria-label={f.label} />
                    {f.kind !== 'text' && <button title="running total (carries over)" onClick={() => patchField(i, { cumulative: !f.cumulative })} className={`h-9 w-8 shrink-0 rounded-lg border text-xs ${f.cumulative ? 'bg-primary text-primary-foreground border-transparent' : 'border-border text-muted-foreground'}`}>↻</button>}
                    <button title="remove line" onClick={() => patch({ fields: t.fields.filter((_, k) => k !== i) })} className="h-9 w-8 shrink-0 grid place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"><XIcon className="size-3.5" aria-hidden="true" /></button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button className={btn + ' h-8 px-3 text-xs'} onClick={() => patch({ fields: [...t.fields, { key: 'f' + Date.now().toString(36), label: 'New number', emoji: '📊', kind: 'number' }] })}><Plus className="size-3.5" aria-hidden="true" /> number</button>
                  <button className={btn + ' h-8 px-3 text-xs'} onClick={() => patch({ fields: [...t.fields, { key: 'f' + Date.now().toString(36), label: 'Note', emoji: '📝', kind: 'text' }] })}><Plus className="size-3.5" aria-hidden="true" /> text line</button>
                </div>
              </div>
              <div><label className={labelCls}>Hashtags</label><input className={inputCls} value={t.hashtags} onChange={e => patch({ hashtags: e.target.value })} /></div>
              <div className="flex flex-wrap gap-2">
                <button className={btnPrimary} onClick={() => persist(list!)} disabled={!dirty}><Save className="size-4" aria-hidden="true" /> {dirty ? 'Save series' : 'Saved'}</button>
                <button className={btn + ' text-muted-foreground'} onClick={() => remove()}><Trash2 className="size-4" aria-hidden="true" /> {armed === t.id ? 'Click again to delete' : 'Delete'}</button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Today · Day {day}/{t.totalDays}</span>
                {t.log[0] && <span className="text-[11px] text-muted-foreground">last logged: day {t.log[0].day} · {t.log.length} days logged</span>}
              </div>
              <textarea className={inputCls + ' min-h-[260px] font-sans text-[14px] leading-relaxed'} value={text} onChange={e => setText(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button className={btn} onClick={() => copy(text, 'tracker')}>{copied === 'tracker' ? <><Check className="size-4" aria-hidden="true" /> Copied</> : <><Copy className="size-4" aria-hidden="true" /> Copy</>}</button>
                <button className={btn} onClick={polish} disabled={busy}>{busy ? <Spinner className="size-4" /> : <Sparkles className="size-4" aria-hidden="true" />} Polish text lines</button>
                <button className={btnPrimary} onClick={logToday}><CalendarCheck className="size-4" aria-hidden="true" /> Log day {day}</button>
                {text !== rendered && <button className={btn + ' text-muted-foreground'} onClick={() => setText(rendered)}>reset</button>}
              </div>
              {msg && <p className="text-[12px] text-muted-foreground">{msg}</p>}
              <p className="text-[11px] text-muted-foreground">Keep program names and unpatched bugs out of it — “🎯 focus: IDOR in mobile APIs” is enough. Posting the same skeleton daily is exactly what the repost data shows works: people follow to see the numbers move.</p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------- quick AI posts ----------------
function QuickPosts({ model }: { model: string }) {
  const [format, setFormat] = useState('poll');
  const [audience, setAudience] = useState('mix');
  const [platform, setPlatform] = useState('x');
  const [count, setCount] = useState(5);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ posts?: string[]; fits?: any[]; error?: string; via?: any; ms?: number; grounded?: boolean } | null>(null);
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const { copied, copy } = useCopy();

  const run = async () => {
    setBusy(true); setRes(null); setSaved({});
    setTimeout(notifyActivity, 300);
    const r = await post({ action: 'quick', format, audience, platform, count, idea, model: pickedModel(model) }).catch((e: any) => ({ error: e.message }));
    setRes(r); setBusy(false);
  };
  return (
    <Card>
      <CardHead title="Quick posts" sub="short conversation starters — the low-effort posts that pull replies (and replies are what the algorithm rewards)" right={<Sparkles className="size-4" aria-hidden="true" />} />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          {QUICK_FORMATS.map(f => (
            <button key={f.key} onClick={() => setFormat(f.key)} aria-pressed={format === f.key}
              className={`text-left rounded-lg border p-3 transition-colors ${format === f.key ? 'bg-primary text-primary-foreground border-transparent' : 'border-border hover:bg-muted'}`}>
              <div className="text-[13px] font-medium">{f.name}</div>
              <div className={`text-[11px] mt-1 whitespace-pre-line line-clamp-4 ${format === f.key ? 'opacity-75' : 'text-muted-foreground'}`}>{f.example}</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-[1fr_150px_100px_2fr_auto] gap-2 items-end">
          <div><label className={labelCls}>Audience</label>
            <Sel className={inputCls} value={audience} onChange={e => setAudience(e.target.value)}>{AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</Sel></div>
          <div><label className={labelCls}>Platform</label>
            <Sel className={inputCls} value={platform} onChange={e => setPlatform(e.target.value)}><option value="x">X</option><option value="linkedin">LinkedIn</option><option value="instagram">Instagram story</option><option value="tiktok">TikTok caption</option></Sel></div>
          <div><label className={labelCls}>How many</label><input className={inputCls} type="number" min={1} max={10} value={count} onChange={e => setCount(Number(e.target.value) || 5)} /></div>
          <div className="col-span-2 lg:col-span-1"><label className={labelCls}>Angle (optional)</label><input className={inputCls} value={idea} onChange={e => setIdea(e.target.value)} placeholder="e.g. Flutter vs React Native for a security-focused app" /></div>
          <button className={btnPrimary + ' col-span-2 lg:col-span-1'} onClick={run} disabled={busy}>{busy ? <><Spinner className="size-4" /> Writing…</> : <><Sparkles className="size-4" aria-hidden="true" /> Write {count}</>}</button>
        </div>
        {res?.error && <p className="text-[12px] text-muted-foreground">✗ {res.error}</p>}
        {res?.posts && (
          <>
            <p className="text-[11px] text-muted-foreground">via {res.via?.providerID} · {res.via?.id}{res.ms ? ` · ${(res.ms / 1000).toFixed(1)}s` : ''} · {res.grounded ? 'grounded in same-shape winners from your data' : 'no same-shape winners in your data yet — written from the format + your profile'}</p>
            <div className="grid md:grid-cols-2 gap-2">
              {res.posts.map((p, i) => (
                <QuickPostCard key={i + p.slice(0, 20)} raw={p} idx={i} saved={!!saved[i]} fit={res.fits?.[i]} platform={platform} brief={[`Format: ${(QUICK_FORMATS.find(x => x.key === format) || QUICK_FORMATS[0]).name}`, idea && `Angle: ${idea}`].filter(Boolean).join('\n')}
                  onSave={async text => { await saveToWinners(platform, text); setSaved(s => ({ ...s, [i]: true })); }} />
              ))}
            </div>
          </>
        )}
        {!res && <Chip tone="z">Tip: quick posts get reach from replies — answer the first 10 replies within the hour.</Chip>}
      </div>
    </Card>
  );
}
