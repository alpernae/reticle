'use client';
// Settings blocks: AI providers (order, keys, test), creator profile (fed into
// every prompt), and the free YouTube Data API key.
import { useCallback, useEffect, useState } from 'react';
import { Card, CardHead, Chip, btn, btnPrimary, inputCls, labelCls } from '@/components/panel';
import { ArrowDown, ArrowUp, ExternalLink, PlugZap, Save } from 'lucide-react';
import { toast } from '@/components/toaster';
import { Sel } from '@/components/sel';
import { Spinner } from '@/components/panelui/spinner';

type ProviderId = 'claude-cli' | 'anthropic' | 'opencode';
type AIStatus = {
  config: { order: ProviderId[]; enabled: Record<ProviderId, boolean>; apiModel: string; apiEffort: string; cliModel: string; cliPath: string; opencodeModel?: string };
  cliPath: string | null; anthropicKey: string | null; claudeOAuthToken: string | null;
  models?: Record<string, { id: string; label: string }[]>; opencodeError?: string | null;
  labels: Record<ProviderId, string>;
  profile: Record<string, string>;
};
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

const HELP: Record<ProviderId, string> = {
  'claude-cli': 'Uses your Claude Pro/Max subscription through Claude Code. Install: npm i -g @anthropic-ai/claude-code, then run `claude` once to log in. No API key needed.',
  anthropic: 'Pay-as-you-go Claude API (console.anthropic.com). Fastest and most reliable for bulk analysis.',
  opencode: 'Your local OpenCode service (all providers you added with `opencode auth login`). Switched on and started automatically every time the server starts — set PAYLOAD_OPENCODE_AUTOSTART=false to stop that.',
};

export function AISettings() {
  const [s, setS] = useState<AIStatus | null>(null);
  const [test, setTest] = useState<Record<string, { busy?: boolean; msg?: string; ok?: boolean }>>({});
  const [apiKey, setApiKey] = useState('');
  const [oauth, setOauth] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(() => fetch('/api/ai').then(r => r.json()).then(setS).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  if (!s) return <Card className="p-5 text-sm text-muted-foreground">Loading AI settings…</Card>;
  if (!s.config) return <Card className="p-5 text-sm text-muted-foreground">Couldn’t load AI settings{(s as { error?: string }).error ? ` — ${(s as { error?: string }).error}` : ''}. Reload the page, or sign in again.</Card>;
  const cfg = s.config;

  const saveCfg = async (patch: Partial<AIStatus['config']>) => setS({ ...(await post('/api/ai', { action: 'config', config: { ...cfg, ...patch } })) });
  const move = (i: number, d: number) => {
    const o = [...cfg.order]; const j = i + d; if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; saveCfg({ order: o });
  };
  const runTest = async (p: ProviderId) => {
    setTest(t => ({ ...t, [p]: { busy: true } }));
    const r = await post('/api/ai', { action: 'test', provider: p }).catch((e: any) => ({ ok: false, error: e.message }));
    setTest(t => ({ ...t, [p]: { ok: r.ok, msg: r.ok ? `✓ ${r.model || ''} answered in ${(r.ms / 1000).toFixed(1)}s` : '✗ ' + (r.error || 'failed') } }));
  };
  const saveKeys = async () => {
    const body: any = { action: 'key' };
    if (apiKey.trim()) body.anthropicKey = apiKey.trim();
    if (oauth.trim()) body.claudeOAuthToken = oauth.trim();
    setS({ ...(await post('/api/ai', body)) }); setApiKey(''); setOauth(''); setSaved('keys saved locally'); toast('Keys saved', { type: 'success', description: 'Stored only in your local SQLite database.' });
  };

  return (
    <>
      <Card>
        <CardHead title="AI providers" sub="first enabled provider that answers wins — drag the order with the arrows" right={<Chip tone={s.cliPath || s.anthropicKey ? 'g' : 'r'}>{s.cliPath ? 'Claude CLI found' : s.anthropicKey ? 'API key set' : 'no Claude provider yet'}</Chip>} />
        <div className="p-4 space-y-2">
          {cfg.order.map((p, i) => (
            <div key={p} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tabular-nums w-4 text-muted-foreground">{i + 1}</span>
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input type="checkbox" checked={cfg.enabled[p]} onChange={e => saveCfg({ enabled: { ...cfg.enabled, [p]: e.target.checked } })} />
                  {s.labels[p]}
                </label>
                {p === 'claude-cli' && <Chip tone={s.cliPath ? 'g' : 'r'}>{s.cliPath ? 'found' : 'not installed'}</Chip>}
                {p === 'anthropic' && <Chip tone={s.anthropicKey ? 'g' : 'a'}>{s.anthropicKey ? 'key ' + s.anthropicKey : 'no key'}</Chip>}
                <div className="flex-1" />
                <button className={btn + ' h-8 px-2'} onClick={() => move(i, -1)} aria-label="move up"><ArrowUp className="size-3.5" aria-hidden="true" /></button>
                <button className={btn + ' h-8 px-2'} onClick={() => move(i, 1)} aria-label="move down"><ArrowDown className="size-3.5" aria-hidden="true" /></button>
                <button className={btn + ' h-8 px-3 text-xs'} onClick={() => runTest(p)} disabled={test[p]?.busy}>
                  {test[p]?.busy ? <Spinner className="size-3.5" /> : <PlugZap className="size-3.5" aria-hidden="true" />} Test
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 ml-6">{HELP[p]}</p>
              {p === 'claude-cli' && (
                <div className="mt-2 ml-6 grid sm:grid-cols-2 gap-2">
                  <div><label className={labelCls}>Model</label>
                    <Sel className={inputCls} value={cfg.cliModel} onChange={e => saveCfg({ cliModel: e.target.value })}>
                      <option value="sonnet">sonnet (fast, recommended)</option><option value="opus">opus (best quality)</option><option value="haiku">haiku (fastest)</option>
                    </Sel></div>
                  <div><label className={labelCls}>Executable path (optional)</label>
                    <input className={inputCls} defaultValue={cfg.cliPath} placeholder={s.cliPath || 'auto-detect'} onBlur={e => e.target.value !== cfg.cliPath && saveCfg({ cliPath: e.target.value })} /></div>
                  <div className="sm:col-span-2"><label className={labelCls}>Long-lived token from <code className="font-mono normal-case">claude setup-token</code> (optional)</label>
                    <input className={inputCls} type="password" autoComplete="off" placeholder={s.claudeOAuthToken || 'only needed if the CLI is not logged in for this user'} value={oauth} onChange={e => setOauth(e.target.value)} /></div>
                </div>
              )}
              {p === 'opencode' && (
                <div className="mt-2 ml-6 space-y-1">
                  <label className={labelCls}>Default OpenCode model</label>
                  <Sel className={inputCls} value={cfg.opencodeModel || ''} onChange={e => saveCfg({ opencodeModel: e.target.value })}>
                    <option value="">OpenCode's own default</option>
                    {(s.models?.opencode || []).filter(m => m.id !== 'default').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </Sel>
                  <p className="text-[11px] text-muted-foreground">{s.opencodeError ? 'Model list unavailable: ' + s.opencodeError : (s.models?.opencode?.length || 1) - 1 + ' models from your local OpenCode service (every provider you logged in with opencode auth login).'}</p>
                </div>
              )}
              {p === 'anthropic' && (
                <div className="mt-2 ml-6 grid sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-1"><label className={labelCls}>Model</label>
                    <Sel className={inputCls} value={cfg.apiModel} onChange={e => saveCfg({ apiModel: e.target.value })}>
                      <option value="claude-opus-5-5">Claude Opus 5.5</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5</option><option value="claude-haiku-5-5">Claude Haiku 5.5</option>
                    </Sel></div>
                  <div><label className={labelCls}>Effort</label>
                    <Sel className={inputCls} value={cfg.apiEffort} onChange={e => saveCfg({ apiEffort: e.target.value })}>
                      <option value="low">low (fastest)</option><option value="medium">medium</option><option value="high">high</option>
                    </Sel></div>
                  <div><label className={labelCls}>API key</label>
                    <input className={inputCls} type="password" autoComplete="off" placeholder={s.anthropicKey || 'sk-ant-…'} value={apiKey} onChange={e => setApiKey(e.target.value)} /></div>
                </div>
              )}
              {test[p]?.msg && <p className={`text-[12px] mt-2 ml-6 ${test[p]?.ok ? '' : 'text-muted-foreground'}`}>{test[p]?.msg}</p>}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button className={btnPrimary} onClick={saveKeys} disabled={!apiKey.trim() && !oauth.trim()}><Save className="size-4" aria-hidden="true" /> Save keys</button>
            <span className="text-[12px] text-muted-foreground">{saved || 'keys are stored only in the local SQLite meta table'}</span>
          </div>
        </div>
      </Card>
      <ProfileCard initial={s.profile} />
      <YouTubeKeyCard />
    </>
  );
}

const PROFILE_FIELDS: [string, string, string][] = [
  ['identity', 'Who you are', 'one or two lines'],
  ['pillars', 'Content pillars', 'comma separated'],
  ['audience', 'Audience to win', ''],
  ['voice', 'Voice', 'how you sound'],
  ['goals', 'Goals', ''],
  ['avoid', 'Never', 'hard no’s for the AI'],
  ['name', 'Name (optional)', ''],
  ['handle', 'Handle for images (optional)', '@yourhandle — printed on thumbnails, banners, slides'],
];

function ProfileCard({ initial }: { initial: Record<string, string> }) {
  const [p, setP] = useState(initial);
  const [msg, setMsg] = useState('');
  const save = async () => { await post('/api/ai', { action: 'profile', profile: p }); setMsg('saved — every AI call now uses this profile'); };
  return (
    <Card>
      <CardHead title="Creator profile" sub="the AI writes as this person — keep it honest and specific" />
      <div className="p-4 grid md:grid-cols-2 gap-3">
        {PROFILE_FIELDS.map(([k, label, ph]) => (
          <div key={k} className={k === 'identity' || k === 'pillars' ? 'md:col-span-2' : ''}>
            <label className={labelCls}>{label}</label>
            <textarea className={`${inputCls} min-h-[44px]`} rows={k === 'pillars' ? 2 : 1} placeholder={ph} value={p[k] || ''} onChange={e => { setP({ ...p, [k]: e.target.value }); setMsg(''); }} />
          </div>
        ))}
        <div className="md:col-span-2 flex items-center gap-2">
          <button className={btnPrimary} onClick={save}><Save className="size-4" aria-hidden="true" /> Save profile</button>
          <span className="text-[12px] text-muted-foreground">{msg}</span>
        </div>
      </div>
    </Card>
  );
}

function YouTubeKeyCard() {
  const [st, setSt] = useState<{ connected: boolean; mask: string | null } | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { fetch('/api/youtube').then(r => r.json()).then(setSt).catch(() => {}); }, []);
  const save = async () => {
    const r = await post('/api/youtube', { action: 'save', key });
    setSt(r); setMsg(r.error ? '✗ ' + r.error : '✓ verified and saved'); if (!r.error) setKey('');
  };
  return (
    <Card>
      <CardHead title="YouTube Data API (free)" sub="10,000 free units/day ≈ 3,000 channels — no Apify credit needed for YouTube"
        right={<a className={btn + ' h-8 px-3 text-xs'} href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">get a key <ExternalLink className="size-3.5" aria-hidden="true" /></a>} />
      <div className="p-4 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[240px]"><label className={labelCls}>API key</label>
          <input className={inputCls} type="password" autoComplete="off" placeholder={st?.mask || 'AIza…'} value={key} onChange={e => setKey(e.target.value)} /></div>
        <button className={btnPrimary} disabled={!key.trim()} onClick={save}>Save & verify</button>
        {st?.connected && <Chip tone="g">connected {st.mask}</Chip>}
        {msg && <p className="w-full text-[12px] text-muted-foreground">{msg}</p>}
        <p className="w-full text-[11px] text-muted-foreground">Google Cloud Console → new project → enable “YouTube Data API v3” → Credentials → Create API key. Restrict it to that API. Channels come from the YouTube row on Sources.</p>
      </div>
    </Card>
  );
}
