// Reticle logo — a recon viewfinder with one corner left open: the ordinary
// posts (dim dots) stay inside the frame, the outlier breaks out through the
// open corner. "Find the post that broke out" in one glyph. Monochrome, theme
// tokens only, so it works in dark and light.
import { BRAND } from '@/lib/brand';

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground ${className}`}>
      <svg viewBox="0 0 32 32" fill="none" className="h-full w-full">
        <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 12V9a2.5 2.5 0 0 1 2.5-2.5h3" />
          <path d="M6.5 20v3a2.5 2.5 0 0 0 2.5 2.5h3" />
          <path d="M20 25.5h3a2.5 2.5 0 0 0 2.5-2.5v-3" />
        </g>
        <circle cx="11.5" cy="19.5" r="2" fill="currentColor" opacity=".5" />
        <circle cx="16.5" cy="17" r="2" fill="currentColor" opacity=".5" />
        <circle cx="23.4" cy="8.6" r="3.4" fill="currentColor" />
      </svg>
    </span>
  );
}

/** The full lock-up: mark + wordmark + tagline, as used in the sidebar. */
export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="min-w-0">
        <div className="font-semibold text-[15px] leading-tight tracking-tight">{BRAND.name.toLowerCase()}</div>
        <div className="text-[11px] text-muted-foreground leading-tight">{BRAND.tagline}</div>
      </div>
    </div>
  );
}
