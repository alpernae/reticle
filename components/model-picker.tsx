'use client';
// Provider + model dropdown used by every AI feature (Generate, Toolkit, Formats,
// Workflows, Overview brief, AI categorizer).
// Value: '' = Auto (the provider order from Settings), or 'provider|model'.
// OpenCode models are read live from the local OpenCode service ('providerID::modelID').
// The last pick is remembered (localStorage) and shared across pages.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { labelCls } from '@/components/panel';
import { ModelPicker as PModelPicker, type ModelPickerItem, type ModelPickerProvider } from '@/components/panelui/model-picker';
import { Code2, KeyRound, Sparkles, Terminal } from 'lucide-react';

type Status = {
  config?: { order: string[]; enabled: Record<string, boolean> };
  labels?: Record<string, string>;
  models?: Record<string, { id: string; label: string }[]>;
  opencodeError?: string | null;
  opencodeStale?: boolean;
  latency?: Record<string, number>;
  modelStatus?: Record<string, { ok: boolean; msg: string; ts: number; retryAt?: number }>;
  cliPath: string | null; anthropicKey: string | null; claudeOAuthToken: string | null;
};

// Fallback when /api/ai is older than this component or returns no model list.
const FALLBACK_MODELS: Record<string, { id: string; label: string }[]> = {
  'claude-cli': [{ id: 'sonnet', label: 'Sonnet (fast, balanced)' }, { id: 'opus', label: 'Opus (best quality, slower)' }, { id: 'haiku', label: 'Haiku (fastest)' }],
  anthropic: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }],
  opencode: [{ id: 'default', label: 'OpenCode default model' }],
};
const STORE = 'payload-ai-pick';
const FAVS = 'payload-ai-favs';
const AUTO = 'auto';
const PICON: Record<string, ReactNode> = { 'claude-cli': <Terminal className="size-4" />, anthropic: <KeyRound className="size-4" />, opencode: <Code2 className="size-4" /> };

/** Turn the picker value into the `model` field the API routes accept. */
export const pickedModel = (v: string) => {
  const i = v.indexOf('|');
  return i > 0 ? { providerID: v.slice(0, i), id: v.slice(i + 1) } : null;
};
/** The remembered pick (for buttons that don't render their own picker). */
export const rememberedModel = () => { try { return pickedModel(localStorage.getItem(STORE) || ''); } catch { return null; } };

let statusCache: Promise<Status> | null = null;
// only successful answers stay cached — a 401/500 is retried on the next mount
const loadStatus = () => (statusCache ||= fetch('/api/ai').then(r => r.json())
  .then((j: Status) => { if (!j?.config) statusCache = null; return j; })
  .catch(() => { statusCache = null; return {} as Status; }));

export function ModelPicker({ value, onChange, label = 'AI provider & model', disabled, compact, remember = true }: {
  value: string; onChange: (v: string) => void; label?: string; disabled?: boolean; compact?: boolean; remember?: boolean;
}) {
  const [s, setS] = useState<Status | null>(null);
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => {
    loadStatus().then(setS);
    try { setFavs(JSON.parse(localStorage.getItem(FAVS) || '[]')); } catch {}
    if (remember && !value) { try { const v = localStorage.getItem(STORE); if (v) onChange(v); } catch {} }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: string) => { const real = v === AUTO ? '' : v; onChange(real); if (remember) { try { localStorage.setItem(STORE, real); } catch {} } };
  const changeFavs = (f: string[]) => { setFavs(f); try { localStorage.setItem(FAVS, JSON.stringify(f)); } catch {} };

  // OpenCode models are always pickable: using one starts the local service on demand.
  const ready = (p: string) => (p === 'claude-cli' ? !!(s?.cliPath) : p === 'anthropic' ? !!s?.anthropicKey : true);
  const order = s?.config?.order || ['claude-cli', 'anthropic', 'opencode'];
  const enabled = s?.config?.enabled || {};
  const labels = s?.labels || {};
  const models = s?.models || FALLBACK_MODELS;
  const autoChain = s?.config ? order.filter(p => enabled[p]).map(p => (labels[p] || p).split(' (')[0]).join(' → ') : '';

  const { items, providers } = useMemo(() => {
    const providers: ModelPickerProvider[] = [{ value: 'auto', label: 'Auto', icon: <Sparkles className="size-4" /> }];
    const items: ModelPickerItem[] = [{ value: AUTO, label: 'Auto', provider: 'auto', description: autoChain ? 'Tries ' + autoChain + ' in order (Settings)' : 'Provider order from Settings', note: autoChain || undefined }];
    for (const p of order) {
      const list = models[p] || FALLBACK_MODELS[p] || [];
      // OpenCode lists models from many upstreams: give each upstream its own provider row
      const group = (m: { id: string }) => (p === 'opencode' && m.id.includes('::') ? 'opencode:' + m.id.split('::')[0] : p);
      for (const m of list) {
        const g = group(m);
        if (!providers.some(x => x.value === g)) {
          const sub = g.startsWith('opencode:') ? 'OpenCode · ' + g.slice(9) : (labels[p] || p).split(' (')[0];
          const st = s?.modelStatus && Object.entries(s.modelStatus).some(([k, v]) => k.startsWith(p + '|') && !v.ok && v.retryAt && v.retryAt > Date.now());
          providers.push({ value: g, label: sub + (ready(p) ? '' : ' (not set up)'), icon: PICON[p], status: st ? 'limited' : undefined });
        }
        const key = p + '|' + m.id;
        const note = statusNote(s, p, m.id).replace(/^ — /, '');
        items.push({
          value: key, label: m.label.replace(/^[^/]+ \/ /, ''), provider: g,
          disabled: !ready(p) && m.id !== 'default',
          note: !ready(p) && m.id !== 'default' ? 'Not set up — see Settings' : note || undefined,
          description: s?.modelStatus?.[key]?.msg,
        });
      }
    }
    return { items, providers };
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const picker = (
    <div className={disabled ? 'pointer-events-none opacity-60' : ''} title={s?.opencodeError && value.startsWith('opencode') ? 'OpenCode service: ' + s.opencodeError : undefined}>
      <PModelPicker items={items} providers={providers} value={value || AUTO} onValueChange={change} favorites={favs} onFavoritesChange={changeFavs} variant="list" label={label}>
        <PModelPicker.Trigger appearance="outline" className={compact ? 'h-10 max-w-[300px]' : 'h-10 w-full'} disabled={disabled} />
        <PModelPicker.Content placeholder="Search models…" />
      </PModelPicker>
    </div>
  );
  if (compact) return picker;
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {picker}
    </div>
  );
}

/** Suffix for an option: quota / last failure / last response time. */
function statusNote(s: Status | null, p: string, id: string): string {
  const key = `${p}|${id}`;
  const st = s?.modelStatus?.[key];
  if (st && !st.ok) {
    if (st.retryAt && st.retryAt > Date.now()) {
      const h = (st.retryAt - Date.now()) / 36e5;
      return ` — out of quota (~${h >= 1 ? Math.round(h) + 'h' : Math.max(1, Math.round(h * 60)) + 'm'})`;
    }
    if (Date.now() - st.ts < 3 * 864e5) return /timeout|timed out|aborted due to timeout/i.test(st.msg) ? ' — timed out last time' : ' — failed last time';
  }
  const ms = s?.latency?.[key];
  return ms ? ` — last ${ms >= 60000 ? Math.round(ms / 6000) / 10 + ' min' : Math.round(ms / 1000) + 's'}` : '';
}
