'use client';
// X topic scan: search all of X for posts that already won on a theme
// (min likes), across many creators — the fastest way to learn a niche's
// winning formats. One run per scan; keep the page open until it finishes.
import { useState } from 'react';
import { btnPrimary, inputCls, labelCls } from '@/components/panel';
import { TOPIC_PRESETS } from '@/lib/scans';
import { Spinner } from '@/components/panelui/spinner';

const USD_PER_ITEM = 0.00025;

export function TopicScanX({ connected, onDone }: { connected: boolean; onDone: () => void }) {
  const [preset, setPreset] = useState(TOPIC_PRESETS[0].key);
  const p0 = TOPIC_PRESETS[0];
  const [query, setQuery] = useState(p0.query);
  const [minFaves, setMinFaves] = useState(p0.minFaves);
  const [maxItems, setMaxItems] = useState(150);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const pick = (k: string) => {
    setPreset(k);
    const p = TOPIC_PRESETS.find(x => x.key === k);
    if (p) { setQuery(p.query); setMinFaves(p.minFaves); }
  };
  const run = async () => {
    setBusy(true); setMsg('starting…');
    const label = TOPIC_PRESETS.find(x => x.key === preset)?.label || 'custom';
    try {
      const r = await fetch('/api/apify/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'x', topicLabel: label, topicQuery: query, minFaves, maxItems, days }) }).then(x => x.json());
      if (r.error) { setMsg('✗ ' + r.error); setBusy(false); return; }
      setMsg('running on Apify…');
      for (let t = 0; t < 120; t++) {
        await new Promise(res => setTimeout(res, 3000));
        const p = await fetch('/api/apify/run?id=' + encodeURIComponent(r.run.id)).then(x => x.json()).catch(() => ({}));
        if (p.status && !['RUNNING', 'READY', 'QUEUED'].includes(p.status)) {
          const imp = p.rec?.imported;
          setMsg(imp ? `✓ ${label}: ${imp.added} new · ${imp.updated} refreshed · ${imp.skipped} skipped${p.rec?.note && !/^topic scan/.test(p.rec.note) ? ' — ' + p.rec.note : ''}` : '✗ ' + (p.rec?.error || p.status));
          break;
        }
      }
    } catch (e: any) { setMsg('✗ ' + e.message); }
    setBusy(false); onDone();
  };

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-muted-foreground">Searches every account for posts that already passed a like threshold on a theme. Posts are scored per follower, so small accounts that broke out rank high. Then filter Winners & patterns by category.</p>
      <div className="flex flex-wrap gap-1">
        {TOPIC_PRESETS.map(p => (
          <button key={p.key} type="button" onClick={() => pick(p.key)} disabled={busy}
            className={`h-7 rounded-md px-2.5 text-[12px] font-medium border ${preset === p.key ? 'bg-primary text-primary-foreground border-transparent' : 'border-border text-muted-foreground hover:text-foreground'}`}>{p.label}</button>
        ))}
        <button type="button" onClick={() => setPreset('custom')} disabled={busy}
          className={`h-7 rounded-md px-2.5 text-[12px] font-medium border ${preset === 'custom' ? 'bg-primary text-primary-foreground border-transparent' : 'border-border text-muted-foreground hover:text-foreground'}`}>Custom</button>
      </div>
      <textarea className={`${inputCls} min-h-[52px] font-mono text-[12px]`} value={query} onChange={e => { setQuery(e.target.value); setPreset('custom'); }} disabled={busy} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-24"><label className={labelCls}>min likes</label><input className={inputCls} type="number" min={0} value={minFaves} onChange={e => setMinFaves(Number(e.target.value) || 0)} disabled={busy} /></div>
        <div className="w-24"><label className={labelCls}>max posts</label><input className={inputCls} type="number" min={20} max={400} value={maxItems} onChange={e => setMaxItems(Math.max(20, Math.min(400, Number(e.target.value) || 150)))} disabled={busy} /></div>
        <div className="w-20"><label className={labelCls}>days</label><input className={inputCls} type="number" min={3} max={60} value={days} onChange={e => setDays(Math.max(3, Math.min(60, Number(e.target.value) || 30)))} disabled={busy} /></div>
        <button onClick={run} disabled={!connected || busy || query.trim().length < 3} className={btnPrimary + ' flex-1 justify-center'}>
          {busy ? <><Spinner className="size-4" /> scanning…</> : `Scan · up to $${(maxItems * USD_PER_ITEM).toFixed(2)}`}
        </button>
      </div>
      {msg && <p className="text-[11px] text-muted-foreground">{msg}</p>}
    </div>
  );
}
