import { NextResponse } from 'next/server';
import { apifyStart, apifyTopicScanX, apifyDeepScanX, apifyPoll, isPlatform, listRuns } from '@/lib/apify';

export const maxDuration = 120;

/** POST — start a run for one platform: { platform: 'x'|'instagram'|'linkedin', sources? }.
 *  Uses the saved config (actor id, source list, maxItems cost guard). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const platform = String(body?.platform || '');
  if (!isPlatform(platform)) return NextResponse.json({ error: 'platform must be x, linkedin, instagram, threads, tiktok or youtube' }, { status: 400 });
  try {
    const run = platform === 'x' && body?.topicQuery
      ? await apifyTopicScanX(String(body.topicLabel || 'custom'), String(body.topicQuery), Number(body.minFaves ?? 150), Number(body.maxItems) || 150, Number(body.days) || 30) // { topicQuery }
      : platform === 'x' && body?.deep
      ? await apifyDeepScanX(String(body.deep), Number(body.perAccount) || 50, Number(body.days) || 60) // { deep: '@handle' }
      : await apifyStart(platform, body?.sources != null ? String(body.sources) : undefined);
    return NextResponse.json({ run });
  } catch (e: any) {
    const msg = String(e?.message || '');
    // token problems and spend-limit refusals are client-fixable → 400; anything upstream → 502
    return NextResponse.json({ error: msg }, { status: /token|spend limit/i.test(msg) ? 400 : 502 });
  }
}

/** GET ?id=<runId> — poll one run (imports its dataset once it has SUCCEEDED).
 *  GET without id — full run history. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ runs: listRuns() });
  try {
    const r = await apifyPoll(id);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
