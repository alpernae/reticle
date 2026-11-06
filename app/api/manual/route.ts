import { NextResponse } from 'next/server';
import { addManual, delManual, updateManual } from '@/lib/engine';

/** POST — create a stored result (Generate auto-save), or update one:
 *  { id: 'm:123', likes, comments, views, when } logs the real numbers after posting. */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (b.id) {
      updateManual(String(b.id), { eng: b.eng, when: b.when, likes: b.likes, comments: b.comments, views: b.views });
      return NextResponse.json({ ok: true });
    }
    addManual({ platform: b.platform, text: b.text, eng: b.eng, when: b.when, likes: b.likes, comments: b.comments, views: b.views });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  delManual(new URL(req.url).searchParams.get('id') || '');
  return NextResponse.json({ ok: true });
}
