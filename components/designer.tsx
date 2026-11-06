'use client';
// Visual designer for the toolkit: live canvas preview at the platform's exact
// size, themes, accent colour, highlight word, your own image (stays local),
// PNG download. Carousels render every slide and can download them all.
import { useEffect, useMemo, useState } from 'react';
import { btn, btnPrimary, inputCls, labelCls } from '@/components/panel';
import { SIZES, THEMES, parseVisualItem, renderVisual, type Size } from '@/lib/visuals';
import type { ToolPlatform, VisualKind } from '@/lib/tools';
import { Download, ImagePlus, X as XIcon } from 'lucide-react';
import { DesignChecks } from '@/components/design-checks';
import { Sel } from '@/components/sel';

export type Slide = { title: string; body: string };

function sizesFor(kind: VisualKind, platform: ToolPlatform): string[] {
  if (kind === 'banner') return [`banner-${platform}`].filter(k => SIZES[k]);
  if (kind === 'post-image') return [`post-${platform}`].filter(k => SIZES[k]);
  if (kind === 'carousel') return ['carousel'];
  return [kind];
}

const dl = (url: string, name: string) => { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); };

export function Designer({ kind, platform, suggestions, slides: slidesIn, handle: handleIn }: {
  kind: VisualKind; platform: ToolPlatform; suggestions?: string[]; slides?: Slide[]; handle?: string;
}) {
  const sizeKeys = sizesFor(kind, platform);
  const [sizeKey, setSizeKey] = useState(sizeKeys[0]);
  useEffect(() => setSizeKey(sizesFor(kind, platform)[0]), [kind, platform]);
  const size: Size = SIZES[sizeKey] || SIZES['yt-thumbnail'];
  const [themeKey, setThemeKey] = useState('midnight');
  const theme = THEMES.find(t => t.key === themeKey) || THEMES[0];
  const [accent, setAccent] = useState('');
  const [headline, setHeadline] = useState('I hacked my own app');
  const [highlight, setHighlight] = useState('hacked');
  const [sub, setSub] = useState('');
  const [badge, setBadge] = useState('');
  const [handle, setHandle] = useState(handleIn || '');
  const [align, setAlign] = useState<'left' | 'center'>(kind === 'banner' || kind === 'post-image' ? 'center' : 'left');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imageMode, setImageMode] = useState<'right' | 'full'>('right');
  const [slides, setSlides] = useState<Slide[]>(slidesIn || []);
  useEffect(() => { if (slidesIn) setSlides(slidesIn); }, [slidesIn]);
  useEffect(() => { if (handleIn && !handle) setHandle(handleIn); }, [handleIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (s: string) => { const p = parseVisualItem(s); setHeadline(p.headline); setHighlight(p.highlight); setSub(p.sub); };
  useEffect(() => { if (suggestions?.[0]) apply(suggestions[0]); }, [suggestions]);

  const upload = (f?: File | null) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { const i = new Image(); i.onload = () => setImg(i); i.src = String(r.result); };
    r.readAsDataURL(f);
  };

  const base = { size, theme, accent: accent || undefined, handle: handle || undefined, image: img, imageMode, align };
  const single = useMemo(() => {
    if (kind === 'carousel') return '';
    try { return renderVisual({ ...base, headline, highlight, sub, badge: badge || undefined }).toDataURL('image/png'); } catch { return ''; }
  }, [kind, size, theme, accent, handle, img, imageMode, align, headline, highlight, sub, badge]); // eslint-disable-line react-hooks/exhaustive-deps
  const slideUrls = useMemo(() => {
    if (kind !== 'carousel') return [];
    return slides.map((s, i) => renderVisual({ ...base, image: i === 0 ? img : null, headline: s.title, highlight: '', slide: { index: i, total: slides.length, body: i === 0 ? '' : s.body }, sub: i === 0 ? s.body : '' }).toDataURL('image/png'));
  }, [kind, slides, size, theme, accent, handle, img, imageMode, align]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {suggestions?.length ? (
        <div>
          <div className={labelCls}>AI text options — click to use</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => { const p = parseVisualItem(s); return (
              <button key={i} onClick={() => apply(s)} className="rounded-lg border border-border px-2.5 py-1.5 text-left text-[12px] hover:bg-muted">
                <b>{p.headline}</b>{p.sub ? <span className="text-muted-foreground"> · {p.sub}</span> : null}
              </button>); })}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4 items-start">
        <div className="space-y-2.5">
          {sizeKeys.length > 1 && <div><label className={labelCls}>Size</label><Sel className={inputCls} value={sizeKey} onChange={e => setSizeKey(e.target.value)}>{sizeKeys.map(k => <option key={k} value={k}>{SIZES[k].label}</option>)}</Sel></div>}
          {kind !== 'carousel' && <>
            <div><label className={labelCls}>Headline</label><input className={inputCls} value={headline} onChange={e => setHeadline(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>Highlight word</label><input className={inputCls} value={highlight} onChange={e => setHighlight(e.target.value)} /></div>
              <div><label className={labelCls}>Badge</label><input className={inputCls} value={badge} onChange={e => setBadge(e.target.value)} placeholder="e.g. NEW · P1 · DAY 12" /></div>
            </div>
            <div><label className={labelCls}>Subline</label><input className={inputCls} value={sub} onChange={e => setSub(e.target.value)} /></div>
          </>}
          <div><label className={labelCls}>Handle / footer</label><input className={inputCls} value={handle} onChange={e => setHandle(e.target.value)} placeholder="@yourhandle" /></div>
          <div>
            <label className={labelCls}>Theme</label>
            <div className="flex flex-wrap gap-1.5">
              {THEMES.map(t => <button key={t.key} onClick={() => setThemeKey(t.key)} title={t.label}
                className={`size-8 rounded-md border-2 ${t.key === themeKey ? 'border-foreground' : 'border-transparent'}`}
                style={{ background: `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]})`, boxShadow: `inset -6px -6px 0 ${t.accent}` }} />)}
              <input type="color" value={accent || theme.accent} onChange={e => setAccent(e.target.value)} title="accent colour" className="size-8 rounded-md border border-border bg-transparent" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls}>Text align</label><Sel className={inputCls} value={align} onChange={e => setAlign(e.target.value as 'left' | 'center')}><option value="left">Left</option><option value="center">Center</option></Sel></div>
            <div><label className={labelCls}>Image</label><Sel className={inputCls} value={imageMode} onChange={e => setImageMode(e.target.value as 'right' | 'full')} disabled={!img}><option value="right">Side panel</option><option value="full">Full background</option></Sel></div>
          </div>
          <div className="flex items-center gap-2">
            <label className={btn + ' h-9 cursor-pointer'}><ImagePlus className="size-4" aria-hidden="true" /> {img ? 'Change image' : 'Add screenshot / photo'}
              <input type="file" accept="image/*" className="hidden" onChange={e => upload(e.target.files?.[0])} /></label>
            {img && <button className={btn + ' h-9 px-2.5'} onClick={() => setImg(null)} aria-label="remove image"><XIcon className="size-4" aria-hidden="true" /></button>}
          </div>
          <p className="text-[11px] text-muted-foreground">{size.label}. Images stay in your browser — nothing is uploaded.</p>
        </div>

        {kind !== 'carousel' ? (
          <div className="space-y-2">
            {single && <img src={single} alt="preview" className="w-full rounded-lg border border-border" />}
            <button className={btnPrimary} onClick={() => dl(single, `${kind}-${size.w}x${size.h}.png`)} disabled={!single}><Download className="size-4" aria-hidden="true" /> Download PNG</button>
            <DesignChecks kind={kind} headline={headline} highlight={highlight} handle={handle} hasImage={!!img} text={theme.text} bg={theme.bg} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {slideUrls.map((u, i) => (
                <div key={i} className="space-y-1">
                  <img src={u} alt={`slide ${i + 1}`} className="w-full rounded-md border border-border" />
                  <input className={inputCls + ' h-8 text-[12px]'} value={slides[i].title} onChange={e => setSlides(s => s.map((x, k) => k === i ? { ...x, title: e.target.value } : x))} aria-label={`slide ${i + 1} title`} />
                  <textarea className={inputCls + ' text-[12px] min-h-[52px]'} value={slides[i].body} onChange={e => setSlides(s => s.map((x, k) => k === i ? { ...x, body: e.target.value } : x))} aria-label={`slide ${i + 1} body`} />
                  <button className={btn + ' h-7 px-2 text-[11px]'} onClick={() => dl(u, `slide-${i + 1}.png`)}><Download className="size-3" aria-hidden="true" /> slide {i + 1}</button>
                </div>
              ))}
            </div>
            {slideUrls.length > 0 && <button className={btnPrimary} onClick={async () => { for (let i = 0; i < slideUrls.length; i++) { dl(slideUrls[i], `slide-${String(i + 1).padStart(2, '0')}.png`); await new Promise(r => setTimeout(r, 350)); } }}><Download className="size-4" aria-hidden="true" /> Download all {slideUrls.length} slides</button>}
            {!slides.length && <p className="text-[13px] text-muted-foreground">Generate slides with AI first — then edit any slide here.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
