'use client';
// Settings → Playbook: edit the layered system prompts (platform / format /
// role / per-platform voice), reset any of them to the default, and preview the
// exact system prompt a given call will receive.
import { useEffect, useMemo, useState } from 'react';
import { Card, CardHead, Chip, btn, btnPrimary, inputCls, labelCls } from '@/components/panel';
import { Eye, RotateCcw, Save } from 'lucide-react';
import { Sel } from '@/components/sel';

type Entry = { label: string; system: string; platforms?: string[] };
type Data = {
  defaults: { platforms: Record<string, Entry>; formats: Record<string, Entry>; roles: Record<string, Entry> };
  formatsByPlatform: Record<string, string[]>;
  overrides: { platforms?: Record<string, string>; formats?: Record<string, string>; roles?: Record<string, string>; voice?: Record<string, string> };
};
type Kind = 'platforms' | 'formats' | 'roles' | 'voice';
const TABS: { key: Kind; label: string; hint: string }[] = [
  { key: 'platforms', label: 'Platforms', hint: 'How each network distributes content — structure, limits, links, hashtags, CTA.' },
  { key: 'voice', label: 'Voice per platform', hint: 'Optional: how YOU sound on that platform (e.g. more formal on LinkedIn, punchier on X). Added after the platform rules.' },
  { key: 'formats', label: 'Formats', hint: 'Structure of a thread, carousel, Reel, Short, document post…' },
  { key: 'roles', label: 'Tool roles', hint: 'The specialist each tool/task asks the AI to be. Added last, so it is the most specific.' },
];

const post = (b: unknown) => fetch('/api/playbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

export function PlaybookEditor() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState<Kind>('platforms');
  const [key, setKey] = useState('x');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [pv, setPv] = useState({ platform: 'x', format: 'x-thread', role: 'thread' });
  const [preview, setPreview] = useState<{ text: string; chars: number } | null>(null);

  useEffect(() => { fetch('/api/playbook').then(r => r.json()).then(setD).catch(() => {}); }, []);

  const items: [string, Entry][] = useMemo(() => {
    if (!d) return [];
    if (tab === 'voice') return Object.entries(d.defaults.platforms).map(([k, v]) => [k, { label: v.label, system: '' }]);
    return Object.entries(d.defaults[tab]);
  }, [d, tab]);
  const def = items.find(([k]) => k === key)?.[1];
  const over = d?.overrides?.[tab]?.[key];
  useEffect(() => { if (items.length && !items.some(([k]) => k === key)) setKey(items[0][0]); }, [items, key]);
  useEffect(() => { setText(over ?? def?.system ?? ''); setMsg(''); }, [key, tab, over, def]);

  if (!d) return <Card className="p-5 text-sm text-muted-foreground">Loading playbook…</Card>;
  const modified = (k: string) => !!d.overrides?.[tab]?.[k];
  const save = async () => { const r = await post({ kind: tab, key, text }); setD({ ...d, overrides: r.overrides }); setMsg('saved — used from the next AI call'); };
  const reset = async () => { const r = await post({ kind: tab, key, text: null }); setD({ ...d, overrides: r.overrides }); setMsg(tab === 'voice' ? 'voice note cleared' : 'reset to default'); };
  const runPreview = async () => {
    const q = new URLSearchParams({ preview: '1', platform: pv.platform, format: pv.format, role: pv.role });
    setPreview(await fetch('/api/playbook?' + q).then(r => r.json()));
  };
  const curTab = TABS.find(t => t.key === tab)!;

  return (
    <Card>
      <CardHead title="Playbook — system prompts" sub="every AI call = your creator profile + platform playbook + your voice note + format playbook + tool role. Edit any layer; reset brings back the default." />
      <div className="p-4 space-y-4">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {TABS.map(t => <button key={t.key} onClick={() => setTab(t.key)} className={`h-8 rounded-md px-3 text-[13px] font-medium ${tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>{t.label}</button>)}
        </div>
        <p className="text-[12px] text-muted-foreground">{curTab.hint}</p>
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border p-1">
            {items.map(([k, v]) => (
              <button key={k} onClick={() => setKey(k)} className={`w-full text-left rounded-md px-2.5 py-1.5 text-[13px] flex items-center justify-between gap-2 ${k === key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                <span className="truncate">{v.label}{tab === 'formats' && v.platforms ? <span className="opacity-60"> · {v.platforms.join(', ')}</span> : null}</span>
                {modified(k) && <span className="text-[10px] font-semibold uppercase opacity-80">{tab === 'voice' ? 'set' : 'edited'}</span>}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <textarea className={inputCls + ' min-h-[320px] font-mono text-[12px] leading-relaxed'} value={text} onChange={e => setText(e.target.value)}
              placeholder={tab === 'voice' ? 'e.g. On LinkedIn: calm, mentor-like, a bit more formal; no slang; one emoji max.' : ''} />
            <div className="flex flex-wrap items-center gap-2">
              <button className={btnPrimary} onClick={save} disabled={text === (over ?? def?.system ?? '')}><Save className="size-4" aria-hidden="true" /> Save</button>
              {(modified(key)) && <button className={btn} onClick={reset}><RotateCcw className="size-4" aria-hidden="true" /> {tab === 'voice' ? 'Clear' : 'Reset to default'}</button>}
              {modified(key) ? <Chip tone="a">{tab === 'voice' ? 'voice note set' : 'your version'}</Chip> : <Chip tone="z">{tab === 'voice' ? 'no voice note' : 'default'}</Chip>}
              <span className="text-[12px] text-muted-foreground">{msg}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <div className="text-[13px] font-semibold flex items-center gap-2"><Eye className="size-4" aria-hidden="true" />Preview the full system prompt for a call</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className={labelCls}>Platform</label>
              <Sel className={inputCls + ' h-9 w-auto'} value={pv.platform} onChange={e => setPv({ ...pv, platform: e.target.value, format: d.formatsByPlatform[e.target.value]?.[0] || '' })}>
                {Object.entries(d.defaults.platforms).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Sel></div>
            <div><label className={labelCls}>Format</label>
              <Sel className={inputCls + ' h-9 w-auto'} value={pv.format} onChange={e => setPv({ ...pv, format: e.target.value })}>
                <option value="">none</option>
                {(d.formatsByPlatform[pv.platform] || []).map(k => <option key={k} value={k}>{d.defaults.formats[k].label}</option>)}
              </Sel></div>
            <div><label className={labelCls}>Role</label>
              <Sel className={inputCls + ' h-9 w-auto'} value={pv.role} onChange={e => setPv({ ...pv, role: e.target.value })}>
                <option value="">none</option>
                {Object.entries(d.defaults.roles).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Sel></div>
            <button className={btn} onClick={runPreview}>Show</button>
            {preview && <span className="text-[11px] text-muted-foreground tabular-nums">{preview.chars.toLocaleString()} characters</span>}
          </div>
          {preview && <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px] leading-relaxed">{preview.text}</pre>}
        </div>
      </div>
    </Card>
  );
}
