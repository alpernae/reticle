'use client';
// "Sort N uncategorized with Claude" — loops /api/categorize one batch at a time.
import { useEffect, useRef, useState } from 'react';
import { btn, notifyActivity } from '@/components/panel';
import { Wand2 } from 'lucide-react';
import { ModelPicker, pickedModel } from '@/components/model-picker';
import { Spinner } from '@/components/panelui/spinner';

export function CategorizeButton({ onDone }: { onDone: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [pick, setPick] = useState('');
  const stop = useRef(false);
  useEffect(() => { fetch('/api/categorize').then(r => r.json()).then(j => setRemaining(j.remaining)).catch(() => {}); }, []);

  const run = async () => {
    setBusy(true); setMsg(''); stop.current = false;
    setTimeout(notifyActivity, 300);
    let sorted = 0;
    for (let i = 0; i < 40 && !stop.current; i++) {
      const j = await fetch('/api/categorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: pickedModel(pick) }) }).then(r => r.json()).catch((e: any) => ({ error: e.message }));
      if (j.error) { setMsg('✗ ' + j.error); break; }
      sorted += j.done; setRemaining(j.remaining);
      setMsg(`${sorted} sorted${j.via ? ` via ${j.via.providerID} · ${j.via.id}` : ''}`);
      if (!j.remaining || !j.done) break;
    }
    setBusy(false); onDone();
  };
  if (!remaining && !busy && !msg) return null;
  return (
    <div className="flex items-center gap-2">
      <ModelPicker compact value={pick} onChange={setPick} label="AI for categorizing" disabled={busy} />
      <button className={btn + ' h-10'} onClick={busy ? () => { stop.current = true; } : run} title="Claude reads posts the keyword rules couldn't place and assigns categories">
        {busy ? <Spinner className="size-4" /> : <Wand2 className="size-4" aria-hidden="true" />}
        {busy ? `Sorting… ${remaining ?? ''} left (click to stop)` : `Sort ${remaining} uncategorized with AI`}
      </button>
      {msg && <span className="text-[11px] text-muted-foreground">{msg}</span>}
    </div>
  );
}
