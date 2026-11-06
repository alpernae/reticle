'use client';
// X deep scan: one account per run through a pay-per-result actor with no
// free-plan demo cap, so each creator gets enough history for outlier
// baselines and repost detection. Runs one after another; keep the page open.
import { useEffect, useRef, useState } from 'react';
import { btnPrimary, inputCls, labelCls } from '@/components/panel';
import { Spinner } from '@/components/panelui/spinner';

const X_USD_PER_ITEM = 0.00025;
type ScanRow = { h: string; state: 'queued' | 'running' | 'done' | 'failed' | 'skipped'; msg?: string };

export function DeepScanX({ sources, connected, onDone }: { sources: string; connected: boolean; onDone: () => void }) {
  const [list, setList] = useState('');
  const [per, setPer] = useState(50);
  const [days, setDays] = useState(60);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  useEffect(() => { if (!list && sources) setList(sources); }, [sources]); // eslint-disable-line react-hooks/exhaustive-deps

  const handles = [...new Set(list.split(/[,\n;\s]+/).map(x => x.trim().replace(/^@/, '')).filter(x => /^[A-Za-z0-9_]{1,15}$/.test(x)))];
  const est = handles.length * per * X_USD_PER_ITEM;
  const set = (i: number, p: Partial<ScanRow>) => setRows(r => r.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const run = async () => {
    setBusy(true); setStopping(false); stopRef.current = false;
    setRows(handles.map(h => ({ h, state: 'queued' })));
    for (let i = 0; i < handles.length; i++) {
      if (stopRef.current) { for (let k = i; k < handles.length; k++) set(k, { state: 'skipped', msg: 'stopped' }); break; }
      set(i, { state: 'running' });
      try {
        const r = await fetch('/api/apify/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'x', deep: handles[i], perAccount: per, days }) }).then(x => x.json());
        if (r.error) {
          set(i, { state: 'failed', msg: r.error });
          if (/spend limit/i.test(r.error)) { for (let k = i + 1; k < handles.length; k++) set(k, { state: 'skipped', msg: 'spend limit' }); break; }
          continue;
        }
        let rec: any = null;
        for (let t = 0; t < 120; t++) { // ≤ 6 min per account
          await new Promise(res => setTimeout(res, 3000));
          const p = await fetch('/api/apify/run?id=' + encodeURIComponent(r.run.id)).then(x => x.json()).catch(() => ({}));
          if (p.status && !['RUNNING', 'READY', 'QUEUED'].includes(p.status)) { rec = p.rec; break; }
        }
        const imp = rec?.imported;
        set(i, imp
          ? { state: 'done', msg: `${imp.added} new · ${imp.updated} refreshed · ${imp.skipped} skipped${rec?.costUsd ? ` · $${rec.costUsd.toFixed(3)}` : ''}` }
          : { state: 'failed', msg: rec?.error || 'no result (timed out?)' });
      } catch (e: any) { set(i, { state: 'failed', msg: e.message }); }
    }
    setBusy(false);
    onDone();
  };

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-muted-foreground">One account per run, original posts only, via <code className="font-mono">kaitoeasyapi</code> (no free-plan 10-tweet cap, ~$0.25 per 1k tweets). Gives each creator enough history to spot repeats.</p>
      <textarea className={`${inputCls} min-h-[52px]`} value={list} onChange={e => setList(e.target.value)} placeholder="@handle, @handle2 — the accounts you saw re-posting" disabled={busy} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-24"><label className={labelCls}>posts / acct</label><input className={inputCls} type="number" min={5} max={200} value={per} onChange={e => setPer(Math.max(5, Math.min(200, Number(e.target.value) || 50)))} disabled={busy} /></div>
        <div className="w-20"><label className={labelCls}>days</label><input className={inputCls} type="number" min={7} max={60} value={days} onChange={e => setDays(Math.max(7, Math.min(60, Number(e.target.value) || 60)))} disabled={busy} /></div>
        {!busy
          ? <button onClick={run} disabled={!connected || !handles.length} className={btnPrimary + ' flex-1 justify-center'}>Deep scan {handles.length} · up to ${est.toFixed(2)}</button>
          : <button onClick={() => { stopRef.current = true; setStopping(true); }} className={btnPrimary + ' flex-1 justify-center'}><Spinner className="size-4" />{stopping ? 'stopping after this one…' : 'Stop after current'}</button>}
      </div>
      {rows.length > 0 && (
        <ul className="text-[11px] space-y-0.5 max-h-48 overflow-y-auto">
          {rows.map(r => (
            <li key={r.h} className="flex gap-2">
              <span className={`w-16 shrink-0 ${r.state === 'done' ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{r.state === 'running' ? 'running…' : r.state}</span>
              <span className="font-medium">@{r.h}</span>
              <span className="text-muted-foreground truncate" title={r.msg}>{r.msg}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
