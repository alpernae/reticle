'use client';
// Settings — the user's Apify API key (verified before storing; lives only in
// the local SQLite meta table) and an honest view of what this panel stores
// locally. DB facts come from /api/settings; token writes go through /api/apify.
import { useCallback, useEffect, useState } from 'react';
import { Card, CardHead, Chip, PageHead, btn, btnPrimary, inputCls, labelCls } from '@/components/panel';
import { Database, KeyRound, Info, ExternalLink, Globe } from 'lucide-react';
import { AISettings } from '@/components/ai-settings';
import { PlaybookEditor } from '@/components/playbook-editor';
import { Spinner } from '@/components/panelui/spinner';

const selCls = inputCls;

type DbStats = {
  file: string;
  sizeBytes: number;
  journal: string;
  backup: string;
  counts: { posts: number; winners: number; jobs: number; meta: number };
};
type ApifyStatus = {
  connected: boolean;
  mask: string | null;
  verifiedAs?: string;
  error?: string;
  runs: { id: string; platform: string; ts: number; status: string; imported: { added: number; updated: number; skipped: number } | null }[];
};
type TzInfo = { saved: string | null; current: string; detected: string; options: string[] };
type Data = { db: DbStats; apify: ApifyStatus; timezone: TzInfo } | null;

const kfmtBytes = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B');
const fmtN = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US') : '0');

export default function Settings() {
  const [d, setD] = useState<Data>(null);
  const [tokenIn, setTokenIn] = useState('');
  const [tokMsg, setTokMsg] = useState<string | null>(null);
  const [busyTok, setBusyTok] = useState(false);
  const [tzIn, setTzIn] = useState('');
  const [tzMsg, setTzMsg] = useState<string | null>(null);
  const [busyTz, setBusyTz] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch('/api/settings')).json();
      setD(j);
      if (j?.timezone) setTzIn(j.timezone.saved || j.timezone.current);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveToken = async () => {
    setBusyTok(true); setTokMsg(null);
    try {
      const r = await fetch('/api/apify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', token: tokenIn.trim() }) });
      const j = await r.json();
      if (r.ok) { setTokMsg('✓ verified as ' + (j.verifiedAs || 'unknown') + ' — stored locally in data.sqlite only'); setTokenIn(''); }
      else setTokMsg('✗ ' + (j.error || 'token rejected'));
    } catch (e: any) { setTokMsg('✗ ' + e.message); }
    setBusyTok(false);
    load();
  };
  const clearToken = async () => {
    setBusyTok(true);
    await fetch('/api/apify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear' }) });
    setTokMsg('token removed');
    setBusyTok(false);
    load();
  };

  const db = d?.db;

  const saveTz = async () => {
    setBusyTz(true); setTzMsg(null);
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: tzIn.trim() }) });
      const j = await r.json();
      if (r.ok) {
        setD(cur => (cur ? { ...cur, timezone: j.timezone } : cur));
        setTzIn(j.timezone.saved || j.timezone.current);
        setTzMsg('✓ saved — schedules and hour analytics now use ' + j.timezone.current);
      } else setTzMsg('✗ ' + (j.error || 'could not save that zone'));
    } catch (e: any) { setTzMsg('✗ ' + e.message); }
    setBusyTz(false);
  };
  const browserTz = () => { try { setTzIn(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch {} };

  return (
    <div className="space-y-4">
      <PageHead
        title="Settings"
        sub="AI providers, your creator profile, collector keys — all stored on this machine only."
        right={<Chip tone={(d as any)?.apify?.connected ? 'g' : 'r'}>{(d as any)?.apify?.connected ? 'Apify connected' : 'Apify not connected'}</Chip>}
      />

      {/* ---- Apify API key ---- */}
      <Card>
        <CardHead
          title="Apify connection"
          sub="X · LinkedIn · Instagram · TikTok (and optionally YouTube) collectors run through your own Apify account"
          right={<a className={btn + ' h-8 px-3 text-xs'} href="https://console.apify.com/settings/integrations" target="_blank" rel="noreferrer">get a token <ExternalLink className="size-3.5" aria-hidden="true" /></a>}
        />
        <div className="p-4 flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className={labelCls}>Apify API token</label>
            <input
              className={selCls}
              type="password"
              autoComplete="off"
              placeholder={d?.apify?.connected ? d.apify.mask || 'connected' : 'apify_api_…'}
              value={tokenIn}
              onChange={e => setTokenIn(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2 pt-[22px]">
            <button onClick={saveToken} disabled={busyTok || !tokenIn.trim()} className={btnPrimary}>
              {busyTok ? <Spinner className="size-4" /> : <KeyRound className="size-4" aria-hidden="true" />}
              {busyTok ? 'Verifying…' : 'Save & verify'}
            </button>
            {d?.apify?.connected && (
              <button onClick={clearToken} disabled={busyTok} className={btn + ' text-muted-foreground hover:text-foreground h-9 px-3 text-[13px]'}>Remove</button>
            )}
          </div>
        </div>
        <div className="px-4 pb-4 space-y-1.5">
          {tokMsg && <p className={`text-[12px] ${tokMsg.startsWith('✓') ? 'text-foreground' : 'text-muted-foreground'}`}>{tokMsg}</p>}
          {d?.apify?.connected && (
            <p className="text-[12px] text-muted-foreground">connected {d.apify.mask ? `(${d.apify.mask})` : ''} — collectors and run history live on the Sources page</p>
          )}
          <p className="text-[11px] text-muted-foreground flex gap-1.5"><Info className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            The token is verified against Apify before being stored, and stored <b className="text-foreground">only</b> in the local SQLite <code className="font-mono">meta</code> table — never committed, never synced. Free plan: <b className="text-foreground">$5 usage credit every month</b> (resets, does not roll over); X/IG/LinkedIn actors are pay-per-result and maxItems caps each run.
          </p>
        </div>
      </Card>

      {/* ---- time zone ---- */}
      <Card>
        <CardHead
          title="Time zone"
          sub="Schedules and “best time to post” hours are wall-clock time in this zone — the Docker image runs in UTC by default"
          right={d?.timezone ? <Chip tone="a">{d.timezone.current}</Chip> : <Chip tone="a">reading…</Chip>}
        />
        <div className="p-4 flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className={labelCls}>IANA time zone</label>
            <input
              className={selCls}
              list="tz-options"
              placeholder="Europe/Istanbul"
              value={tzIn}
              onChange={e => setTzIn(e.target.value)}
            />
            <datalist id="tz-options">
              {(d?.timezone?.options || []).map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div className="flex items-end gap-2 pt-[22px]">
            <button onClick={browserTz} disabled={busyTz} className={btn + ' h-9 px-3 text-[13px]'}>Use browser zone</button>
            <button onClick={saveTz} disabled={busyTz || !tzIn.trim()} className={btnPrimary}>
              {busyTz ? <Spinner className="size-4" /> : <Globe className="size-4" aria-hidden="true" />}
              {busyTz ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div className="px-4 pb-4 space-y-1.5">
          {tzMsg && <p className={`text-[12px] ${tzMsg.startsWith('✓') ? 'text-foreground' : 'text-muted-foreground'}`}>{tzMsg}</p>}
          <p className="text-[12px] text-muted-foreground">
            Active: <b className="text-foreground">{d?.timezone?.current || '—'}</b>{d?.timezone?.saved ? '' : ' (server default)'} · server default <code className="font-mono">{d?.timezone?.detected || '—'}</code>
          </p>
          <p className="text-[11px] text-muted-foreground flex gap-1.5"><Info className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Stored locally in <code className="font-mono">data.sqlite</code>. “Daily 09:00” means 09:00 here, even when the container runs in UTC.
          </p>
        </div>
      </Card>

      <AISettings />

      <PlaybookEditor />

      {/* ---- local data facts ---- */}
      <Card>
        <CardHead
          title="Local data — yes, it's all SQLite"
          sub="one local database file; nothing is uploaded anywhere, the only outbound traffic is your own collector pulls"
          right={d ? <Chip tone="a">{kfmtBytes(db!.sizeBytes)} · {db!.journal}</Chip> : <Chip tone="a">reading…</Chip>}
        />
        {db && (
          <div className="p-4 pt-0 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { k: 'posts', v: db.counts.posts, s: 'collected + imported posts' },
                { k: 'winners', v: db.counts.winners, s: 'stored results (auto-saved from Generate)' },
                { k: 'workflows', v: db.counts.jobs, s: 'workflow run history' },
                { k: 'meta', v: db.counts.meta, s: 'token · budget · run history · AI status' },
              ].map(x => (
                <div key={x.k} className="rounded-lg border border-border px-3 py-2.5">
                  <div className="text-lg font-bold tabular-nums tracking-tight">{fmtN(x.v)}</div>
                  <div className="text-[11px] text-muted-foreground">{x.k}</div>
                  <div className="text-[11px] text-muted-foreground">{x.s}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border px-3 py-2.5 flex items-start gap-2 text-[12px]">
              <Database className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="truncate"><b className="font-semibold">File:</b> <code className="font-mono">{db.file}</code></div>
                <div className="text-muted-foreground mt-0.5">WAL journal · everything (stored results, token, budget, run history) lives inside this one SQLite file. Delete or back up this file to reset the app.</div>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
