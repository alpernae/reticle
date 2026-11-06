'use client';
// Generate — drafts grounded in OUTLIER winners + the pattern table, written
// in the creator-profile voice. The AI first names the pattern it borrows,
// then writes 3 variants; every variant is auto-saved to Winners for logging.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardHead, Chip, PageHead, useApiState, btn, btnPrimary, inputCls, labelCls, notifyActivity, AIHealthChip } from '@/components/panel';
import { Sparkles, PlugZap, Copy, Check, TriangleAlert, Loader, Flame, ArrowUpRight } from 'lucide-react';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { FORMATS_BY_PLATFORM, FORMAT_PLAYBOOK, type PlatformKey } from '@/lib/playbook';
import { FitBadge, type Fit } from '@/components/fit-badge';
import { PolishBox } from '@/components/polish-box';
import { FirstReply, LengthBadge } from '@/components/length-info';
import { Sel } from '@/components/sel';

const selCls = inputCls;
const SNAME: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube' };
const TONES: { key: string; label: string }[] = [
  { key: 'professional', label: 'Professional' }, { key: 'casual', label: 'Casual' }, { key: 'witty', label: 'Witty' },
  { key: 'educational', label: 'Educational' }, { key: 'bold', label: 'Bold / contrarian' }, { key: 'inspirational', label: 'Inspirational' },
];

type Variant = { angle: string; text: string; hashtags: string[]; bestTime?: string; fit?: Fit; firstReply?: string; length?: { shortened: number } };
type Used = { id: string; source: string; author: string | null; outlier: number; hook: string; link: string };
type Result = {
  mode: 'ai' | 'template'; platform: string; topic: string; variants: Variant[]; insight?: string; winners?: Used[];
  aiError?: string; hint?: string; via?: { providerID: string; id: string } | null; ms?: number;
} | null;
type Win = { id: string; source: string; outlier: number; hookLine: string; author: string | null };

export default function Generate() {
  const { data: d, reload } = useApiState();
  const [platform, setPlatform] = useState('x');
  const [format, setFormat] = useState(''); // '' = the platform's default format
  const [topic, setTopic] = useState('');
  const [postRef, setPostRef] = useState('');
  const [tone, setTone] = useState('casual');
  const [model, setModel] = useState('');
  const [idea, setIdea] = useState('');
  const [notes, setNotes] = useState('');
  const [briefFrom, setBriefFrom] = useState<string | null>(null);
  const [wins, setWins] = useState<Win[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [res, setRes] = useState<Result>(null);
  const [savedN, setSavedN] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [ping, setPing] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('ref')) setPostRef(q.get('ref')!);
    const runId = q.get('run');
    if (runId) { // reopen a saved result from Activity
      fetch('/api/activity?id=' + encodeURIComponent(runId)).then(r => r.json()).then(j => {
        const inp = j?.run?.input || {};
        if (inp.platform) setPlatform(inp.platform);
        if (typeof inp.format === 'string') setFormat(inp.format);
        if (typeof inp.idea === 'string') setIdea(inp.idea);
        if (typeof inp.notes === 'string') setNotes(inp.notes);
        if (typeof inp.tone === 'string') setTone(inp.tone);
        if (typeof inp.topic === 'string') setTopic(inp.topic);
        if (j?.run?.output) setRes(j.run.output);
      }).catch(() => {});
    }
    if (q.get('platform') && SNAME[q.get('platform')!]) setPlatform(q.get('platform')!);
    try { // staged result handed over by the Studio ("Send to Generate")
      const raw = sessionStorage.getItem('sc-studio-brief');
      if (raw) {
        sessionStorage.removeItem('sc-studio-brief');
        const b = JSON.parse(raw);
        if (b?.text) { setNotes(p => p || String(b.text).slice(0, 4000)); setBriefFrom(String(b.from || 'Studio')); }
      }
    } catch {}
    fetch('/api/patterns').then(r => r.json()).then(j => setWins(j.winners || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now(); const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  const generate = async () => {
    setBusy(true); setRes(null); setElapsed(0);
    setTimeout(notifyActivity, 300);
    try {
      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, format: format || undefined, topic, postRef: postRef || null, tone, notes, idea, model: pickedModel(model) }),
      });
      const j = await r.json();
      setRes(j);
      if (j.mode === 'ai' && j.variants?.length) { // auto-store drafts as results to log later
        for (const v of j.variants) {
          await fetch('/api/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform, text: v.text, eng: 0, when: '' }) }).catch(() => {});
        }
        setSavedN(j.variants.length); setTimeout(() => setSavedN(0), 5000);
      }
      reload();
    } catch (e: any) { setRes({ mode: 'template', platform, topic, variants: [], aiError: 'Request failed: ' + e.message }); }
    setBusy(false);
  };
  const testAI = async () => {
    setPing('testing…');
    try { const j = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'ping' }) }).then(r => r.json()); setPing(j.message); reload(); }
    catch (e: any) { setPing(e.message); }
  };
  const copy = (t: string, id: string) => { navigator.clipboard.writeText(t); setCopied(id); setTimeout(() => setCopied(null), 1800); };

  const aiChip = d?.aiHealth ? <AIHealthChip health={d.aiHealth} /> : <Chip tone="a">AI: checking…</Chip>;

  return (
    <div className="space-y-4">
      <PageHead title="Generate posts" sub="Borrow the structure of posts that out-performed their creator's normal — written in your voice, on your pillars. Need a bio, thread, title, hashtags or a thumbnail? Use the Toolkit." right={aiChip} />
      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4 items-start">
        <Card>
          <CardHead title="Brief" sub="the AI sees winner cards + pattern lifts + your creator profile" right={<Link href="/settings" className="text-[11px] text-muted-foreground hover:text-foreground">profile & AI →</Link>} />
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Platform</label>
                <Sel className={selCls} value={platform} onChange={e => { setPlatform(e.target.value); setFormat(''); }}>
                  <option value="x">X / Twitter</option><option value="linkedin">LinkedIn</option><option value="instagram">Instagram</option><option value="threads">Threads</option>
                  <option value="tiktok">TikTok</option><option value="youtube">YouTube</option>
                </Sel>
              </div>
              <div>
                <label className={labelCls}>Format</label>
                <Sel className={selCls} value={format || (FORMATS_BY_PLATFORM[platform as PlatformKey] || [])[0] || ''} onChange={e => setFormat(e.target.value)}>
                  {(FORMATS_BY_PLATFORM[platform as PlatformKey] || []).map(f => <option key={f} value={f}>{FORMAT_PLAYBOOK[f].label}</option>)}
                </Sel>
              </div>
            </div>
            <div>
              <label className={labelCls}>Your idea / raw material <span className="font-normal normal-case">(best results)</span></label>
              <textarea className={`${inputCls} min-h-[90px]`} value={idea} onChange={e => setIdea(e.target.value)}
                placeholder="e.g. Found an IDOR via a forgotten /v1 API endpoint — recon steps: wayback URLs → JS files → swapped user id. Lesson: old API versions skip auth middleware." />
            </div>
            <div>
              <label className={labelCls}>Borrow structure from <span className="font-normal normal-case">(optional)</span></label>
              <Sel className={selCls} value={postRef} onChange={e => setPostRef(e.target.value)}>
                <option value="">auto — top outliers for this platform</option>
                {wins.map(w => <option key={w.id} value={w.id}>{w.outlier.toFixed(1)}× · {SNAME[w.source]} · {w.author ? '@' + w.author + ' · ' : ''}{(w.hookLine || '').slice(0, 60)}</option>)}
              </Sel>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Topic filter</label>
                <Sel className={selCls} value={topic} onChange={e => setTopic(e.target.value)}>
                  <option value="">any (your pillars)</option>
                  {d?.topics?.map((t: any) => <option key={t.name} value={t.name}>{t.name}{t.fresh ? ` · ${t.fresh}` : ''}</option>)}
                </Sel>
              </div>
              <div>
                <label className={labelCls}>Tone</label>
                <Sel className={selCls} value={tone} onChange={e => setTone(e.target.value)}>
                  {TONES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </Sel>
              </div>
            </div>
            <div>
              <label className={labelCls}>Extra notes <span className="font-normal normal-case">(optional)</span></label>
              <textarea className={`${inputCls} min-h-[52px]`} placeholder="e.g. end with a question, mention my tool [name]…" value={notes} onChange={e => setNotes(e.target.value)} />
              {briefFrom && <p className="text-[11px] text-muted-foreground mt-1"><b className="font-semibold text-foreground">{briefFrom} result loaded from Studio.</b></p>}
            </div>
            <ModelPicker value={model} onChange={setModel} disabled={busy} />
            <div className="flex items-center gap-2">
              <button className={btnPrimary + ' flex-1 justify-center'} onClick={generate} disabled={busy}>
                {busy ? <><Loader className="size-4 animate-spin" aria-hidden="true" /> Writing… {elapsed}s</> : <><Sparkles className="size-4" aria-hidden="true" /> Generate 3 posts</>}
              </button>
              <button className={btn} title="Test the AI provider chain" onClick={testAI} disabled={busy} aria-label="test AI"><PlugZap className="size-4" aria-hidden="true" /></button>
            </div>
            {ping && <p className="text-[11px] text-muted-foreground">{ping}</p>}
          </div>
        </Card>

        <div className="space-y-4">
          {busy && !res && <Card className="p-6"><div className="animate-pulse space-y-2"><div className="h-3 rounded bg-muted w-1/3" /><div className="h-3 rounded bg-muted w-2/3" /><div className="h-3 rounded bg-muted w-1/2" /></div></Card>}

          {res?.mode === 'template' && (
            <Card className="border-foreground/25"><div className="p-4 flex gap-3">
              <TriangleAlert className="size-5 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm"><b className="font-semibold">AI didn’t answer — showing a template skeleton</b>
                <div className="text-muted-foreground mt-1 break-words">{res.aiError || res.hint}</div>
                <div className="text-muted-foreground mt-1">{res.hint && res.aiError ? res.hint : ''} <Link href="/settings" className="underline">Open AI settings</Link></div>
              </div>
            </div></Card>
          )}

          {res?.insight && (
            <Card>
              <CardHead title="Pattern being borrowed" sub={res.via ? `via ${res.via.providerID} · ${res.via.id}${res.ms ? ` · ${(res.ms / 1000).toFixed(1)}s` : ''}` : ''} right={<Flame className="size-4" aria-hidden="true" />} />
              <div className="p-4 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{res.insight}</div>
              {res.winners?.length ? (
                <div className="px-4 pb-4 flex flex-wrap gap-1.5">
                  {res.winners.map((w, i) => (
                    <a key={w.id} href={w.link} target="_blank" rel="noreferrer" title={w.hook} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                      #{i + 1} {SNAME[w.source]} {w.author ? '@' + w.author : ''} · {w.outlier.toFixed(1)}× <ArrowUpRight className="size-3" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              ) : null}
            </Card>
          )}

          {res?.variants?.map((v, i) => (
            <Card key={i}>
              <CardHead title={`Variant ${i + 1} — ${v.angle || res.platform}`} sub={[res.platform, v.bestTime ? 'best time: ' + v.bestTime : ''].filter(Boolean).join(' · ')} right={
                <div className="flex items-center gap-2"><FitBadge fit={v.fit} /><button onClick={() => copy(v.text + (v.hashtags?.length ? '\n\n' + v.hashtags.join(' ') : ''), 'v' + i)} className={btn + ' px-3'}>
                  {copied === 'v' + i ? <><Check className="size-4" aria-hidden="true" /> Copied</> : <><Copy className="size-4" aria-hidden="true" /> Copy</>}
                </button></div>} />
              <div className="p-5 whitespace-pre-wrap text-[15px] leading-relaxed">{v.text}</div>
              {v.hashtags?.length ? <div className="px-5 pb-4 flex flex-wrap gap-1.5">{v.hashtags.map(h => <Chip key={h} tone="b">{h}</Chip>)}</div> : null}
              <div className="px-5 pb-3 space-y-2">
                <FirstReply link={v.firstReply} />
                <div className="flex items-center gap-2"><LengthBadge platform={platform} text={v.text + (v.hashtags?.length ? '\n\n' + v.hashtags.join(' ') : '')} format={format || (FORMATS_BY_PLATFORM[platform as PlatformKey] || [])[0]} thread={(format || (FORMATS_BY_PLATFORM[platform as PlatformKey] || [])[0]) === 'x-thread' || format === 'th-chain'} />{v.length?.shortened ? <span className="text-[11px] text-muted-foreground">· shortened automatically to fit</span> : null}</div>
              </div>
              <div className="px-5 pb-4 flex flex-wrap gap-2">
                <PolishBox key={v.text.slice(0, 30)} text={v.text} platform={platform} format={format || (FORMATS_BY_PLATFORM[platform as PlatformKey] || [])[0]}
                  brief={[idea && `Idea: ${idea}`, topic && `Topic: ${topic}`, notes && `Notes: ${notes}`].filter(Boolean).join('\n')}
                  onApply={(t, f, fr) => setRes(r => (r ? { ...r, variants: r.variants.map((x, k) => (k === i ? { ...x, text: t, fit: f ?? x.fit, firstReply: fr || x.firstReply } : x)) } : r))} />
              </div>
            </Card>
          ))}

          {savedN > 0 && <Chip tone="a">✓ {savedN} drafts saved to Winners — log real numbers there after posting</Chip>}

          {!res && !busy && (
            <Card><div className="py-16 px-6 text-center text-muted-foreground">
              <Sparkles className="size-7 mx-auto mb-3 text-foreground/40" aria-hidden="true" />
              <b className="text-foreground font-semibold">Drop an idea, pick a platform, hit Generate</b>
              <p className="text-sm mt-1 max-w-md mx-auto">The AI reverse-engineers the top outlier posts ({wins.length ? `${wins.filter(w => w.outlier >= 2).length} winners ≥2× right now` : 'loading…'}), then writes 3 versions on your pillars.</p>
              {wins[0] && <p className="text-[12px] mt-3">Top outlier: <b className="text-foreground">{wins[0].outlier.toFixed(1)}×</b> — “{wins[0].hookLine.slice(0, 90)}”</p>}
            </div></Card>
          )}
        </div>
      </div>
    </div>
  );
}

