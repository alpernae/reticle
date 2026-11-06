'use client';
// Best time to post — pick where your audience lives; get the windows on THEIR
// clock and on YOURS, from your own winning-post data (outlier lift, not raw
// volume) with the typical platform habits as a fallback.
import { useEffect, useMemo, useState } from 'react';
import { Card, CardHead, Chip } from '@/components/panel';
import { Clock, Globe2 } from 'lucide-react';
import { DAYS, REGIONS, TYPICAL, bestTimes, convertRange, fmtRange, tzCity, userTz, type RegionKey, type TimingPoint } from '@/lib/besttime';

const SNAME: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube' };
const PLATS = ['x', 'linkedin', 'instagram', 'threads', 'tiktok', 'youtube'];
const BLOCK = ['12–3a', '3–6a', '6–9a', '9a–12', '12–3p', '3–6p', '6–9p', '9p–12'];

/** "Tue–Thu" / "Mon–Fri" / "Thu, Sat" */
function dayList(days: number[]): string {
  const s = [...days].sort((a, b) => a - b);
  const run = s.every((d, i) => i === 0 || d === s[i - 1] + 1);
  return run && s.length > 2 ? `${DAYS[s[0]]}–${DAYS[s[s.length - 1]]}` : s.map(d => DAYS[d]).join(', ');
}

export function BestTimeCard({ timing, platform }: { timing: TimingPoint[]; platform: string }) {
  const [region, setRegion] = useState<RegionKey>('us-east');
  const [own, setOwn] = useState('x');
  const [mine, setMine] = useState('UTC');
  useEffect(() => {
    setMine(userTz());
    const saved = localStorage.getItem('payload.bestTimeRegion') as RegionKey | null;
    if (saved && REGIONS.some(r => r.key === saved)) setRegion(saved);
  }, []);
  const pickRegion = (k: RegionKey) => { setRegion(k); localStorage.setItem('payload.bestTimeRegion', k); };

  const plat = platform !== 'all' ? platform : own;
  const R = REGIONS.find(r => r.key === region)!;
  const typ = TYPICAL[plat] ?? TYPICAL.x;
  const data = useMemo(() => bestTimes(timing, R.tz, plat), [timing, R.tz, plat]);
  const sameZone = R.tz === mine;
  const yours = (a: number, b: number) => convertRange(a, b, R.tz, mine);
  const maxLift = Math.max(1.5, ...data.grid.flat().map(c => c.lift));

  // headline: your data when it's strong enough, otherwise the typical window
  const top = data.enough ? data.windows[0] : null;
  const headRange = top ? [top.start, top.end] as const : typ.windows[0];
  const goodDays = data.enough ? data.days.filter(d => d.n >= 5 && d.lift >= 1).sort((a, b) => b.lift - a.lift).slice(0, 3).map(d => d.day) : typ.days;

  return (
    <Card>
      <CardHead
        title="Best time to post"
        sub={`audience in ${R.label} · shown on their clock${sameZone ? '' : ` and yours (${tzCity(mine)})`}`}
        right={<Chip tone={data.enough ? 'g' : 'a'} title={data.enough ? 'ranked by how much posts in each window beat their creator\'s normal' : 'not enough posts on this platform yet: using typical habits'}>{data.enough ? `your data · ${data.n} posts` : 'typical habits'}</Chip>}
      />
      <div className="px-5 pb-5 pt-4 space-y-4">
        {/* region + platform pickers */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Globe2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {REGIONS.map(r => (
            <button key={r.key} onClick={() => pickRegion(r.key)} title={r.note}
              className={`h-7 rounded-full px-2.5 text-[11px] font-medium border ${region === r.key ? 'bg-primary text-primary-foreground border-transparent' : 'border-border bg-card hover:bg-muted'}`}>{r.label}</button>
          ))}
        </div>
        {platform === 'all' && (
          <div className="flex flex-wrap items-center gap-1">
            {PLATS.map(p => (
              <button key={p} onClick={() => setOwn(p)}
                className={`h-7 rounded-md px-2.5 text-[11px] font-medium ${own === p ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{SNAME[p]}</button>
            ))}
          </div>
        )}

        {/* the answer */}
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Clock className="size-3.5" aria-hidden="true" /> Post on {SNAME[plat]}</div>
          <div className="mt-1 text-xl font-semibold tracking-tight">
            {dayList(goodDays)}, {fmtRange(headRange[0], headRange[1])} <span className="text-muted-foreground font-normal text-base">{R.label} time</span>
          </div>
          {!sameZone && <div className="mt-0.5 text-sm">= <b>{yours(headRange[0], headRange[1])}</b> your time ({tzCity(mine)})</div>}
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
            {top
              ? <>Posts that went out then did <b className="text-foreground">{top.lift.toFixed(2)}×</b> better than their usual, and {top.winRate}% were winners (2× or more), across {top.n} posts.</>
              : typ.why}
          </p>
        </div>

        {/* ranked windows from your data */}
        {data.windows.length > 0 && (
          <div>
            <div className="text-[12px] font-semibold mb-1.5">Top windows in your data</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-1.5 font-medium">{R.label}</th>
                  {!sameZone && <th className="py-1.5 font-medium">Your time</th>}
                  <th className="py-1.5 font-medium text-right">Lift</th>
                  <th className="py-1.5 font-medium text-right">Winners</th>
                  <th className="py-1.5 font-medium text-right">Posts</th>
                </tr>
              </thead>
              <tbody>
                {data.windows.map((w, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 font-medium">{fmtRange(w.start, w.end)}</td>
                    {!sameZone && <td className="py-1.5 text-muted-foreground">{yours(w.start, w.end)}</td>}
                    <td className="py-1.5 text-right tabular-nums">{w.lift.toFixed(2)}×</td>
                    <td className="py-1.5 text-right tabular-nums">{w.winRate}%</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{w.n}</td>
                  </tr>
                ))}
                {data.worst && (
                  <tr className="text-muted-foreground">
                    <td className="py-1.5">Weakest: {fmtRange(data.worst.start, data.worst.end)}</td>
                    {!sameZone && <td className="py-1.5">{yours(data.worst.start, data.worst.end)}</td>}
                    <td className="py-1.5 text-right tabular-nums">{data.worst.lift.toFixed(2)}×</td>
                    <td className="py-1.5 text-right tabular-nums">{data.worst.winRate}%</td>
                    <td className="py-1.5 text-right tabular-nums">{data.worst.n}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {!data.enough && <p className="mt-1 text-[11px] text-muted-foreground">Only {data.n} {SNAME[plat]} posts so far — treat these as hints until you have 40+.</p>}
          </div>
        )}

        {/* day × time-of-day heatmap */}
        {data.n > 0 && (
          <div>
            <div className="text-[12px] font-semibold mb-1.5">Day × time ({R.label} clock) <span className="font-normal text-muted-foreground">· darker = posts beat their usual by more</span></div>
            <div className="grid gap-[3px]" style={{ gridTemplateColumns: '2.25rem repeat(8, minmax(0, 1fr))' }} role="table" aria-label="lift by weekday and 3-hour block">
              <span />
              {BLOCK.map(b => <span key={b} className="text-[10px] text-muted-foreground text-center">{b}</span>)}
              {data.grid.map((row, d) => (
                <div key={d} className="contents" role="row">
                  <span className="text-[11px] text-muted-foreground self-center">{DAYS[d]}</span>
                  {row.map((c, b) => (
                    <span key={b} title={c.n ? `${DAYS[d]} ${BLOCK[b]}: ${c.lift ? c.lift.toFixed(2) + '× usual' : 'too few'} · ${c.n} posts` : `${DAYS[d]} ${BLOCK[b]}: no posts`}
                      className="h-5 rounded-[3px] border border-border/40"
                      style={{ background: c.lift ? `color-mix(in oklab, var(--foreground) ${Math.round(Math.min(1, c.lift / maxLift) * 85)}%, transparent)` : 'transparent' }} />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.days.map(d => (
                <span key={d.day} title={`${d.n} posts · ${d.winRate}% winners`}
                  className={`rounded-md border px-2 py-0.5 text-[11px] tabular-nums ${d.n >= 5 && d.lift >= 1.1 ? 'border-foreground/40 font-semibold' : 'border-border text-muted-foreground'}`}>
                  {DAYS[d.day]} {d.n >= 5 ? d.lift.toFixed(2) + '×' : '—'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* typical habits + the same moment elsewhere */}
        <div className="grid gap-3 sm:grid-cols-2 text-[12px] leading-snug">
          <div className="rounded-lg border border-border p-3">
            <div className="font-semibold mb-1">Typical for {SNAME[plat]} <span className="font-normal text-muted-foreground">(audience's local time)</span></div>
            <div><b>{dayList(typ.days)}</b> · {typ.windows.map(w => fmtRange(w[0], w[1])).join(' and ')}</div>
            {!sameZone && <div className="text-muted-foreground">your time for {R.label}: {typ.windows.map(w => yours(w[0], w[1])).join(' and ')}</div>}
            <p className="mt-1.5 text-muted-foreground">{typ.why}</p>
            <p className="mt-1 text-muted-foreground"><b className="text-foreground">Avoid:</b> {typ.avoid}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="font-semibold mb-1">Same moment elsewhere</div>
            <div className="text-muted-foreground mb-1">{R.label} {fmtRange(headRange[0], headRange[1])} is:</div>
            <ul className="space-y-0.5">
              {REGIONS.filter(r => r.key !== region).map(r => (
                <li key={r.key} className="flex justify-between gap-2"><span className="text-muted-foreground">{r.label}</span><span className="tabular-nums">{convertRange(headRange[0], headRange[1], R.tz, r.tz)}</span></li>
              ))}
            </ul>
            <p className="mt-1.5 text-muted-foreground">Want US and Europe both? US East 8–10 AM lands in the European afternoon.</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
