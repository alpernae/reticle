'use client';
// Polish — revise ONE generated draft without re-running the whole generation.
// Presets + your own instruction, grounded in the original brief, with the
// pattern-fit score before → after and a version history (v1 = original).
import { useState } from 'react';
import { btn, btnPrimary, inputCls, notifyActivity } from '@/components/panel';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { FitBadge, type Fit } from '@/components/fit-badge';
import { Check, Wand2, X as XIcon } from 'lucide-react';
import { FirstReply, LengthBadge } from '@/components/length-info';
import { Spinner } from '@/components/panelui/spinner';

const PRESETS: { key: string; label: string; text: string }[] = [
  { key: 'clarify', label: 'Clarify what & who', text: 'Make it unmistakable WHAT this is and WHO it is for, and state any prerequisite from the brief (e.g. "only if you build on Supabase") so the wrong reader does not try it and fail.' },
  { key: 'hook', label: 'Stronger hook', text: 'Rewrite the first line into a stronger hook using a hook type that lifts results in the pattern table — specific, concrete, tension or proof.' },
  { key: 'specific', label: 'More specific', text: 'Replace vague claims with the concrete specifics from the brief (names, features, steps, the link).' },
  { key: 'shorter', label: 'Shorter', text: 'Make it tighter and shorter — cut filler, keep the hook, the what/who and the CTA.' },
  { key: 'hype', label: 'Less hype', text: 'Tone down hype and overconfidence — sound like a practitioner sharing something useful, not an ad.' },
  { key: 'cta', label: 'Better CTA', text: 'Rewrite the call to action so it is natural, specific and easy to act on (for X: put the link in the first reply if there is one).' },
  { key: 'voice', label: 'More like me', text: 'Make it sound more like the creator profile voice: first person, direct, a bit nerdy, specific.' },
];

type Version = { text: string; fit?: Fit; changes?: string[]; instruction?: string; firstReply?: string };

/**
 * Renders a "Polish" button; when used, shows the polish panel below the post.
 * `onApply(text, fit)` replaces the post in the parent card.
 */
export function PolishBox({ text, platform, format, brief, score = true, onApply }: {
  text: string; platform: string; format?: string | null; brief?: string; score?: boolean;
  onApply: (text: string, fit?: Fit, firstReply?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [versions, setVersions] = useState<Version[]>([]);
  const [sel, setSel] = useState(0);

  const run = async (base: string) => {
    const instr = [...PRESETS.filter(p => presets.includes(p.key)).map(p => p.text), instruction.trim()].filter(Boolean).join(' ');
    if (!instr) { setErr('Pick a preset or write what to change.'); return; }
    setBusy(true); setErr(''); setTimeout(notifyActivity, 300);
    const r = await fetch('/api/polish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: base, instruction: instr, platform, format, brief, score, model: pickedModel(model) }) })
      .then(x => x.json()).catch((e: any) => ({ error: e.message }));
    setBusy(false);
    if (r.error || !r.text) { setErr(r.error || 'no answer'); return; }
    setVersions(v => {
      const list = v.length ? v : [{ text: base, fit: r.fitBefore }];
      const next = [...list, { text: r.text, fit: r.fitAfter, changes: r.changes, instruction: instr, firstReply: r.firstReply }];
      setSel(next.length - 1);
      return next;
    });
  };

  if (!open) return (
    <button className={btn + ' h-8 px-3 text-xs'} onClick={() => setOpen(true)} title="Fix this post without re-generating everything">
      <Wand2 className="size-3.5" aria-hidden="true" /> Polish
    </button>
  );

  const cur = versions[sel];
  return (
    <div className="w-full basis-full rounded-lg border border-border bg-muted/40 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold flex items-center gap-1.5"><Wand2 className="size-3.5" aria-hidden="true" /> Polish this post</span>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} aria-label="close polish"><XIcon className="size-4" aria-hidden="true" /></button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => setPresets(s => s.includes(p.key) ? s.filter(x => x !== p.key) : [...s, p.key])} title={p.text}
            className={`h-7 rounded-full px-2.5 text-[11px] font-medium border ${presets.includes(p.key) ? 'bg-primary text-primary-foreground border-transparent' : 'border-border bg-card hover:bg-muted'}`}>{p.label}</button>
        ))}
      </div>
      <textarea className={inputCls + ' min-h-[60px] text-[13px]'} value={instruction} onChange={e => setInstruction(e.target.value)}
        placeholder="What should change? e.g. say it's a collection of Agent Skills for Claude Code / Cursor / Codex, and that the Supabase auth skills only help if you build on Supabase" />
      <div className="flex flex-wrap items-center gap-2">
        <ModelPicker compact value={model} onChange={setModel} label="AI for polishing" disabled={busy} />
        <button className={btnPrimary + ' h-9'} disabled={busy} onClick={() => run(cur ? cur.text : text)}>
          {busy ? <><Spinner className="size-4" /> Polishing…</> : <><Wand2 className="size-4" aria-hidden="true" /> {versions.length ? `Polish v${sel + 1} again` : 'Polish'}</>}
        </button>
        {err && <span className="text-[11px] text-muted-foreground">✗ {err}</span>}
      </div>
      {!brief && <p className="text-[11px] text-muted-foreground">No original brief attached — the AI can only rephrase, not add facts. Put the details in your instruction.</p>}

      {versions.length > 1 && cur && (
        <div className="space-y-2 border-t border-border pt-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {versions.map((_, i) => (
              <button key={i} onClick={() => setSel(i)} className={`h-7 rounded-md px-2.5 text-[11px] font-medium ${sel === i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{i === 0 ? 'original' : `v${i + 1}`}</button>
            ))}
          </div>
          <p className="whitespace-pre-wrap rounded-md bg-card border border-border p-3 text-[14px] leading-snug">{cur.text}</p>
          <FirstReply link={cur.firstReply} />
          {cur.changes?.length ? <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">{cur.changes.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
          <div className="flex flex-wrap items-center gap-2">
            {score && versions[0].fit && cur.fit && sel > 0 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">fit {versions[0].fit.score.toFixed(2)}× → <b className="text-foreground">{cur.fit.score.toFixed(2)}×</b></span>
            )}
            <FitBadge fit={cur.fit} />
            <LengthBadge platform={platform} text={cur.text} format={format} thread={format === 'x-thread' || format === 'th-chain'} />
            <div className="flex-1" />
            {sel > 0 && <button className={btnPrimary + ' h-8 px-3 text-xs'} onClick={() => { onApply(cur.text, cur.fit, cur.firstReply); setOpen(false); }}><Check className="size-3.5" aria-hidden="true" /> Use this</button>}
            <button className={btn + ' h-8 px-3 text-xs'} onClick={() => { setVersions([]); setSel(0); }}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
