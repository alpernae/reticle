'use client';
// Sources — who to learn from, and what it costs.
//  1. status row: Apify connection · account-wide spend vs limit · posts per platform
//  2. platform tabs: the collector (actor, sources, cap, live cost estimate) + that
//     platform's extras (X topic & deep scans, free YouTube API)
//  3. run history, filterable by platform
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardHead, Chip, PageHead, btn, btnPrimary, inputCls, labelCls } from '@/components/panel';
import { Info, RefreshCw, Wallet, PlugZap, Database } from 'lucide-react';
import { DeepScanX } from '@/components/deep-scan-x';
import { TopicScanX } from '@/components/topic-scan-x';
import { Spinner } from '@/components/panelui/spinner';

type PlatCfg = { actor: string; sources: string; maxItems: number };
type Price = { perResult: number | null; model: string; startFee: number | null };
type Run = { id: string; platform: string; actor: string; ts: number; status: string; items: number | null; imported: { added: number; updated: number; skipped: number } | null; error: string | null; note?: string; costUsd?: number | null };
type ApifyStatus = {
  connected: boolean; mask: string | null; config: Record<string, PlatCfg>;
  budget?: { limit: number; spentThisMonth: number | null };
  spend?: { limit: number; spend: number | null; via: 'apify' | 'local' | 'unknown'; left: number | null };
  pricing?: Record<string, Price>; counts?: Record<string, number>;
  runs: Run[];
};

const PLATS: { key: string; label: string; ph: string; hint: string }[] = [
  { key: 'x', label: 'X', ph: '@levelsio, @swiftonsecurity — handles or profile URLs', hint: 'Rotating collector: handles are queried in OR-chunks that rotate each run. On Apify’s free plan apidojo/tweet-scraper is a 10-tweet demo — use the topic scan or deep scan for real volume.' },
  { key: 'linkedin', label: 'LinkedIn', ph: 'one profile URL per line: https://www.linkedin.com/in/…', hint: 'One profile per run (the actor’s limit) — each run moves to the next profile in the list. Most expensive actor per post, so keep maxItems modest.' },
  { key: 'instagram', label: 'Instagram', ph: '@handle or profile URL, one per line', hint: 'maxItems is split across the listed profiles; posts older than 45 days are skipped.' },
  { key: 'threads', label: 'Threads', ph: '@handle or threads.com profile URL, one per line — or #tag / phrase to search', hint: 'Handles collect each account’s own posts (replies and reposts are skipped). A #tag or multi-word phrase is a search instead: with no handles listed, it collects Threads’ top posts for those from the last 45 days. The actor takes at least 10 posts per account, so each run collects Max results ÷ 10 accounts and the next run moves on to the next ones. About $2.50 per 1,000 posts.' },
  { key: 'tiktok', label: 'TikTok', ph: '@handle, one per line', hint: 'maxItems is split across the listed profiles; no video downloads (cost guard).' },
  { key: 'youtube', label: 'YouTube', ph: '@channel or channel URL, one per line', hint: 'Prefer the free YouTube Data API run (right). The Apify actor is the paid fallback.' },
];

const usd = (n: number | null | undefined, d = 2) => (n == null ? '—' : `$${n.toFixed(d)}`);

export default function Sources() {
  const [ap, setAp] = useState<ApifyStatus | null>(null);
  const [cfg, setCfg] = useState<Record<string, PlatCfg> | null>(null);
  const [tab, setTab] = useState('x');
  const [running, setRunning] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [budgetEdit, setBudgetEdit] = useState<string | null>(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [histAll, setHistAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const j: ApifyStatus = await fetch('/api/apify').then(r => r.json());
      setAp(j);
      setCfg(prev => prev || j.config);
      setBudgetEdit(prev => prev ?? (j.budget?.limit ? String(j.budget.limit) : ''));
    } catch { setAp(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveCfg = async () => { if (cfg) await fetch('/api/apify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'config', config: cfg }) }); };
  const saveBudget = async () => {
    if (budgetEdit == null) return;
    setBudgetSaving(true);
    try { await fetch('/api/apify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'budget', budgetUsd: Number(budgetEdit) }) }); await load(); } catch {}
    setBudgetSaving(false);
  };

  // poll active runs until terminal, then refresh
  useEffect(() => {
    const ids = Object.values(running).filter(id => id && id !== 'starting');
    if (!ids.length) return;
    const t = setInterval(async () => {
      let done = false;
      for (const id of ids) {
        try {
          const r = await fetch('/api/apify/run?id=' + encodeURIComponent(id)).then(x => x.json());
          if (r.status && !['RUNNING', 'READY', 'QUEUED'].includes(r.status)) done = true;
          if (r.error) setErr(String(r.error).slice(0, 200));
        } catch {}
      }
      if (done) { setRunning({}); load(); }
    }, 3500);
    return () => clearInterval(t);
  }, [running, load]);

  const start = async (p: string) => {
    setErr(null);
    try {
      await saveCfg();
      setRunning(x => ({ ...x, [p]: 'starting' }));
      const j = await fetch('/api/apify/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: p }) }).then(r => r.json());
      if (j.error) { setRunning(x => { const n = { ...x }; delete n[p]; return n; }); setErr(`${p}: ${j.error}`); return; }
      setRunning(x => ({ ...x, [p]: j.run?.id || 'started' }));
    } catch (e: any) { setRunning(x => { const n = { ...x }; delete n[p]; return n; }); setErr(p + ': ' + e.message); }
  };

  const s = ap?.spend;
  const pct = s?.limit && s.spend != null ? Math.min(100, (s.spend / s.limit) * 100) : 0;
  const pl = PLATS.find(p => p.key === tab)!;
  const c = cfg?.[tab];
  const price = ap?.pricing?.[tab];
  const nSources = (c?.sources || '').split(/[,\n;]+/).map(x => x.trim()).filter(Boolean).length;
  const estItems = tab === 'linkedin' ? (c?.maxItems || 0) : (c?.maxItems || 0);
  const est = price?.perResult != null ? estItems * price.perResult + (price.startFee || 0) : null;
  const runs = (ap?.runs || []).filter(r => histAll || r.platform === tab);
  const lastRun = (k: string) => ap?.runs.find(r => r.platform === k);

  return (
    <div className="space-y-5">
      <PageHead title="Sources" sub="Who to learn from, and what it costs. Add 8–15 creators per platform — mix big names with smaller rising accounts in bug bounty, mobile and SaaS." />

      {/* ---- 1. status row ---- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between"><span className="text-[13px] font-semibold flex items-center gap-2"><PlugZap className="size-4" aria-hidden="true" />Apify</span><Chip tone={ap?.connected ? 'g' : 'r'}>{ap?.connected ? 'connected' : 'not connected'}</Chip></div>
          <p className="text-[12px] text-muted-foreground flex-1">{ap?.connected ? `Token ${ap.mask} — collectors run on your own account.` : 'Add your Apify API token to start collecting.'}</p>
          <Link href="/settings" className={btn + ' h-8 px-3 text-xs self-start'}>{ap?.connected ? 'Manage keys' : 'Connect on Settings'}</Link>
        </Card>

        <Card className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between"><span className="text-[13px] font-semibold flex items-center gap-2"><Wallet className="size-4" aria-hidden="true" />Apify spend · this cycle</span><Chip tone="a" title="one limit for every collector and scan, measured on your whole Apify account">all collectors</Chip></div>
          <div className="flex items-baseline gap-2"><span className="text-2xl font-bold tabular-nums">{usd(s?.spend)}</span><span className="text-[12px] text-muted-foreground">of {s?.limit ? usd(s.limit) : 'no limit'}{s?.via === 'local' ? ' (tracked locally)' : ''}</span></div>
          <div className="h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${pct >= 90 ? 'bg-foreground' : 'bg-foreground/60'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-end gap-2 pt-1">
            <div className="w-28"><label className={labelCls}>Limit ($)</label><input className={inputCls + ' h-8'} type="number" min={0} max={50} step={0.05} placeholder="0 = none" value={budgetEdit ?? ''} onChange={e => setBudgetEdit(e.target.value)} /></div>
            <button onClick={saveBudget} disabled={budgetSaving || budgetEdit == null} className={btn + ' h-8 px-3 text-xs'}>{budgetSaving ? <Spinner className="size-3.5" /> : 'Save'}</button>
          </div>
        </Card>

        <Card className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between"><span className="text-[13px] font-semibold flex items-center gap-2"><Database className="size-4" aria-hidden="true" />Collected posts</span><Chip tone="a">{Object.values(ap?.counts || {}).reduce((a, b) => a + b, 0)} total</Chip></div>
          <div className="grid grid-cols-1 gap-1">
            {PLATS.map(p => (
              <button key={p.key} onClick={() => setTab(p.key)} className={`flex items-center justify-between rounded-md px-2.5 py-1 text-[12px] ${tab === p.key ? 'bg-muted font-semibold' : 'hover:bg-muted'}`}>
                <span>{p.label}</span>
                <span className="tabular-nums font-semibold">{(ap?.counts?.[p.key] ?? 0).toLocaleString()}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Windows: X 60d · LinkedIn / IG / Threads 45d · TikTok 60d · YouTube 120d.</p>
        </Card>
      </div>

      {/* ---- 2. platform tabs ---- */}
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        {PLATS.map(p => {
          const lr = lastRun(p.key);
          return (
            <button key={p.key} onClick={() => setTab(p.key)} className={`h-8 rounded-md px-3 text-[13px] font-medium inline-flex items-center gap-1.5 ${tab === p.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              {p.label}{running[p.key] ? <Spinner className="size-3" /> : lr?.error ? <span aria-label="last run failed">·!</span> : null}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Card>
          <CardHead title={`${pl.label} collector`} sub="follows the accounts you list — author, followers, every public metric, format and full text" right={running[tab] ? <Chip tone="a">running…</Chip> : null} />
          <div className="p-5 space-y-4">
            <div>
              <label className={labelCls}>Accounts <span className="font-normal normal-case">· {nSources} listed</span></label>
              <textarea className={`${inputCls} min-h-[120px] font-mono text-[12px]`} placeholder={pl.ph} value={c?.sources ?? ''} onChange={e => setCfg(x => x ? { ...x, [tab]: { ...x[tab], sources: e.target.value } } : x)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
              <div><label className={labelCls}>Apify actor</label><input className={inputCls} value={c?.actor ?? ''} onChange={e => setCfg(x => x ? { ...x, [tab]: { ...x[tab], actor: e.target.value } } : x)} /></div>
              <div><label className={labelCls}>Max results</label><input className={inputCls} type="number" min={1} max={400} value={c?.maxItems ?? ''} onChange={e => setCfg(x => x ? { ...x, [tab]: { ...x[tab], maxItems: Number(e.target.value) || 1 } } : x)} /></div>
            </div>
            <div className="rounded-lg border border-border px-3 py-2.5 text-[12px] flex flex-wrap items-center gap-x-4 gap-y-1">
              <span><span className="text-muted-foreground">Price </span><b className="tabular-nums">{price?.perResult != null ? `$${(price.perResult * 1000).toFixed(2)} / 1k results` : 'unknown'}</b></span>
              <span><span className="text-muted-foreground">This run, at most </span><b className="tabular-nums">{est != null ? usd(est, 3) : '—'}</b></span>
              {s?.left != null && <span><span className="text-muted-foreground">Left under limit </span><b className="tabular-nums">{usd(s.left)}</b></span>}
            </div>
            <p className="text-[11px] text-muted-foreground flex gap-1.5"><Info className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />{pl.hint}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => start(tab)} disabled={!!running[tab] || !ap?.connected} className={btnPrimary}>
                {running[tab] ? <><Spinner className="size-4" /> running…</> : <><RefreshCw className="size-4" aria-hidden="true" /> Run collector</>}
              </button>
              <button onClick={async () => { await saveCfg(); load(); }} className={btn}>Save list</button>
              {err && <span className="text-[11px] text-muted-foreground">{err}</span>}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {tab === 'x' && (
            <>
              <Card><CardHead title="Topic scan" sub={`search all of X for posts that already won · ${ap?.pricing?.['x-scan']?.perResult != null ? `$${(ap.pricing['x-scan'].perResult! * 1000).toFixed(2)} / 1k` : ''}`} /><div className="p-5 pt-3"><TopicScanX connected={!!ap?.connected} onDone={load} /></div></Card>
              <Card><CardHead title="Deep scan" sub="one account per run — enough history for outliers and repost detection" /><div className="p-5 pt-3"><DeepScanX sources={c?.sources || ''} connected={!!ap?.connected} onDone={load} /></div></Card>
            </>
          )}
          {tab === 'youtube' && <Card><CardHead title="Free YouTube Data API" sub="exact views, likes, comments and subscriber counts — no Apify credit" /><div className="p-5 pt-3"><YouTubeFree save={saveCfg} /></div></Card>}
          {tab !== 'x' && tab !== 'youtube' && (
            <Card className="p-5 text-[13px] text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground">Tips for {pl.label}</div>
              <p>Pick creators your audience already follows, plus 3–5 smaller accounts (1k–20k followers) — their breakouts are the easiest formats to copy.</p>
              <p>Run once a week; each run refreshes metrics of posts already in the database instead of duplicating them.</p>
              <p>No Apify budget? Export your <b className="text-foreground">own</b> analytics and log results on Winners — your numbers beat anyone else’s.</p>
            </Card>
          )}
        </div>
      </div>

      {/* ---- 3. run history ---- */}
      <Card>
        <CardHead title="Run history" sub="the $ column is Apify’s reported cost for that run (may show — until Apify settles pay-per-event charges)"
          right={<div className="flex items-center gap-2">
            <button onClick={() => setHistAll(v => !v)} className={btn + ' h-8 px-3 text-xs'}>{histAll ? 'All platforms' : `${pl.label} only`}</button>
            <ReimportButton onDone={load} />
          </div>} />
        {runs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-5 py-2 font-semibold">When</th><th className="px-3 py-2 font-semibold">Platform</th><th className="px-3 py-2 font-semibold">Run</th>
                <th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold text-right">Cost</th><th className="px-5 py-2 font-semibold">Result</th>
              </tr></thead>
              <tbody>
                {runs.slice(0, 15).map(r => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-5 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{PLATS.find(p => p.key === r.platform)?.label || r.platform}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[260px]"><div className="truncate" title={r.actor}>{r.note && /^(deep|topic) scan/.test(r.note) ? r.note.split(':').slice(0, 2).join(':') : r.actor.split('/')[0]}</div></td>
                    <td className="px-3 py-2.5"><Chip tone={r.status === 'SUCCEEDED' ? 'g' : r.error ? 'r' : 'a'}>{r.status.toLowerCase()}</Chip></td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground text-right whitespace-nowrap">{r.costUsd != null ? usd(r.costUsd, 3) : '—'}</td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground tabular-nums">
                      {r.imported ? `${r.imported.added} new · ${r.imported.updated} refreshed · ${r.imported.skipped} skipped` : r.items != null ? `${r.items} items` : ''}
                      {r.note && !/^(deep|topic) scan[^:]*$/.test(r.note) && /no posts|dropped|0 items|limit/.test(r.note) && <div className="text-[11px] text-foreground/80 max-w-[420px] whitespace-normal">{r.note.replace(/^(deep|topic) scan[^:]*:\s*/, '')}</div>}
                      {r.error && <div className="text-[11px] text-foreground/80">{r.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 py-6 text-[13px] text-muted-foreground">No runs {histAll ? '' : `for ${pl.label} `}yet.</p>}
      </Card>
    </div>
  );
}

function YouTubeFree({ save }: { save: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true); setMsg('');
    try {
      await save();
      const r = await fetch('/api/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run', perChannel: 12 }) }).then(x => x.json());
      setMsg(r.error ? r.error : `${r.result.added} new · ${r.result.updated} refreshed · ${r.result.skipped} skipped${r.result.errors?.length ? ' · ' + r.result.errors[0] : ''}`);
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      <button onClick={run} disabled={busy} className={btnPrimary}>
        {busy ? <><Spinner className="size-4" /> collecting…</> : 'Run free (YouTube Data API)'}
      </button>
      <p className="text-[11px] text-muted-foreground">{msg || 'Uses the channel list on the left · 12 newest uploads per channel · needs a free Google API key on Settings.'}</p>
    </div>
  );
}

function ReimportButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true); setMsg('');
    try {
      const j = await fetch('/api/apify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reimport' }) }).then(r => r.json());
      setMsg(j.error ? j.error : `${j.reimport.runs} runs re-read · ${j.reimport.updated} enriched · ${j.reimport.added} new${j.reimport.expired ? ` · ${j.reimport.expired} expired` : ''}`);
      onDone();
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-[11px] text-muted-foreground">{msg}</span>}
      <button onClick={run} disabled={busy} title="Re-read past run datasets with the current normalizer (free — no actor runs)" className={btn + ' h-8 px-3 text-xs'}>
        {busy ? <Spinner className="size-3.5" /> : null} Re-process past runs
      </button>
    </div>
  );
}
