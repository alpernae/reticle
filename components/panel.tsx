'use client';
// Shared panel components & helpers (client-side) — monochrome edition.
// All colour comes from theme tokens (app/globals.css); hierarchy is carried by
// inversion (solid primary), outlines and weight — never by hue.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Radar as RadarIcon, MessagesSquare, Sparkles, Trophy, Bookmark, Bot, Lightbulb, Settings as SettingsIcon,
  Sun, Moon, LogOut, FileText, Flame, CalendarCheck, Wrench, Activity as ActivityIcon, Workflow, Network, CalendarClock,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { CommandMenu } from '@/components/command-menu';
import { AskDock } from '@/components/ask-dock';
import { BRAND } from '@/lib/brand';
import { Toast } from '@/components/panelui/toast';
import { RunToasts, pokeActivity, subscribeActivity, toaster } from '@/components/toaster';
import { AIUsage } from '@/components/ai-usage';

// ---------- formatting ----------
export const kfmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n ?? 0));
export const AGO = (ms: number) => {
  const m = (Date.now() - ms) / 60000;
  if (m < 60) return Math.max(1, Math.round(m)) + 'm';
  const h = m / 60;
  if (h < 48) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
};

// ---------- theme ----------
export const THEME_SCRIPT = `try{var t=localStorage.getItem('sc-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', !!next);
    try { localStorage.setItem('sc-theme', next ? 'dark' : 'light'); } catch {}
  };
  return (
    <button onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="h-9 w-9 grid place-items-center rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors">
      {dark == null ? <span className="size-4 rounded-full border border-border" aria-hidden="true" /> : dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

// ---------- api state hook with cross-page refresh ----------
const REFRESH_EVT = 'sc-refresh';
export function useApiState<T = any>(): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const reload = useCallback(() => { fetch('/api/state').then(r => r.json()).then(setData).catch(() => {}); }, []);
  useEffect(() => { reload(); const h = () => reload(); window.addEventListener(REFRESH_EVT, h); return () => window.removeEventListener(REFRESH_EVT, h); }, [reload]);
  return { data, reload };
}
export const notifyRefresh = () => window.dispatchEvent(new Event(REFRESH_EVT));

// ---------- surfaces ----------
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card text-card-foreground shadow-none ${className}`}>{children}</div>;
}
export function CardHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border">
    <div>
      <h3 className="text-[13px] font-semibold tracking-wide uppercase text-foreground">{title}</h3>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
    {right}
  </div>;
}

// ---------- chips: monochrome hierarchy ----------
// filled (max emphasis) | heavy outline (alert) | light outline (tag) | quiet muted
export const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium';
export function Chip({ tone = 'z', title, children }: { tone?: 'z' | 'g' | 'r' | 'a' | 'b'; title?: string; children: ReactNode }) {
  const tones: Record<string, string> = {
    z: 'bg-muted text-muted-foreground border border-transparent',
    g: 'bg-primary text-primary-foreground',
    r: 'border-2 border-foreground bg-card text-foreground font-semibold',
    a: 'border border-foreground/25 bg-card text-muted-foreground',
    b: 'bg-primary text-primary-foreground',
  };
  return <span title={title} className={`${pill} ${tones[tone]}`}>{children}</span>;
}

// Signs out: drops the local session row and clears the cookie via the API,
// then hands the proxy a fresh navigation to /login.
export function SignOutButton({ className = '' }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try { await fetch('/api/auth', { method: 'DELETE' }); } catch {}
        router.replace('/login');
        router.refresh();
        setBusy(false);
      }}
      disabled={busy}
      title="Sign out"
      aria-label="Sign out"
      className={`grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 ${className}`}
    >
      <LogOut className="size-3.5" aria-hidden="true" />
    </button>
  );
}

// ---------- shell ----------
export const NAV: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; group: string }[] = [
  { href: '/', label: 'Overview', icon: RadarIcon, group: 'Radar' },
  { href: '/patterns', label: 'Winners & patterns', icon: Flame, group: 'Radar' },
  { href: '/recs', label: 'Recommendations', icon: Lightbulb, group: 'Radar' },
  { href: '/feed', label: 'Feed', icon: MessagesSquare, group: 'Radar' },
  { href: '/activity', label: 'Activity', icon: ActivityIcon, group: 'Studio' },
  { href: '/generate', label: 'Generate', icon: Sparkles, group: 'Studio' },
  { href: '/toolkit', label: 'Toolkit', icon: Wrench, group: 'Studio' },
  { href: '/formats', label: 'Formats', icon: CalendarCheck, group: 'Studio' },
  { href: '/workflows', label: 'Workflows', icon: Workflow, group: 'Studio' },
  { href: '/automations', label: 'Automations', icon: CalendarClock, group: 'Studio' },
  { href: '/mindmaps', label: 'Mind maps', icon: Network, group: 'Studio' },
  { href: '/results', label: 'Results', icon: FileText, group: 'Studio' },
  { href: '/winners', label: 'Winners', icon: Trophy, group: 'Studio' },
  { href: '/sources', label: 'Sources', icon: Bookmark, group: 'Research' },
  { href: '/settings', label: 'Settings', icon: SettingsIcon, group: 'Research' },
];

/** How many AI runs are working right now (Activity). Polls a cheap count endpoint;
 *  pages that start a run call notifyActivity() so the badge reacts instantly. */
const ACTIVITY_EVT = 'payload-activity';
export const notifyActivity = () => { try { window.dispatchEvent(new Event(ACTIVITY_EVT)); pokeActivity(); } catch {} };
export function useRunningCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => subscribeActivity(s => setN(s.running)), []);
  return n;
}

export function Sidebar() {
  const path = usePathname();
  const groups = ['Radar', 'Studio', 'Research'];
  const running = useRunningCount();
  return (
    <aside className="hidden md:flex flex-col w-[232px] shrink-0 border-r border-border bg-card sticky top-0 h-screen">
      <div className="px-5 py-5">
        <Logo />
      </div>
      <nav className="px-3 flex-1 overflow-y-auto">
        {groups.map(g => (
          <div key={g} className="mb-4">
            <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">{g}</div>
            {NAV.filter(n => n.group === g).map(n => {
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm mb-0.5 transition-colors ${path === n.href
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                  <Icon className="size-4 shrink-0" aria-hidden="true" />{n.label}
                  {n.href === '/activity' && running > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 text-[10px] font-semibold tabular-nums" title={`${running} AI run${running === 1 ? '' : 's'} working`}>
                      <span className="size-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />{running}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="px-3 pt-3 border-t border-border"><AIUsage /></div>
      <div className="px-5 py-4 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
        <div>Local only · SQLite<br />X · LI · IG · TikTok · YT</div>
        <SignOutButton className="-me-2" />
      </div>
    </aside>
  );
}

function RunningChip() {
  const n = useRunningCount();
  if (!n) return null;
  return (
    <Link href="/activity?filter=active" className={`${pill} bg-primary text-primary-foreground hover:opacity-85`} title="Open Activity">
      <span className="size-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />{n} AI run{n === 1 ? '' : 's'} working
    </Link>
  );
}

type AIHealth = { ok: boolean; summary: string; providers: { id: string; label: string; state: string; detail: string }[] };

/** "AI ready" when ANY enabled provider works; hover lists each provider; click → Settings. */
export function AIHealthChip({ health }: { health?: AIHealth }) {
  if (!health) return null;
  const active = health.providers.filter(p => p.state !== 'off');
  const working = active.filter(p => p.state === 'ok' || p.state === 'untested').map(p => p.label);
  const degraded = active.filter(p => p.state === 'quota' || p.state === 'failing');
  const title = active.map(p => `${p.label}: ${p.state}${p.detail ? ' — ' + p.detail : ''}`).join('\n');
  const label = health.ok
    ? `AI ready · ${working.join(', ')}${degraded.length ? ` (${degraded.map(p => `${p.label} ${p.state === 'quota' ? 'out of quota' : 'failing'}`).join(', ')})` : ''}`
    : 'AI off — check Settings';
  return (
    <Link href="/settings" title={title} className={`${pill} ${health.ok ? 'bg-primary text-primary-foreground' : 'border-2 border-foreground bg-card text-foreground font-semibold'} hover:opacity-85`}>
      {label}
    </Link>
  );
}

export function Topbar() {
  const { data } = useApiState();
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 px-4 md:px-6 h-14 border-b border-border bg-background/85 backdrop-blur">
      <span className="font-semibold text-sm">{BRAND.name}</span>
      <div className="hidden sm:flex items-center gap-2">
        <Chip>{data?.count ?? '…'} posts</Chip>
        <AIHealthChip health={data?.aiHealth} />
        <RunningChip />
      </div>
      <div className="flex-1" />
      <CommandMenu />
      <ThemeToggle />
    </header>
  );
}

// mobile nav (top tabs) since sidebar hides on small screens
export function MobileNav() {
  const path = usePathname();
  return (
    <div className="md:hidden flex gap-1 px-3 py-2 overflow-x-auto border-b border-border bg-background">
      {NAV.map(n => {
        const Icon = n.icon;
        return <Link key={n.href} href={n.href} className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs ${path === n.href ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
          <Icon className="size-3.5" aria-hidden="true" />{n.label}
        </Link>;
      })}
    </div>
  );
}

// ---------- app shell ----------
// Wraps every page in Sidebar + Topbar — except /login, which renders bare so
// the sign-in form owns the whole screen. The footer lives here too so /login
// stays free of app chrome.
/** Every link to another site opens in a new tab — also in embedded browsers
 *  that ignore target="_blank" (they do honour window.open). Internal links and
 *  downloads are left alone. */
function useExternalLinksInNewTab() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (!/^https?:$/.test(url.protocol) || url.origin === window.location.origin) return;
      e.preventDefault();
      window.open(url.href, '_blank', 'noopener,noreferrer');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

export function Shell({ children }: { children: ReactNode }) {
  useExternalLinksInNewTab();
  if (usePathname() === '/login') return <Toast.Provider toastManager={toaster} position="bottom-right">{children}</Toast.Provider>;
  return (
    <Toast.Provider toastManager={toaster} position="bottom-right">
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar />
        <MobileNav />
        <main className="flex-1 px-4 md:px-8 py-6 w-full max-w-[1680px] mx-auto">{children}</main>
        <RunToasts />
        {/* Ask: pinned to the bottom-right corner, grows upwards as the answer arrives */}
        <div className="pointer-events-none fixed bottom-4 right-4 z-40 w-[28rem] max-w-[calc(100vw-2rem)] sm:bottom-6 sm:right-6"><AskDock /></div>
        <footer className="px-4 md:px-8 py-4 border-t border-border text-[11px] text-muted-foreground">
          <div className="max-w-[1680px] mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <span>© {BRAND.copyrightYear} {BRAND.owner} · {BRAND.name} · Released under the <a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer" className="underline hover:text-foreground">MIT License</a></span>
            <span className="max-w-3xl">Runs locally — data stays in SQLite on this machine; outbound traffic is only your collectors (Apify, YouTube Data API) and the AI provider you pick. Patterns are directional signals, not guarantees. Create, don&apos;t clone.</span>
          </div>
        </footer>
      </div>
    </div>
    </Toast.Provider>
  );
}

// ---------- generic ----------
export const btn = 'inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors';
export const btnPrimary = `inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium transition-opacity bg-primary text-primary-foreground hover:opacity-85 disabled:opacity-50`;
export const inputCls = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10 transition-colors placeholder:text-muted-foreground/60';
export const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1';

// ---------- page header: consistent title row for every page ----------
export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// ---------- chart: monochrome bar chart ----------
// Faint dashed gridlines, solid ink for peak columns, quiet ink otherwise, and
// the value of each peak printed above its column. Pure div/CSS — no chart
// library, no colour, reads correctly to screen readers.
export interface BarsProps {
  /** Values, one per column. */
  data: number[];
  /** Column indexes whose value "wins" the row — drawn solid. Defaults to the labelTop set. */
  highlight?: number[];
  /** Unit appended to hover titles: "top posts". */
  unit?: string;
  /** What the chart shows, for screen readers. */
  ariaLabel: string;
  /** Canvas height in px. */
  height?: number;
  /** Draw an axis label under every Nth column (0 = no axis). */
  tickEvery?: number;
  /** Formats one axis label. */
  tickFormat?: (i: number) => string;
  /** Print the value above the N highest columns; those columns draw solid. */
  labelTop?: number;
  /** One-line takeaway under the chart: "busiest 20:00 · quietest 05:00". */
  summary?: string;
  /** Overrides the default "9:00 — 7" hover title, e.g. to print AM/PM. */
  tooltipFormat?: (i: number) => string;
}
export function Bars({
  data,
  highlight = [],
  unit = '',
  ariaLabel,
  height = 128,
  tickEvery = 0,
  tickFormat = (i: number) => String(i),
  labelTop = 0,
  summary,
  tooltipFormat,
}: BarsProps) {
  const max = Math.max(...data, 1);
  // The columns worth calling out, highest first: they get a printed value
  // and, unless a highlight set was passed, the solid-ink treatment.
  const peakCols: number[] = labelTop > 0
    ? data.map((_, i) => i).filter((i: number) => data[i] > 0).sort((a: number, b: number) => data[b] - data[a]).slice(0, labelTop)
    : [];
  const solid = highlight.length ? highlight : peakCols;
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="px-5">
        {/* headroom so a value printed over a full-height column stays inside the component */}
        <div className="relative pt-[18px]">
          <div className="relative flex items-end gap-[3px]" style={{ height }}>
            {[25, 50, 75].map(p => (
              <div key={p} aria-hidden="true" className="absolute left-0 right-0 border-t border-dashed border-border" style={{ top: `${p}%` }} />
            ))}
            {data.map((n, i) => {
              const h = (n / max) * 100;
              const labeled = peakCols.includes(i) && n > 0;
              return (
                <div key={i} title={tooltipFormat ? tooltipFormat(i) : `${i}:00 — ${n}${unit}`} className="relative flex h-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t-sm transition-colors ${solid.includes(i) && n > 0 ? 'bg-foreground' : 'bg-foreground/15 hover:bg-foreground/45'}`}
                    style={{ height: `${Math.max(1.5, h)}%` }}
                  />
                  {labeled && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold tabular-nums text-foreground"
                      style={{ bottom: `calc(${Math.max(1.5, h)}% + 4px)` }}
                    >
                      {n}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {tickEvery > 0 && (
          <div className="flex gap-[3px] mt-1.5 text-[9px] text-muted-foreground" aria-hidden="true">
            {data.map((_, i) => (
              <span key={i} className="flex-1 text-left">{i % tickEvery === 0 ? tickFormat(i) : '\u00a0'}</span>
            ))}
          </div>
        )}
      </div>
      {summary && <div className="px-5 mt-2 text-[11px] text-muted-foreground">{summary}</div>}
    </div>
  );
}

// ---------- stacked ribbon: shares of a whole, monochrome ----------
// Segments are tiers of ink opacity (100 / 55 / 32 / 16%), so a single-hue bar
// still reads as N distinct parts. Legend carries the counts and percentages.
export interface StackSeg {
  label: string;
  value: number;
}
export function StackBar({ segments, height = 8, className = '' }: { segments: StackSeg[]; height?: number; className?: string }) {
  const total = segments.reduce((s: number, g: StackSeg) => s + Math.max(0, g.value), 0) || 1;
  const opac = [1, 0.55, 0.32, 0.16];
  return (
    <div className={className}>
      {/* role="img" since the bar carries the split; the legend repeats it as text */}
      <div
        role="img"
        aria-label={segments.map((g: StackSeg) => `${g.label} ${g.value}`).join(', ')}
        className="flex gap-px overflow-hidden rounded-full bg-muted"
        style={{ height }}
      >
        {segments.map((g: StackSeg, i: number) => (
          <div
            key={g.label}
            title={`${g.label} — ${g.value} (${Math.round((Math.max(0, g.value) / total) * 100)}%)`}
            className="h-full bg-foreground transition-[width]"
            style={{ width: `${(Math.max(0, g.value) / total) * 100}%`, opacity: opac[i % opac.length] }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
        {segments.map((g: StackSeg, i: number) => (
          <span key={g.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full bg-foreground" style={{ opacity: opac[i % opac.length] }} />
            {g.label}
            <span className="font-medium tabular-nums text-foreground">{g.value}</span>
            <span className="tabular-nums">{Math.round((Math.max(0, g.value) / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- trend chart: monochrome SVG line/area ----------
// A primary series drawn in solid ink with an area wash and a printed peak
// value, an optional secondary series at 35% ink, dashed gridlines, axis,
// hover tooltips over the columns, a legend and a summary line. Faithful in
// light and dark because every colour is a theme token.
export interface TrendChartProps {
  /** The x axis, oldest first; one label per point. */
  labels: string[];
  /** The primary values. */
  values: number[];
  /** An optional comparison series at reduced ink. */
  secondary?: number[];
  /** Text for the legend, `[primary, secondary?]`. */
  legend?: string[];
  /** Unit appended to hover titles. */
  unit?: string;
  /** What the chart shows, for screen readers. */
  ariaLabel: string;
  /** Plot height in px. */
  height?: number;
  /** Show an axis label under every Nth point (0 = no axis). */
  tickEvery?: number;
  /** Formats one axis label. */
  tickFormat?: (i: number) => string;
  /** One-line takeaway under the chart. */
  summary?: string;
  /** Overrides the default hover title, e.g. for full dates: "Sat, Jan 15 — 3.2k eng · 42 posts". */
  hoverFormat?: (i: number) => string;
}
export function TrendChart({
  labels, values, secondary, legend, unit = '', ariaLabel,
  height = 160, tickEvery = 0, tickFormat = (i: number) => String(i), summary, hoverFormat,
}: TrendChartProps) {
  const W = 100, H = 40, PAD = 3;
  const n = labels.length;
  const lo = Math.min(...values, ...(secondary ?? []));
  const hi = Math.max(...values, ...(secondary ?? []), 1);
  const span = hi - lo || 1;
  const pts = (arr: number[]): [number, number][] =>
    arr.map((v: number, i: number): [number, number] => [
      n === 1 ? W / 2 : (i / (n - 1)) * W,
      PAD + (1 - (v - lo) / span) * (H - 2 * PAD),
    ]);
  const path = (arr: number[]) =>
    pts(arr).map((p: [number, number], i: number) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  const area = (arr: number[]) => `${path(arr)} L${W} ${H} L0 ${H} Z`;
  const peak = values.reduce((b: number, v: number, i: number) => (v > values[b] ? i : b), 0);
  const peakPt = n ? pts(values)[peak] : null;
  const pct = (t: [number, number]) => ({ x: `${(t[0] / W) * 100}%`, y: `${(t[1] / H) * 100}%` });
  const labeled = n > 0 && values[peak] > 0;

  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="px-2">
        {/* headroom for the printed peak value */}
        <div className="relative pt-[18px]">
          <div className="relative" style={{ height }}>
            {[25, 50, 75].map(p => (
              <div key={p} aria-hidden="true" className="absolute left-0 right-0 border-t border-dashed border-border" style={{ top: `${p}%` }} />
            ))}
            <svg className="absolute inset-0 block h-full w-full overflow-visible" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              <path d={area(values)} fill="var(--foreground)" opacity="0.07" />
              {secondary ? <path d={path(secondary)} fill="none" stroke="var(--foreground)" opacity="0.35" strokeWidth="1.75" vectorEffect="non-scaling-stroke" /> : null}
              <path d={path(values)} fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {/* hover columns carry per-point tooltips */}
            <div className="absolute inset-0 flex">
              {values.map((v: number, i: number) => (
                <div
                  key={i}
                  className="flex-1"
                  title={hoverFormat
                    ? hoverFormat(i)
                    : `${labels[i]} — ${v}${unit}${secondary ? ` / ${secondary[i]} posts` : ''}`}
                />
              ))}
            </div>
            {labeled && peakPt && (() => {
              const p = pct(peakPt);
              return (
                <>
                  <span aria-hidden="true" className="absolute size-2 rounded-full bg-foreground ring-2 ring-card -translate-x-1/2 -translate-y-1/2" style={{ left: p.x, top: p.y }} />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute whitespace-nowrap text-[10px] font-semibold tabular-nums text-foreground -translate-x-1/2"
                    style={{ left: p.x, top: `calc(${p.y} - 13px)` }}
                  >
                    {values[peak]}
                  </span>
                </>
              );
            })()}
          </div>
        </div>
        {tickEvery > 0 && (
          <div className="flex mt-1.5 text-[9px] text-muted-foreground" aria-hidden="true">
            {labels.map((_, i: number) => (
              <span key={i} className="flex-1 text-left">{i % tickEvery === 0 ? tickFormat(i) : '\u00a0'}</span>
            ))}
          </div>
        )}
      </div>
      {legend && legend.length > 0 && (
        <div className="px-2 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {legend.map((l: string, i: number) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-sm bg-foreground" style={{ opacity: i === 0 ? 1 : 0.35 }} />
              {l}
            </span>
          ))}
        </div>
      )}
      {summary && <div className="px-2 mt-1.5 text-[11px] text-muted-foreground">{summary}</div>}
    </div>
  );
}
