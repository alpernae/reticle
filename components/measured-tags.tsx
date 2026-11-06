'use client';
// Hashtags measured in YOUR collected posts — the evidence AI hashtag
// suggestions are judged against (lib/tool-prompts.ts hashtagStats).
import { Card } from '@/components/panel';

export type MeasuredTag = { tag: string; n: number; medianOutlier: number };

export function MeasuredTags({ tags, platform }: { tags: MeasuredTag[]; platform: string }) {
  return (
    <Card className="p-4 space-y-2">
      <div className="text-[13px] font-semibold">Measured in your data</div>
      <p className="text-[11px] text-muted-foreground">
        Hashtags used by at least 2 collected posts{tags.length ? '' : ` — none on ${platform} yet`}, ranked by median outlier (how far
        those posts beat their creator’s normal), weighted by sample size. Above 1× = posts with this tag over-performed. AI suggestions
        not marked “(from your data)” are unverified best guesses.
      </p>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(t => (
            <span key={t.tag} title={`${t.n} posts · median outlier ${t.medianOutlier}×`}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] tabular-nums ${t.medianOutlier >= 1 ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}>
              {t.tag} <span className="opacity-70">{t.medianOutlier}× · n{t.n}</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
