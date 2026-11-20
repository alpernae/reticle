// lib/http/task-shim.ts — the HTTP adapter for "run this work and answer".
//
// Most AI features are a request → wait → answer round trip. The work itself
// is a durable task (ADR-001): the route enqueues it and waits for the worker
// to finish it, so the result belongs to the task table and survives the page
// being closed. The JSON body the browser sees is unchanged.
import { NextResponse } from 'next/server';
import { enqueueTask, waitForTask, type EnqueueInput } from '@/lib/application/tasks';

/**
 * Enqueue a task, wait for it, and answer with its result.
 *
 * The task's output is the use case's `{ status, body }` answer; the response
 * is that body with the same status code. A task that failed but still has an
 * output (a template fallback, a stats summary) still answers with it.
 */
export async function runTaskAndReply(spec: EnqueueInput, waitMs = 240_000) {
  const task = enqueueTask(spec);
  const done = await waitForTask(task.id, waitMs);
  if (!done) return NextResponse.json({ error: 'the task disappeared' }, { status: 500 });

  const out = (done.output || null) as { status?: number; body?: any } | null;
  const body = out && typeof out === 'object' && 'body' in out ? out.body : out;
  if (done.status === 'cancelled') {
    return NextResponse.json({ error: 'cancelled', taskId: task.id }, { status: 499 });
  }
  if (done.status !== 'done' && !out) {
    return NextResponse.json({ error: done.error || 'the task failed', taskId: task.id }, { status: 500 });
  }
  const payload = body && typeof body === 'object' && !Array.isArray(body)
    ? { ...body, runId: task.id }
    : body;
  return NextResponse.json(payload ?? {}, { status: out?.status ?? 200 });
}
