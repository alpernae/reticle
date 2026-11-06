'use client';
// Sidebar "AI usage" — PanelUI Usage. The ring is today's AI runs (by provider)
// against a soft daily budget; the popover adds 7-day success rate and speed,
// OpenCode quota and Apify collector spend. All numbers are what Reticle
// records itself — nothing here stops a run.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Usage } from '@/components/panelui/usage';
import { subscribeActivity } from '@/components/toaster';

type U = {
  today: { total: number; budget: number; segments: { label: string; value: number }[] };
  week: { runs: number; finished: number; done: number; failed: number; medianMs: number | null };
  opencode: { tracked: number; limited: number; soonestReset: number | null };
  apify: { spend: number | null; limit: number; via: string } | null;
};

const dur = (ms: number) => (ms >= 60000 ? `${Math.round(ms / 6000) / 10} min` : `${Math.round(ms / 1000)}s`);
const until = (t: number) => { const h = (t - Date.now()) / 36e5; return h >= 1 ? `~${Math.round(h)}h` : `~${Math.max(1, Math.round(h * 60))}m`; };

export function AIUsage() {
  const [u, setU] = useState<U | null>(null);
  useEffect(() => {
    let last = -1;
    const load = () => fetch('/api/usage').then(r => r.json()).then(j => { if (j?.today) setU(j); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    // refresh when the number of running AI runs changes (a run started or finished)
    const off = subscribeActivity(s => { if (s.running !== last) { last = s.running; load(); } });
    return () => { clearInterval(t); off(); };
  }, []);
  if (!u) return null;

  const { today, week, opencode, apify } = u;
  const okRate = week.finished ? Math.round((week.done / week.finished) * 100) : null;
  return (
    <Usage label="AI runs today" limit={today.budget} segments={today.segments} state={today.total ? 'active' : 'idle'} format={{ maximumFractionDigits: 0 }}>
      <div className="flex items-center justify-between gap-2 px-2">
        <span className="text-[11px] font-medium text-muted-foreground">AI runs today</span>
        <Usage.Trigger variant="pill" />
      </div>
      <Usage.Content side="right" align="end" className="w-80">
        <Usage.Summary label="AI runs today" unit="soft daily budget" />
        {today.segments.length > 0 && <Usage.Breakdown freeLabel="Left today" />}
        <Usage.Section title="Last 7 days" aside={`${week.runs} runs`}>
          {okRate != null && <Usage.Meter label="Succeeded" value={okRate} note={`${week.done} done · ${week.failed} failed${week.medianMs ? ` · typical run ${dur(week.medianMs)}` : ''}`} />}
          {opencode.tracked > 0 && (
            <Usage.Meter label="OpenCode models out of quota" value={opencode.limited} limit={opencode.tracked}
              display={`${opencode.limited} / ${opencode.tracked}`}
              note={opencode.limited ? `First one back in ${until(opencode.soonestReset!)}` : 'All tried models have quota'} />
          )}
        </Usage.Section>
        {apify && (
          <Usage.Section title="Collectors (Apify)" aside={apify.via === 'apify' ? 'from Apify' : 'tracked locally'}>
            {apify.limit > 0
              ? <Usage.Meter label="Spend this cycle" value={apify.spend ?? 0} limit={apify.limit} display={`$${(apify.spend ?? 0).toFixed(2)} / $${apify.limit.toFixed(2)}`} note="New runs are refused at the limit" />
              : <Usage.Meter label="Spend this cycle" value={0} limit={1} display={`$${(apify.spend ?? 0).toFixed(2)}`} note="No spend limit set (Sources)" />}
          </Usage.Section>
        )}
        <Usage.Footer>
          <span>Claude plan limits aren&apos;t readable here</span>
          <Link href="/activity" className="underline hover:text-foreground">Activity</Link>
        </Usage.Footer>
      </Usage.Content>
    </Usage>
  );
}
