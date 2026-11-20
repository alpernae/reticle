// app/api/formats/route.ts — HTTP adapter for the Formats use cases.
//
// GET  → the saved series trackers
// POST → { action: 'save', trackers } (no AI) | { action: 'polish' | 'quick', … }
//
// The two AI actions are durable tasks (kinds "format-polish" / "format-quick"):
// the route enqueues them and waits for the worker. The JSON body is unchanged.
import { NextResponse, connection } from 'next/server';
import { QUICK_FORMATS } from '@/lib/formats';
import { listTrackers, saveTrackers } from '@/lib/trackers';
import { runTaskAndReply } from '@/lib/http/task-shim';
import { route } from '@/lib/http/route';

export const maxDuration = 200;

/** GET — saved series trackers. */
const handler_GET = async () => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json({ trackers: listTrackers() });
}

/** POST { action: 'save', trackers } | { action: 'polish', text, model? } | { action: 'quick', format, audience, platform, count, idea?, model? } */
const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({} as any));

  if (body?.action === 'save') {
    const list = saveTrackers(Array.isArray(body.trackers) ? body.trackers : []);
    return NextResponse.json({ trackers: list });
  }

  if (body?.action === 'polish') {
    return runTaskAndReply({
      kind: 'format-polish',
      input: { text: body.text, model: body.model || null },
      title: 'Polish series post — ' + String(body.text || '').split('\n')[0].slice(0, 60),
      page: '/formats',
      platform: 'x',
      trigger: 'api',
    }, 190_000);
  }

  if (body?.action === 'quick') {
    const fmt = (QUICK_FORMATS.find(x => x.key === body.format) || QUICK_FORMATS[0]);
    return runTaskAndReply({
      kind: 'format-quick',
      input: body,
      title: `Quick posts · ${fmt.name} · ${body.count || 5}× ${body.platform || 'x'}`,
      page: '/formats',
      platform: String(body.platform || 'x'),
      trigger: 'api',
    }, 190_000);
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
