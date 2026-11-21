import { NextResponse, connection } from 'next/server';
import { addManual, delManual, updateManual } from '@/lib/engine';
import { getStore } from '@/lib/db';
import { route } from '@/lib/http/route';

/** GET — the stored results (the Winners page's "My results" table). */
const handler_GET = async () => {
  await connection();
  return NextResponse.json({ manual: getStore().allManual() });
};

/** POST — create a stored result (Generate auto-save), or update one:
 *  { id: 'm:123', likes, comments, views, when } logs the real numbers after posting. */
const handler_POST = async (req: Request) => {
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

const handler_DELETE = async (req: Request) => {
  delManual(new URL(req.url).searchParams.get('id') || '');
  return NextResponse.json({ ok: true });
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
export const DELETE = route(handler_DELETE);
