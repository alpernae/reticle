// app/api/activity/route.ts — the Activity log's HTTP adapter.
//
// GET            → { runs, running } — every run, newest first
// GET ?summary=  → { running, recent, active } — the cheap poll for the badge
// GET ?id=<id>   → one run with its full input + output
// POST           → { action: 'cancel' | 'delete', id } | { action: 'clear' }
//
// Every run is a task (ADR-001): the Activity log is one list read from the
// tasks table, with the step log each task keeps in task_events.
import { NextResponse, connection } from 'next/server';
import { getStore } from '@/lib/db';
import { cancelTask, deleteTask, getTask } from '@/lib/application/tasks';
import { activityRuns, activitySummary, taskToRun } from '@/lib/application/activity';
import { route } from '@/lib/http/route';

const ACTIVE = ['running', 'queued', 'paused', 'waiting'];

const handler_GET = async (req: Request) => {
  await connection(); // request-time — SQLite reads are sync
  const params = new URL(req.url).searchParams;
  const id = params.get('id');

  if (params.get('summary')) { // cheap poll for the sidebar / top-bar badge
    return NextResponse.json(activitySummary(100));
  }

  if (id) {
    const t = getTask(id);
    if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ run: { ...taskToRun(t), input: t.input, output: unwrap(t.output) } });
  }

  const runs = activityRuns(300);
  return NextResponse.json({ runs, running: runs.filter(r => ACTIVE.includes(r.status)).length });
}

/** POST { action: 'cancel' | 'delete', id } | { action: 'clear' } (finished runs) */
const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({} as any));
  if (body?.action === 'clear') return NextResponse.json({ cleared: getStore().clearFinishedTasks() });
  const id = String(body?.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!getTask(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (body.action === 'cancel') return NextResponse.json({ ok: cancelTask(id) });
  if (body.action === 'delete') return NextResponse.json({ ok: deleteTask(id) });
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

/** A task's output is the use case's `{ status, body }` answer — the page wants the body. */
const unwrap = (out: unknown) => {
  const o = out as { status?: number; body?: any } | null;
  return o && typeof o === 'object' && 'body' in o ? o.body : out;
};

export const GET = route(handler_GET);
export const POST = route(handler_POST);
