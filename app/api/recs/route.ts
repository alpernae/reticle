import { NextResponse } from 'next/server';
import { recommendations } from '@/lib/recs';

/** GET /api/recs?topics=A|B&src=all|x|linkedin|instagram|tiktok|feeds
 *  Ranked winning posts with details, why-they-won bullets and platform-fit
 *  suggestions. Deterministic — same data in, same ranking out. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const topics = (u.searchParams.get('topics') || '').split('|').map((t: string) => decodeURIComponent(t).trim()).filter(Boolean);
  return NextResponse.json(recommendations({ topics, src: u.searchParams.get('src') || 'all' }));
}
