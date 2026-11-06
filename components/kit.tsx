'use client';
// kit — the shared building blocks of the data pages (Feed, Winners &
// patterns, Recommendations), so they read the same way:
//   Toolbar   one card holding every filter, in one or more labelled rows
//   Segmented a single-choice pill group (platforms, tabs)
//   Stats     a strip of labelled numbers
//   PlatTag   the platform as a compact monogram + name
//   Tabs      underline tabs with counts
//   Empty     a calm empty state with one next step
import type { ReactNode } from 'react';

export const SNAME: Record<string, string> = {
  x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube',
};
export const PLAT_ORDER = ['x', 'linkedin', 'instagram', 'threads', 'tiktok', 'youtube'];
const MONO: Record<string, string> = { x: 'X', linkedin: 'in', instagram: 'IG', threads: '@', tiktok: 'TT', youtube: 'YT' };

/** 1234 → 1.2k, 2357500 → 2.4M */
export function num(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card divide-y divide-border ${className}`}>{children}</div>;
}
/** One row of a Toolbar. `label` sits on the left on wide screens. */
export function ToolRow({ label, children, className = '' }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${className}`}>
      {label && <span className="w-full sm:w-auto sm:min-w-16 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>}
      {children}
    </div>
  );
}

export type SegOpt = { key: string; label: ReactNode; count?: number | null; title?: string };
export function Segmented({ options, value, onChange, ariaLabel, size = 'md' }: {
  options: SegOpt[]; value: string; onChange: (k: string) => void; ariaLabel: string; size?: 'sm' | 'md';
}) {
  const h = size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]';
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map(o => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} title={o.title} onClick={() => onChange(o.key)}
            className={`${h} inline-flex items-center gap-1.5 rounded-md font-medium transition-colors ${on ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`}>
            {o.label}
            {o.count != null && <span className={`tabular-nums text-[11px] ${on ? 'text-muted-foreground' : 'opacity-60'}`}>{o.count.toLocaleString('en-US')}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A pressable filter chip (topics, toggles). */
export function FilterChip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors ${on ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'}`}>
      {children}
    </button>
  );
}

export type StatItem = { label: string; value: ReactNode; hint?: string; title?: string };
export function Stats({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
      {items.map(s => (
        <div key={s.label} className="bg-card px-4 py-3" title={s.title}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{s.value}</div>
          {s.hint && <div className="mt-0.5 text-[11px] text-muted-foreground truncate">{s.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function PlatTag({ source, onClick }: { source: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="grid size-4 place-items-center rounded-[4px] bg-foreground text-[8.5px] font-bold leading-none text-background">{MONO[source] || source.slice(0, 2).toUpperCase()}</span>
      <span>{SNAME[source] || source}</span>
    </>
  );
  const cls = 'inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground';
  return onClick
    ? <button type="button" onClick={onClick} title={`Show only ${SNAME[source] || source}`} className={`${cls} hover:underline`}>{body}</button>
    : <span className={cls}>{body}</span>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number | null }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-border">
      {tabs.map(t => {
        const on = t.key === value;
        return (
          <button key={t.key} role="tab" type="button" aria-selected={on} onClick={() => onChange(t.key)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors ${on ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t.label}
            {t.count != null && <span className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${on ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">{children}</div>}
    </div>
  );
}

/** "how many times this creator's normal" badge. */
export function OutlierBadge({ value, size = 'md' }: { value: number | null | undefined; size?: 'md' | 'lg' }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const win = value >= 2;
  const cls = size === 'lg' ? 'text-lg px-2 py-0.5' : 'text-[12px] px-1.5 py-px';
  return (
    <span title={`${value.toFixed(2)}× this creator's normal engagement${win ? ' — a winner (2× or more)' : ''}`}
      className={`inline-flex items-baseline rounded-md font-semibold tabular-nums ${cls} ${win ? 'bg-foreground text-background' : value >= 1 ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
      {value >= 10 ? value.toFixed(0) : value.toFixed(1)}×
    </span>
  );
}
