// app/api/tasks/route.ts — the task queue's HTTP adapter.
//
// GET  → the task list (Activity's new home)
// POST → enqueue a task { kind, input }
import { NextResponse, connection } from 'next/server';
import { enqueueTask, listTasks } from '@/lib/application/tasks';
import { route } from '@/lib/http/route';

const handler_GET = async (req: Request) => {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  const params = new URL(req.url).searchParams;
  const kind = params.get('kind') || undefined;
  const status = params.get('status') || undefined;
  const limit = Math.min(500, Math.max(1, Number(params.get('limit')) || 100));
  return NextResponse.json({ tasks: listTasks({ kind, status, limit }) });
}

const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({} as any));
  const kind = String(body?.kind || '').trim();
  if (!kind) return NextResponse.json({ error: 'kind is required' }, { status: 400 });
  const task = enqueueTask({
    kind,
    input: body?.input ?? {},
    title: body?.title,
    page: body?.page,
    platform: body?.platform,
    trigger: body?.trigger || 'api',
    maxAttempts: body?.maxAttempts,
    runAfter: body?.runAfter,
  });
  return NextResponse.json({ task }, { status: 201 });
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
