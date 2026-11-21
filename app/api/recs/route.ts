import { NextResponse } from 'next/server';
import { recommendations } from '@/lib/recs';
import { route } from '@/lib/http/route';

/** GET /api/recs?topics=A|B&src=all|x|linkedin|instagram|tiktok|feeds
 *  Ranked winning posts with details, why-they-won bullets and platform-fit
 *  suggestions. Deterministic — same data in, same ranking out. */
const handler_GET = async (req: Request) => {
  const u = new URL(req.url);
  const topics = (u.searchParams.get('topics') || '').split('|').map((t: string) => decodeURIComponent(t).trim()).filter(Boolean);
  return NextResponse.json(recommendations({ topics, src: u.searchParams.get('src') || 'all' }));
}

export const GET = route(handler_GET);
