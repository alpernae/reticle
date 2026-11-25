import { NextResponse, connection } from 'next/server';
import { listViral } from '@/lib/application/viral';
import { route } from '@/lib/http/route';

/**
 * GET — the viral finder: the corpus ranked by how far each post beat its own
 * yardstick (its author's usual, the platform's median, the audience's rate),
 * weighted by recency. Every card carries the reason it ranked and the
 * structural recipe a new post can imitate.
 *
 *   ?platform=x,threads   the platforms to look at ("all" = every one)
 *   ?days=60              how far back to look
 *   ?minLift=1.5          how many times its baseline a post must beat
 *   ?cursor=…            the next page
 *   ?limit=20             how many cards
 */
const handler_GET = async (req: Request) => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  const q = new URL(req.url).searchParams;
  const num = (key: string) => {
    const raw = q.get(key);
    if (raw == null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return NextResponse.json(
    listViral({
      platform: q.get('platform') || undefined,
      days: num('days'),
      minLift: num('minLift'),
      cursor: q.get('cursor'),
      limit: num('limit'),
    }),
  );
};

export const GET = route(handler_GET);
