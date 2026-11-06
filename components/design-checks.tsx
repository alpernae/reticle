'use client';
// Design checks under the designer preview. These are platform best-practice
// rules, NOT measured evidence — Reticle doesn't analyse image performance.
import type { VisualKind } from '@/lib/tools';

function lum(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return 0;
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export function DesignChecks({ kind, headline, highlight, handle, hasImage, text, bg }: {
  kind: VisualKind; headline: string; highlight: string; handle: string; hasImage: boolean; text: string; bg: [string, string];
}) {
  const words = headline.trim().split(/\s+/).filter(Boolean).length;
  const maxWords = kind === 'banner' ? 8 : kind === 'post-image' ? 12 : 5;
  const contrast = Math.min(ratio(text, bg[0]), ratio(text, bg[1]));
  const checks: [boolean, string][] = [
    [words > 0 && words <= maxWords, `Headline ${words} words (aim ≤ ${maxWords} — readable at feed size)`],
    [!highlight || headline.toLowerCase().includes(highlight.toLowerCase()), highlight ? 'Highlight word appears in the headline' : 'No highlight word — one coloured word draws the eye'],
    [contrast >= 4.5, `Text contrast ${contrast.toFixed(1)}:1 (WCAG AA needs 4.5:1)`],
    [!!handle, handle ? 'Handle printed (brand recall when shared)' : 'Add your handle so reposts point back to you'],
  ];
  if (kind === 'yt-thumbnail') checks.push([hasImage, hasImage ? 'Has a screenshot/face — a clear subject usually out-clicks text-only' : 'Text-only — consider a screenshot or your face for a clear subject']);
  return (
    <ul className="text-[11px] space-y-0.5 pt-1">
      {checks.map(([ok, label]) => <li key={label} className={ok ? 'text-foreground' : 'text-muted-foreground'}>{ok ? '✓' : '○'} {label}</li>)}
      <li className="text-muted-foreground pt-1">Best-practice rules, not measured — Reticle doesn’t analyse images yet.</li>
    </ul>
  );
}
