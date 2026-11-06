'use client';
// Toolkit — platform-specific creator tools for Instagram, X, LinkedIn and
// YouTube: bios, captions, threads, titles, descriptions, scripts, hashtags,
// replies, plus visual designers (thumbnails, reel covers, carousels, banners,
// post images). Text tools are grounded in your collected data for the chosen
// platform; visuals render in the browser.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardHead, Chip, PageHead, btn, btnPrimary, inputCls, labelCls, notifyActivity } from '@/components/panel';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { Designer, type Slide } from '@/components/designer';
import { FitBadge, type Fit } from '@/components/fit-badge';
import { PolishBox } from '@/components/polish-box';
import { FirstReply, LengthBadge } from '@/components/length-info';
import { toolFormat } from '@/lib/playbook';
import { MeasuredTags, type MeasuredTag } from '@/components/measured-tags';
import { PLATFORM_LIMITS, TOOL_PLATFORMS, toolsFor, type ToolDef, type ToolGroup, type ToolPlatform } from '@/lib/tools';
import {
  Check, Copy, Sparkles, UserRound, Lightbulb, PenLine, Hash, MessageCircleReply, Image as ImageIcon, Camera, BriefcaseBusiness, CirclePlay, AtSign,
  MessagesSquare,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Sel } from '@/components/sel';
import { Spinner } from '@/components/panelui/spinner';

const GROUP_ICON: Record<ToolGroup, ComponentType<{ className?: string }>> = {
  Profile: UserRound, Ideas: Lightbulb, Writing: PenLine, Discovery: Hash, Engagement: MessageCircleReply, Visual: ImageIcon,
};
const PLAT_ICON: Record<ToolPlatform, ComponentType<{ className?: string }>> = { instagram: Camera, threads: MessagesSquare, x: AtSign, linkedin: BriefcaseBusiness, youtube: CirclePlay };
const GROUPS: ToolGroup[] = ['Profile', 'Ideas', 'Writing', 'Discovery', 'Engagement', 'Visual'];

type Res = { lengths?: { length: number; limit: number | null; over: boolean; shortened: number; firstReply: string }[]; replyChecks?: { style: string; ok: boolean | null; why: string }[]; rule?: string | null; dataHashtags?: MeasuredTag[]; items?: string[]; fits?: Fit[]; fit?: Fit; text?: string; slides?: Slide[]; error?: string; via?: { providerID: string; id: string }; ms?: number; postsOnPlatform?: number } | null;

export default function Toolkit() {
  const [platform, setPlatform] = useState<ToolPlatform>('x');
  const [toolKey, setToolKey] = useState('bio');
  const [model, setModel] = useState('');
  const [handle, setHandle] = useState('');
  const [urlRead, setUrlRead] = useState(false);
  const [reopen, setReopen] = useState<{ tool: string; platform: string; input: Record<string, string>; output: Res } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get('p') as ToolPlatform | null, t = q.get('t');
    if (p && TOOL_PLATFORMS.some(x => x.key === p)) setPlatform(p);
    if (t) setToolKey(t);
    const runId = q.get('run');
    if (runId) fetch('/api/activity?id=' + encodeURIComponent(runId)).then(r => r.json()).then(j => {
      if (j?.run?.output) { const { tool: t2, ...inp } = j.run.input || {}; setReopen({ tool: String(t2 || t || ''), platform: String(j.run.platform || p || ''), input: inp, output: j.run.output }); }
    }).catch(() => {});
    setUrlRead(true);
    fetch('/api/ai').then(r => r.json()).then(j => setHandle(j?.profile?.handle || '')).catch(() => {});
  }, []);
  const tools = toolsFor(platform);
  const tool = tools.find(t => t.key === toolKey) || tools[0];
  useEffect(() => { // keep URL shareable — only after the incoming ?p=&t= was read
    if (!urlRead) return;
    const u = new URL(window.location.href); u.searchParams.set('p', platform); u.searchParams.set('t', tool.key); window.history.replaceState(null, '', u);
  }, [urlRead, platform, tool.key]);

  return (
    <div className="space-y-4">
      <PageHead title="Toolkit" sub="Platform-specific tools — every text tool reads your collected winners, pattern lifts and real hashtag performance for the platform you pick."
        right={<div className="w-72"><ModelPicker value={model} onChange={setModel} label="AI" /></div>} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {TOOL_PLATFORMS.map(p => { const Icon = PLAT_ICON[p.key]; return (
            <button key={p.key} onClick={() => setPlatform(p.key)} className={`inline-flex items-center gap-1.5 h-8 rounded-md px-3 text-[13px] font-medium ${platform === p.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              <Icon className="size-3.5" aria-hidden="true" />{p.label}
            </button>); })}
        </div>
        <span className="text-[11px] text-muted-foreground">{PLATFORM_LIMITS[platform].note}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">
        <Card className="p-2">
          {GROUPS.map(g => {
            const list = tools.filter(t => t.group === g);
            if (!list.length) return null;
            const Icon = GROUP_ICON[g];
            return (
              <div key={g} className="mb-2">
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 flex items-center gap-1.5"><Icon className="size-3" aria-hidden="true" />{g}</div>
                {list.map(t => (
                  <button key={t.key} onClick={() => setToolKey(t.key)} className={`w-full text-left rounded-md px-2.5 py-1.5 text-[13px] ${t.key === tool.key ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted'}`}>{t.name}</button>
                ))}
              </div>
            );
          })}
        </Card>
        {(() => { // the reopened result only belongs to the tool + platform it came from
          const mine = reopen && reopen.tool === tool.key && reopen.platform === platform ? reopen : null;
          return <ToolPanel key={platform + tool.key + (mine ? ':r' : '')} tool={tool} platform={platform} model={model} handle={handle} initial={mine} />;
        })()}
      </div>
    </div>
  );
}

function ToolPanel({ tool, platform, model, handle, initial }: { tool: ToolDef; platform: ToolPlatform; model: string; handle: string; initial?: { input: Record<string, string>; output: Res } | null }) {
  const own = (o?: Record<string, string>) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => tool.fields.some(fl => fl.key === k)));
  const [input, setInput] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(tool.fields.filter(f => f.kind === 'select').map(f => [f.key, f.options?.[0]?.value || ''])), ...own(initial?.input) }));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res>(initial?.output || null);
  const missing = tool.fields.filter(f => !f.optional && f.kind !== 'select' && !(input[f.key] || '').trim()).map(f => f.label);

  const run = async () => {
    setBusy(true); setRes(null);
    setTimeout(notifyActivity, 300);
    const r = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: tool.key, platform, input, model: pickedModel(model) }) })
      .then(x => x.json()).catch((e: any) => ({ error: e.message }));
    setRes(r); setBusy(false);
  };
  const isVisual = !!tool.visual;

  return (
    <div className="space-y-4">
      <Card>
        <CardHead title={tool.name} sub={tool.desc} right={<Chip tone="a">{tool.group}</Chip>} />
        <div className="p-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            {tool.fields.map(f => (
              <div key={f.key} className={f.kind === 'textarea' ? 'md:col-span-2' : ''}>
                <label className={labelCls}>{f.label}{f.optional ? <span className="font-normal normal-case"> (optional)</span> : null}</label>
                {f.kind === 'select'
                  ? <Sel className={inputCls} value={input[f.key] || ''} onChange={e => setInput(s => ({ ...s, [f.key]: e.target.value }))}>{f.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Sel>
                  : f.kind === 'textarea'
                    ? <textarea className={inputCls + ' min-h-[80px]'} value={input[f.key] || ''} placeholder={f.placeholder} onChange={e => setInput(s => ({ ...s, [f.key]: e.target.value }))} />
                    : <input className={inputCls} value={input[f.key] || ''} placeholder={f.placeholder} onChange={e => setInput(s => ({ ...s, [f.key]: e.target.value }))} />}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnPrimary} onClick={run} disabled={busy || missing.length > 0} title={missing.length ? 'fill: ' + missing.join(', ') : undefined}>
              {busy ? <><Spinner className="size-4" /> Working…</> : <><Sparkles className="size-4" aria-hidden="true" /> {isVisual ? (tool.output === 'slides' ? 'Write slides with AI' : 'Suggest text with AI') : 'Generate'}</>}
            </button>
            {missing.length > 0 && <span className="text-[11px] text-muted-foreground">needs: {missing.join(', ')}</span>}
            {res?.via && <span className="text-[11px] text-muted-foreground">via {res.via.providerID} · {res.via.id}{res.ms ? ` · ${(res.ms / 1000).toFixed(1)}s` : ''} · {res.postsOnPlatform ?? 0} {platform} posts in your data{(res.postsOnPlatform ?? 0) < 8 ? ' (thin — collect more on Sources)' : ''}</span>}
          </div>
          {res?.error && <p className="text-[12px] text-muted-foreground">✗ {res.error}</p>}
        </div>
      </Card>

      {isVisual && (
        <Card>
          <CardHead title="Designer" sub="edit anything — the preview is the exact export size" />
          <div className="p-4">
            <Designer kind={tool.visual!} platform={platform} suggestions={res?.items} slides={res?.slides} handle={handle} />
          </div>
        </Card>
      )}
      {!isVisual && res?.items && <Items key={String(res.items.length) + (res.items[0] || '').slice(0, 20)} items={res.items} replies1={res.lengths?.map(l => l.firstReply)} shortened={res.lengths?.filter(l => l.shortened).length || 0} fits={res.fits} checks={res.replyChecks} rule={res.rule} platform={platform} tool={tool} brief={briefOf(tool, input)} />}
      {tool.key === 'hashtags' && res && !res.error && <MeasuredTags tags={res.dataHashtags || []} platform={platform} />}
      {!isVisual && res?.text && <Single text={res.text} fit={res.fit} platform={platform} tool={tool} brief={briefOf(tool, input)} />}
      {!res && !isVisual && (
        <p className="text-[12px] text-muted-foreground px-1">Tip: set your voice, pillars and handle in <Link href="/settings" className="underline">Settings → Creator profile</Link> — every tool writes as that person.</p>
      )}
    </div>
  );
}

function useSaved() {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const save = async (k: string, platform: string, text: string) => {
    await fetch('/api/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform, text, eng: 0, when: '' }) }).catch(() => {});
    setSaved(s => ({ ...s, [k]: true }));
  };
  return { saved, save };
}
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button className={btn + ' h-8 px-3 text-xs'} onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>{ok ? <><Check className="size-3.5" aria-hidden="true" /> Copied</> : <><Copy className="size-3.5" aria-hidden="true" /> Copy</>}</button>;
}

type ReplyCheck = { style: string; ok: boolean | null; why: string };

function Items({ items: initial, replies1, shortened, fits: initialFits, checks, rule, platform, tool, brief }: { items: string[]; replies1?: string[]; shortened: number; fits?: Fit[]; checks?: ReplyCheck[]; rule?: string | null; platform: ToolPlatform; tool: ToolDef; brief: string }) {
  const [firstReplies, setFirstReplies] = useState<(string | undefined)[]>(replies1 || []);
  const { saved, save } = useSaved();
  // local copies so Polish can replace a single post in place
  const [items, setItems] = useState(initial);
  const [fits, setFits] = useState(initialFits);
  const polishable = !['hashtags', 'ideas'].includes(tool.key);
  const limit = tool.key === 'bio' && platform !== 'linkedin' ? PLATFORM_LIMITS[platform].bio : ['caption', 'repurpose', 'pinned', 'replies'].includes(tool.key) ? PLATFORM_LIMITS[platform].post : 0;
  const postable = ['caption', 'repurpose', 'pinned', 'hooks'].includes(tool.key);
  return (
    <div className="space-y-2">
      {tool.key !== 'replies' && shortened > 0 && <p className="text-[12px] text-muted-foreground px-1">{shortened} draft{shortened > 1 ? 's were' : ' was'} over the platform limit and got shortened automatically (counted the way the platform counts).</p>}
      {tool.key === 'replies' && (
        <p className="text-[12px] text-muted-foreground px-1">
          {shortened ? <>{shortened} draft{shortened > 1 ? 's were' : ' was'} over the limit and got shortened automatically. </> : null}{rule ? <>Detected the post’s rule: <b className="text-foreground">“{rule}”</b> — replies that obey it are listed first.</> : 'No explicit rule in the post — replies match its length and tone.'}
        </p>
      )}
    <div className="grid md:grid-cols-2 gap-3">
      {items.map((it, i) => {
        const c = checks?.[i];
        return (
          <Card key={i} className="p-3 flex flex-col gap-2">
            {c?.style && <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.style}</span>}
            <p className="whitespace-pre-wrap text-[14px] leading-snug flex-1">{it}</p>
            <FirstReply link={firstReplies[i]} />
            <div className="flex flex-wrap items-center gap-2">
              <CopyBtn text={it} />
              <FitBadge fit={fits?.[i]} />
              {c && c.ok !== null && <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${c.ok ? 'bg-primary text-primary-foreground' : 'border-2 border-foreground font-semibold'}`}>{c.ok ? '✓' : '✗'} {c.why}</span>}
              {postable && <button className={btn + ' h-8 px-3 text-xs'} disabled={saved[i]} onClick={() => save(String(i), platform, it)}>{saved[i] ? '✓ in Winners' : 'Save to Winners'}</button>}
              <span className="ml-auto"><LengthBadge platform={platform} text={it} limit={limit || null} /></span>
              {polishable && <PolishBox text={it} platform={platform} format={toolFormat(tool.key, platform)} brief={brief} score={postable}
                onApply={(t, f, fr) => { setItems(a => a.map((x, k) => (k === i ? t : x))); setFits(a => (a ? a.map((x, k) => (k === i ? (f as Fit) : x)) : a)); if (fr) setFirstReplies(a => { const n = [...a]; n[i] = fr; return n; }); }} />}
            </div>
          </Card>
        );
      })}
    </div>
    </div>
  );
}

function Single({ text, fit: initialFit, platform, tool, brief }: { text: string; fit?: Fit; platform: ToolPlatform; tool: ToolDef; brief: string }) {
  const { saved, save } = useSaved();
  const [val, setVal] = useState(text);
  const [fit, setFit] = useState(initialFit);
  useEffect(() => setVal(text), [text]);
  const len = useMemo(() => [...val].length, [val]);
  return (
    <Card className="p-3 space-y-2">
      <textarea className={inputCls + ' min-h-[320px] font-sans text-[14px] leading-relaxed'} value={val} onChange={e => setVal(e.target.value)} />
      <div className="flex items-center gap-2">
        <CopyBtn text={val} />
        <FitBadge fit={fit} />
        <button className={btn + ' h-8 px-3 text-xs'} disabled={saved.one} onClick={() => save('one', platform, val)}>{saved.one ? '✓ in Winners' : 'Save to Winners'}</button>
        <span className="ml-auto"><LengthBadge platform={platform} text={val} limit={tool.key === 'thread' ? undefined : null} thread={tool.key === 'thread'} /></span>
      </div>
      <PolishBox text={val} platform={platform} format={toolFormat(tool.key, platform)} brief={brief} score={['thread', 'caption'].includes(tool.key)} onApply={(t, f) => { setVal(t); if (f) setFit(f); }} />
    </Card>
  );
}

/** The creator's own words for this tool (its text fields) — the only facts Polish may use. */
function briefOf(tool: ToolDef, input: Record<string, string>): string {
  return tool.fields.filter(f => f.kind !== 'select' && (input[f.key] || '').trim()).map(f => `${f.label}: ${input[f.key].trim()}`).join('\n');
}
