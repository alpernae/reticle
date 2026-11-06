import { NextResponse, connection } from 'next/server';
import { collectYouTube, setYouTubeKey, verifyYouTubeKey, youtubeStatus } from '@/lib/youtube';

export const maxDuration = 120;

/** GET — free YouTube Data API collector status (key mask + last run). */
export async function GET() {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json(youtubeStatus());
}

/** POST { action: 'save', key } | { action: 'clear' } | { action: 'run', perChannel? } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  if (body?.action === 'clear') { setYouTubeKey(''); return NextResponse.json(youtubeStatus()); }
  if (body?.action === 'save') {
    const key = String(body?.key || '').trim();
    const v = await verifyYouTubeKey(key);
    if (!v.ok) return NextResponse.json({ ...youtubeStatus(), error: 'Google rejected that key: ' + v.error }, { status: 400 });
    setYouTubeKey(key);
    return NextResponse.json(youtubeStatus());
  }
  if (body?.action === 'run') {
    try {
      const r = await collectYouTube(Math.max(1, Math.min(50, Number(body?.perChannel) || 10)));
      return NextResponse.json({ ...youtubeStatus(), result: r });
    } catch (e: any) {
      return NextResponse.json({ ...youtubeStatus(), error: e.message }, { status: 400 });
    }
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
