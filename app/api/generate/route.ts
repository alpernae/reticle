// app/api/generate/route.ts — HTTP adapter for the drafts use case.
//
// The work itself is a durable task (kind "generate"): the route enqueues it
// and waits for the worker to finish it. The response shape is unchanged, so
// the Generate page needs no changes — but the result now belongs to the task
// table and survives the page being closed (ADR-001).
import { NextResponse } from 'next/server';
import { enqueueTask, waitForTask } from '@/lib/application/tasks';
import { route } from '@/lib/http/route';

export const maxDuration = 300;

const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const platform = String(body?.platform || 'x');
  const task = enqueueTask({
    kind: 'generate',
    input: body,
    title: `Generate · ${platform}`,
    page: '/generate',
    platform,
    trigger: 'api',
  });
  const done = await waitForTask(task.id, 285_000);
  if (!done) return NextResponse.json({ error: 'the task disappeared' }, { status: 500 });
  if (done.status === 'cancelled') return NextResponse.json({ error: 'cancelled' }, { status: 499 });
  if (done.status !== 'done') return NextResponse.json({ error: done.error || 'the task failed', taskId: task.id }, { status: 500 });
  const out = done.output as { status?: number; body?: any } | null;
  return NextResponse.json(out?.body ?? {}, { status: out?.status ?? 200 });
}

export const POST = route(handler_POST);
