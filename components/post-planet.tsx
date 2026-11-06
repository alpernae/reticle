'use client';
// Overview planet — where the posts in your database come from (the author's
// profile location), pinned on a PanelUI Planet. Press a pin or a name for a
// small card: how posts from there perform, who posts them, and when they post
// on their own clock vs yours.
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MapPin, X as XIcon } from 'lucide-react';
import { Planet, type PlanetHandle } from '@/components/panelui/planet';
import { Card, CardHead, Chip } from '@/components/panel';
import type { GeoRegion } from '@/lib/geo';
import { convertRange, fmtRange, tzCity, userTz } from '@/lib/besttime';

type Geo = { regions: GeoRegion[]; located: number; unknown: number; noLocation: number };
const SNAME: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube' };
const PROFILE: Record<string, (h: string) => string> = {
  x: h => `https://x.com/${h}`, instagram: h => `https://www.instagram.com/${h}/`, threads: h => `https://www.threads.com/@${h}`, tiktok: h => `https://www.tiktok.com/@${h}`,
  linkedin: h => `https://www.linkedin.com/in/${h}`, youtube: h => `https://www.youtube.com/@${h}`,
};

/** Busiest 3-hour window in an hour histogram → [start, end). */
function peak(hours: number[]): [number, number] | null {
  let best = -1, at = 0;
  for (let h = 0; h < 24; h++) { const s = hours[h] + hours[(h + 1) % 24] + hours[(h + 2) % 24]; if (s > best) { best = s; at = h; } }
  return best > 0 ? [at, at + 3] : null;
}

export function PostPlanet({ geo }: { geo?: Geo }) {
  const planet = useRef<PlanetHandle>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mine, setMine] = useState('UTC');
  useEffect(() => setMine(userTz()), []);
  if (!geo) return null;

  const regions = geo.regions;
  const total = geo.located + geo.unknown + geo.noLocation;
  const max = Math.max(1, ...regions.map(r => r.n));
  const r = regions.find(x => x.key === sel) || null;
  const pick = (key: string) => {
    const g = regions.find(x => x.key === key);
    setSel(s => (s === key ? null : key));
    if (g) planet.current?.rotateTo([g.lng, Math.max(-50, Math.min(50, g.lat))]);
  };

  return (
    <Card>
      <CardHead
        title="Where the posts come from"
        sub="author profile locations · press a pin or a name for details"
        right={<Chip tone="a" title={`${geo.located} posts placed on the map · ${geo.unknown} have a location we can't place ("Earth", "internet") · ${geo.noLocation} have none`}>{geo.located}/{total} located</Chip>}
      />
      <div className="grid gap-6 px-5 pb-5 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative">
          <Planet ref={planet} defaultRotation={regions[0] ? [regions[0].lng, 25] : [-40, 25]} autoRotate={sel ? false : 4}>
            <Planet.Globe label="Post origins">
              {regions.map(g => (
                <Planet.Marker key={g.key} lat={g.lat} lng={g.lng}
                  label={g.n / max >= 0.15 || g.key === sel ? g.label : undefined} count={g.n / max >= 0.15 || g.key === sel ? g.n : undefined}
                  pulse={g.key === regions[0]?.key && !sel} selected={g.key === sel}
                  color={g.lift >= 1.2 ? 'success' : 'primary'}
                  name={`${g.label}: ${g.n} posts`} onClick={() => pick(g.key)} />
              ))}
            </Planet.Globe>
            <Planet.Controls />
          </Planet>

          {/* the mini card for the picked region */}
          {r && <RegionCard r={r} mine={mine} onClose={() => setSel(null)} />}
        </div>

        <div className="min-w-0">
          {regions.length ? (
            <>
              <Planet.List>
                {regions.slice(0, 16).map(g => (
                  <Planet.ListItem key={g.key} className="w-full" selected={g.key === sel} color={g.lift >= 1.2 ? 'success' : 'primary'} onClick={() => pick(g.key)}>
                    <span className="min-w-0 flex-1 truncate text-start">{g.label}</span>
                    <span className="ml-2 tabular-nums text-muted-foreground">{g.n}</span>
                  </Planet.ListItem>
                ))}
              </Planet.List>
              <p className="mt-3 text-[11px] text-muted-foreground leading-snug">
                Green pins: posts from there beat their creator&apos;s normal by 1.2× or more (median). Locations are what authors type on their profile, so treat a region with one prolific author as that author, not the region.
                {geo.unknown + geo.noLocation > 0 && <> {geo.noLocation} posts have no location, {geo.unknown} have one we can&apos;t place.</>}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No author locations yet. New X collections save them; on Sources, re-import past runs to fill older posts.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function RegionCard({ r, mine, onClose }: { r: GeoRegion; mine: string; onClose: () => void }) {
  const p = peak(r.hours), w = peak(r.winHours);
  const same = r.tz === mine;
  return (
    <div role="dialog" aria-label={`${r.label} details`}
      className="absolute right-0 top-0 z-20 w-[min(280px,100%)] max-h-full overflow-y-auto rounded-xl border border-border bg-popover/95 backdrop-blur text-popover-foreground shadow-lg p-3 text-[12px] leading-snug">
      <div className="flex items-start gap-2">
        <MapPin className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{r.label}</div>
          <div className="text-muted-foreground">{r.n} posts · {r.authorCount} author{r.authorCount === 1 ? '' : 's'} · {Object.entries(r.sources).map(([s, n]) => `${SNAME[s] || s} ${n}`).join(' · ')}</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><XIcon className="size-4" aria-hidden="true" /></button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/60 p-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">vs their normal</div><div className="text-base font-semibold tabular-nums">{r.lift.toFixed(2)}×</div></div>
        <div className="rounded-lg bg-muted/60 p-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">winners (2×+)</div><div className="text-base font-semibold tabular-nums">{r.winRate}%</div></div>
      </div>

      {p && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">When they post ({tzCity(r.tz)} time)</div>
          <div className="flex h-8 items-end gap-[2px]" aria-hidden="true">
            {r.hours.map((n, h) => (
              <span key={h} className="flex-1 rounded-[1px] bg-foreground" style={{ height: `${Math.max(6, (n / Math.max(1, ...r.hours)) * 100)}%`, opacity: n ? (r.winHours[h] ? 1 : 0.45) : 0.12 }} title={`${fmtRange(h, h + 1)}: ${n} posts, ${r.winHours[h]} winners`} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
          <div className="mt-1.5">Busiest: <b>{fmtRange(p[0], p[1])}</b>{!same && <> local = {convertRange(p[0], p[1], r.tz, mine)} yours</>}</div>
          {w && <div>Winners mostly at: <b>{fmtRange(w[0], w[1])}</b>{!same && <> = {convertRange(w[0], w[1], r.tz, mine)} yours</>}</div>}
        </div>
      )}

      {r.authors.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Top authors</div>
          <div className="flex flex-wrap gap-1">
            {r.authors.map(a => (
              <a key={a.name} href={(PROFILE[a.source] || PROFILE.x)(a.name)} target="_blank" rel="noreferrer" className="rounded-md border border-border px-1.5 py-0.5 hover:bg-muted">@{a.name} <span className="text-muted-foreground tabular-nums">{a.n}</span></a>
            ))}
          </div>
        </div>
      )}

      {r.top && (
        <a href={r.top.link} target="_blank" rel="noreferrer" className="mt-3 block rounded-lg border border-border p-2 hover:bg-muted">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">Best post · {r.top.outlier.toFixed(1)}× <ArrowUpRight className="size-3" aria-hidden="true" /></div>
          <div className="line-clamp-2">{r.top.title}</div>
          <div className="text-muted-foreground">{r.top.author ? '@' + r.top.author + ' · ' : ''}{new Date(r.top.created).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} your time</div>
        </a>
      )}
      <div className="mt-2 text-[10px] text-muted-foreground">Matched from: {r.raw.map(s => `"${s}"`).join(', ')}</div>
    </div>
  );
}
