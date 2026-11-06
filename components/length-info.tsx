'use client';
// Live post length the way the platform counts it (X: links = 23, emoji = 2),
// and the "first reply" link box — post the post, then reply to it with this.
import { useState } from 'react';
import { btn } from '@/components/panel';
import { platformLength, postLimit, threadPosts } from '@/lib/limits';
import { Check, Copy, CornerDownRight } from 'lucide-react';

export function LengthBadge({ platform, text, format, limit: limitOverride, thread }: { platform: string; text: string; format?: string | null; limit?: number | null; thread?: boolean }) {
  const limit = limitOverride !== undefined ? limitOverride : postLimit(platform, thread ? 'x-post' : format);
  const len = thread ? Math.max(0, ...threadPosts(text).map(p => platformLength(platform, p))) : platformLength(platform, text);
  const over = limit != null && len > limit;
  const label = `${thread ? 'longest post ' : ''}${len}${limit != null ? ` / ${limit}` : ''}${platform === 'x' ? '' : ' chars'}${over ? ` — over by ${len - limit!}` : ''}`;
  return (
    <span title={platform === 'x' ? 'Counted the way X counts: every link = 23, every emoji = 2. Free accounts: 280.' : 'characters'}
      className={`text-[11px] tabular-nums ${over ? 'rounded-full border-2 border-foreground px-2 py-0.5 font-semibold text-foreground' : 'text-muted-foreground'}`}>
      {label}
    </span>
  );
}

export function FirstReply({ link }: { link?: string }) {
  const [ok, setOk] = useState(false);
  if (!link) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px]">
      <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground shrink-0">First reply:</span>
      <span className="truncate">{link}</span>
      <button className={btn + ' ml-auto h-7 px-2 text-[11px] shrink-0'} onClick={() => { navigator.clipboard.writeText(link); setOk(true); setTimeout(() => setOk(false), 1500); }}>
        {ok ? <><Check className="size-3" aria-hidden="true" /> Copied</> : <><Copy className="size-3" aria-hidden="true" /> Copy</>}
      </button>
    </div>
  );
}
