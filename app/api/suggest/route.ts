import { NextResponse } from 'next/server';
import { recommendations } from '@/lib/recs';
import { allPayload, fallbackDraft } from '@/lib/engine';
import type { Post } from '@/lib/engine';

const handlers = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

/** GET ?platform=x|linkedin|instagram — suggested posts ready to copy: the top
 *  ranked winners turned into draft templates for the requested platform, each
 *  with the full detail line (posted date incl. hour, likes, comments, views,
 *  engagement). Deterministic — no AI call, no invented numbers. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('platform') || 'x';
  const target = ['x', 'linkedin', 'instagram'].includes(q) ? q : 'x';
  const payload = allPayload();
  const { recs } = recommendations({ topics: [], src: 'all' });

  const suggestions = recs.slice(0, 6).map(r => {
    const draft = fallbackDraft(target, { title: r.title, topic: r.topics[0] || '' });
    const posted = payload.posts.find((p: Post) => p.id === r.id);
    const mine = r.id.startsWith('m:') ? payload.manual.find(m => 'm:' + m.id === r.id) : null;
    const when = posted
      ? (posted.created ? handlers.format(new Date(posted.created)) : '')
      : (mine?.when || '');
    const likes = posted ? posted.score : (mine?.likes ?? null);
    const comments = posted ? posted.comments : (mine?.comments ?? null);
    const views = (posted as any)?.views ?? mine?.views ?? null;
    return {
      id: r.id,
      kind: r.kind,               // own | public
      origin: r.origin,           // platform the winner came from
      target,                     // platform the draft is shaped for
      title: r.title,
      draft: draft.variants[0]?.text || r.title,
      hashtags: draft.variants[0]?.hashtags || [],
      link: r.link,
      whenLabel: when || (r.kind === 'own' ? 'not posted yet' : r.whenLabel),
      likes, comments, views,
      eng: r.eng,
      engDetail: r.engDetail,
      detailLine: `impressions ${views != null ? views.toLocaleString('en-US') : '—'} · likes ${likes != null ? likes.toLocaleString('en-US') : '—'} · comments ${comments != null ? comments.toLocaleString('en-US') : '—'} · posted ${when || '—'}`,
      topics: r.topics,
      scorePct: r.scorePct,
    };
  });

  return NextResponse.json({ suggestions });
}
