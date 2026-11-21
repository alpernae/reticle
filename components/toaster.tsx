'use client';
// App-wide toasts (PanelUI Toast). `toast()` works from any client code;
// <RunToasts/> announces AI runs that finish while you're on another page.
//
// The updates arrive over the live event stream (components/live.tsx) — one
// SSE connection per tab — with a slow poll as the safety net.
import { useEffect } from 'react';
import { createToaster } from '@/components/panelui/toast';
import { subscribeActivity, type LiveSummary } from '@/components/live';

export const toaster = createToaster();

type Kind = 'default' | 'success' | 'info' | 'warning' | 'destructive' | 'loading';
export function toast(title: string, opts: { description?: string; type?: Kind; timeout?: number; action?: { label: string; onClick: () => void } } = {}) {
  return toaster.add({
    title, description: opts.description, type: opts.type ?? 'default', timeout: opts.timeout,
    actionProps: opts.action ? { children: opts.action.label, onClick: opts.action.onClick } : undefined,
  });
}

const KIND: Record<string, string> = {
  generate: 'Generate', tool: 'Toolkit', 'format-quick': 'Quick posts', 'format-polish': 'Series polish',
  brief: 'AI brief', categorize: 'Categorize', refine: 'Polish',
};
const secs = (ms?: number | null) => (ms ? (ms >= 60000 ? `${Math.round(ms / 6000) / 10} min` : `${Math.round(ms / 1000)}s`) : '');

/** Toasts each AI run this tab saw working once it finishes, fails or is cancelled (finished runs only when you are on another page). */
export function RunToasts() {
  useEffect(() => {
    const seen = new Set<string>();      // runs observed while running
    const told = new Set<string>();      // already toasted
    return subscribeActivity((s: LiveSummary) => {
      for (const id of s.active ?? []) seen.add(id);
      for (const r of s.recent ?? []) {
        if (!seen.has(r.id) || told.has(r.id)) continue;
        told.add(r.id);
        // the page that started it already shows the result — only toast elsewhere (or failures)
        if (r.page && r.page === window.location.pathname && r.status === 'done') continue;
        const what = KIND[r.kind] || r.kind;
        const open = { label: 'Open', onClick: () => { window.location.href = `/activity?id=${encodeURIComponent(r.id)}`; } };
        if (r.status === 'done') toast(`${what} finished`, { type: 'success', description: [r.title, secs(r.ms)].filter(Boolean).join(' · '), action: open });
        else if (r.status === 'cancelled') toast(`${what} cancelled`, { description: r.title });
        else toast(`${what} failed`, { type: 'destructive', description: (r.error || r.title || '').slice(0, 140), action: open, timeout: 9000 });
      }
    });
  }, []);
  return null;
}
