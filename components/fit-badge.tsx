'use client';
// Pattern-fit badge: "fit 1.18×" + the evidence behind it (lib/score.ts).
import { useState } from 'react';

export type Fit = { score: number; basis: string; factors: { trait: string; value: string; lift: number; n: number; weight: number }[]; evidence: number };

export function FitBadge({ fit }: { fit?: Fit | null }) {
  const [open, setOpen] = useState(false);
  if (!fit) return null;
  const tone = fit.score >= 1.1 ? 'bg-primary text-primary-foreground' : fit.score <= 0.92 ? 'border-2 border-foreground' : 'border border-border text-muted-foreground';
  const label = fit.score >= 1.1 ? 'strong fit' : fit.score <= 0.92 ? 'weak fit' : 'neutral';
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen(v => !v)} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${tone}`}
        title="Pattern fit: how the traits of this draft performed in your collected data (click for evidence)">
        fit {fit.score.toFixed(2)}× · {label}
      </button>
      {open && (
        <span className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-border bg-card p-3 text-[11px] shadow-lg text-left block">
          <span className="block font-semibold text-foreground mb-1">Why {fit.score.toFixed(2)}×</span>
          <span className="block text-muted-foreground mb-2">Each trait’s lift = how posts with it did vs the median, in {fit.basis}. Small samples count less (n ≥ 30 = full weight).</span>
          {fit.factors.length ? fit.factors.map(f => (
            <span key={f.trait} className="flex justify-between gap-2 py-0.5">
              <span><span className="text-muted-foreground">{f.trait}:</span> {f.value}</span>
              <span className="tabular-nums">{f.lift.toFixed(2)}× <span className="text-muted-foreground">n{f.n}{f.weight < 1 ? ` · w${f.weight}` : ''}</span></span>
            </span>
          )) : <span className="block text-muted-foreground">No matching patterns yet — collect more posts on this platform.</span>}
          <span className="block text-muted-foreground mt-2">Structure only — not topic quality. Log real results on Winners to check it.</span>
        </span>
      )}
    </span>
  );
}
