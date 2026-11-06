// lib/visuals.ts — client-side image designer for the toolkit (no dependencies).
// Renders YouTube thumbnails, Reel covers, profile banners, post images and
// carousel slides onto a canvas at the platform's exact pixel size, keeping
// text inside each platform's safe area. Your uploaded image never leaves the
// browser.

export type Theme = { key: string; label: string; bg: [string, string]; text: string; sub: string; accent: string; panel: string };
export const THEMES: Theme[] = [
  { key: 'midnight', label: 'Midnight', bg: ['#0b1020', '#1e1b4b'], text: '#ffffff', sub: '#cbd5e1', accent: '#facc15', panel: 'rgba(255,255,255,0.06)' },
  { key: 'terminal', label: 'Terminal', bg: ['#020617', '#052e16'], text: '#e2fbe8', sub: '#86efac', accent: '#22c55e', panel: 'rgba(34,197,94,0.08)' },
  { key: 'redteam', label: 'Red team', bg: ['#0a0a0a', '#450a0a'], text: '#ffffff', sub: '#fca5a5', accent: '#ef4444', panel: 'rgba(239,68,68,0.08)' },
  { key: 'ocean', label: 'Ocean', bg: ['#082f49', '#0e7490'], text: '#ffffff', sub: '#bae6fd', accent: '#fde047', panel: 'rgba(255,255,255,0.08)' },
  { key: 'paper', label: 'Paper', bg: ['#fafaf9', '#e7e5e4'], text: '#0c0a09', sub: '#44403c', accent: '#2563eb', panel: 'rgba(0,0,0,0.04)' },
  { key: 'mono', label: 'Mono', bg: ['#111111', '#111111'], text: '#ffffff', sub: '#a3a3a3', accent: '#ffffff', panel: 'rgba(255,255,255,0.06)' },
];

export type Size = { w: number; h: number; safe?: { w: number; h: number }; label: string };
export const SIZES: Record<string, Size> = {
  'yt-thumbnail': { w: 1280, h: 720, label: 'YouTube thumbnail 1280×720' },
  'ig-reel-cover': { w: 1080, h: 1920, safe: { w: 1080, h: 1440 }, label: 'Reel cover 1080×1920 (grid-safe 1080×1440)' },
  'carousel': { w: 1080, h: 1350, label: 'Carousel slide 1080×1350' },
  'banner-x': { w: 1500, h: 500, label: 'X header 1500×500' },
  'banner-linkedin': { w: 1584, h: 396, label: 'LinkedIn banner 1584×396' },
  'banner-youtube': { w: 2560, h: 1440, safe: { w: 1546, h: 423 }, label: 'YouTube channel art 2560×1440 (safe 1546×423)' },
  'post-instagram': { w: 1080, h: 1350, label: 'Instagram post 1080×1350' },
  'post-x': { w: 1600, h: 900, label: 'X image 1600×900' },
  'post-linkedin': { w: 1200, h: 1200, label: 'LinkedIn image 1200×1200' },
};

export type VisualOpts = {
  size: Size; theme: Theme; accent?: string;
  headline: string; highlight?: string; sub?: string; handle?: string; badge?: string;
  image?: HTMLImageElement | null; imageMode?: 'right' | 'full' | 'none';
  slide?: { index: number; total: number; body?: string } | null;
  align?: 'left' | 'center';
};

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

/** Greedy word wrap that shrinks the font until the text fits the box. */
function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, maxH: number, maxSize: number, minSize: number, weight = 800, lineH = 1.08) {
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = maxSize; size >= minSize; size -= 2) {
    g.font = `${weight} ${size}px ${FONT}`;
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    const widest = Math.max(...lines.map(l => g.measureText(l).width));
    if (lines.length * size * lineH <= maxH && widest <= maxW) return { size, lines, lineH: size * lineH };
  }
  g.font = `${weight} ${minSize}px ${FONT}`;
  return { size: minSize, lines: [text], lineH: minSize * lineH };
}

function drawWords(g: CanvasRenderingContext2D, line: string, x: number, y: number, align: 'left' | 'center', color: string, accent: string, highlight: string) {
  const hl = highlight.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const parts = line.split(/(\s+)/);
  const total = g.measureText(line).width;
  let cx = align === 'center' ? x - total / 2 : x;
  g.textAlign = 'left';
  for (const p of parts) {
    const clean = p.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    g.fillStyle = hl && clean === hl ? accent : color;
    g.fillText(p, cx, y);
    cx += g.measureText(p).width;
  }
}

function coverImage(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const r = Math.max(w / img.width, h / img.height);
  const iw = img.width * r, ih = img.height * r;
  g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

export function renderVisual(o: VisualOpts): HTMLCanvasElement {
  const { w, h } = o.size;
  const th = o.theme, accent = o.accent || th.accent;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!;
  // background
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, th.bg[0]); grad.addColorStop(1, th.bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // subtle grid texture
  g.strokeStyle = th.panel; g.lineWidth = 1;
  const step = Math.round(Math.min(w, h) / 12);
  for (let x = step; x < w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = step; y < h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

  // safe area (content box)
  const safe = o.size.safe || { w, h };
  const sx = (w - safe.w) / 2, sy = (h - safe.h) / 2;
  const pad = Math.round(Math.min(safe.w, safe.h) * 0.08);
  let box = { x: sx + pad, y: sy + pad, w: safe.w - pad * 2, h: safe.h - pad * 2 };

  // image
  const mode = o.image ? o.imageMode || 'right' : 'none';
  if (o.image && mode === 'full') {
    coverImage(g, o.image, 0, 0, w, h);
    const shade = g.createLinearGradient(0, 0, w, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.82)'); shade.addColorStop(0.65, 'rgba(0,0,0,0.35)'); shade.addColorStop(1, 'rgba(0,0,0,0.1)');
    g.fillStyle = shade; g.fillRect(0, 0, w, h);
  } else if (o.image && mode === 'right') {
    const landscape = safe.w > safe.h * 1.2;
    if (landscape) {
      const iw = Math.round(safe.w * 0.42);
      const ix = sx + safe.w - iw - pad / 2, iy = sy + pad / 2, ih = safe.h - pad;
      g.save(); roundRect(g, ix, iy, iw, ih, Math.round(pad / 3)); g.clip(); coverImage(g, o.image, ix, iy, iw, ih); g.restore();
      g.strokeStyle = accent; g.lineWidth = Math.max(4, Math.round(w / 300)); roundRect(g, ix, iy, iw, ih, Math.round(pad / 3)); g.stroke();
      box = { ...box, w: box.w - iw - pad / 2 };
    } else {
      const ih = Math.round(safe.h * 0.42);
      const ix = sx + pad, iy = sy + safe.h - ih - pad, iw = safe.w - pad * 2;
      g.save(); roundRect(g, ix, iy, iw, ih, Math.round(pad / 3)); g.clip(); coverImage(g, o.image, ix, iy, iw, ih); g.restore();
      box = { ...box, h: box.h - ih - pad / 2 };
    }
  }

  const align = o.align || (o.slide ? 'left' : 'left');
  const tx = align === 'center' ? box.x + box.w / 2 : box.x;
  let y = box.y;

  // badge / slide counter
  const small = Math.max(18, Math.round(Math.min(safe.w, safe.h) * 0.035));
  if (o.badge || o.slide) {
    g.font = `700 ${small}px ${FONT}`;
    const label = o.slide ? `${o.slide.index + 1} / ${o.slide.total}` : o.badge!;
    const bw = g.measureText(label).width + small * 1.4, bh = small * 1.9;
    const bx = align === 'center' ? tx - bw / 2 : tx;
    g.fillStyle = accent; roundRect(g, bx, y, bw, bh, bh / 2); g.fill();
    g.fillStyle = contrast(accent); g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(label, bx + bw / 2, y + bh / 2 + 1);
    y += bh + small;
  }

  // headline + sub/body fill the remaining box
  const footer = o.handle ? small * 2.2 : 0;
  const bodyText = o.slide?.body || '';
  const headH = (box.y + box.h - footer - y) * (bodyText ? 0.45 : o.sub ? 0.78 : 1);
  const hs = fitText(g, o.headline || ' ', box.w, headH, Math.round(Math.min(safe.w, safe.h) * (o.slide ? 0.11 : 0.16)), 22);
  g.textBaseline = 'top';
  for (const line of hs.lines) { g.font = `800 ${hs.size}px ${FONT}`; drawWords(g, line, tx, y, align, th.text, accent, o.highlight || ''); y += hs.lineH; }
  y += hs.size * 0.35;
  // accent bar
  g.fillStyle = accent; g.fillRect(align === 'center' ? tx - hs.size : tx, y, hs.size * 2, Math.max(4, hs.size * 0.08)); y += hs.size * 0.45;

  const rest = box.y + box.h - footer - y;
  const second = bodyText || o.sub || '';
  if (second && rest > 20) {
    const ss = fitText(g, second, box.w, rest, Math.round(hs.size * (bodyText ? 0.42 : 0.38)), 16, bodyText ? 500 : 600, 1.3);
    g.fillStyle = th.sub;
    for (const line of ss.lines) { g.font = `${bodyText ? 500 : 600} ${ss.size}px ${FONT}`; g.textAlign = align; g.fillText(line, tx, y); y += ss.lineH; }
  }
  // footer: handle + swipe hint
  if (o.handle) {
    g.font = `700 ${small}px ${FONT}`; g.fillStyle = th.sub; g.textBaseline = 'alphabetic'; g.textAlign = align;
    g.fillText(o.handle, tx, box.y + box.h);
    if (o.slide && o.slide.index < o.slide.total - 1) { g.textAlign = 'right'; g.fillStyle = accent; g.fillText('swipe →', box.x + box.w, box.y + box.h); }
  }
  return cv;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function contrast(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return '#000';
  const n = parseInt(m[1], 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
  return (r * 299 + gg * 587 + b * 114) / 1000 > 140 ? '#0a0a0a' : '#ffffff';
}

/** Parse "HEADLINE: … / HIGHLIGHT: … / SUB: …" AI items. */
export function parseVisualItem(s: string): { headline: string; highlight: string; sub: string } {
  const get = (k: string) => (new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'im').exec(s)?.[1] || '').trim();
  return { headline: get('HEADLINE') || s.split('\n')[0].trim(), highlight: get('HIGHLIGHT'), sub: get('SUB') };
}
