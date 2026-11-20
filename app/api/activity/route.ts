// app/api/activity/route.ts — the Activity log's HTTP adapter.
//
// GET            → { runs, running } — every run, newest first
// GET ?summary=  → { running, recent, active } — the cheap poll for the badge
// GET ?id=<id>   → one run with its full input + output
// POST           → { action: 'cancel' | 'delete', id } | { action: 'clear' }
//
// Most runs are tasks (ADR-001). Generate and Toolkit still write an ai_runs
// row through tracked() until the final unification, so they are read from
// there; everything else comes from the tasks table.
import { NextResponse, connection } from 'next/server';
import { getStore } from '@/lib/db';
import { cancelRun, isLive } from '@/lib/activity';
import { jobAction, deleteJob } from '@/lib/jobs';
import { cancelTask, deleteTask, getTask } from '@/lib/application/tasks';
import { activityRuns, taskToRun, type ActivityRun } from '@/lib/application/activity';
import { route } from '@/lib/http/route';

/** The kinds that still live in ai_runs (they call tracked() under the hood). */
const TRACKED_KINDS = new Set(['generate', 'tool']);

const handler_GET = async (req: Request) => {
  await connection(); // request-time — SQLite reads are sync
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  const store = getStore();

  if (params.get('summary')) { // cheap poll for the sidebar / top-bar badge
    const runs = legacyRuns(100);
    const tasks = activityRuns(100).filter(r => !TRACKED_KINDS.has(r.kind));
    const all = [...runs, ...tasks];
    const running = all.filter(r => ['running', 'queued', 'paused', 'waiting'].includes(r.status)).length;
    // runs that finished in the last 2 minutes — the shell toasts the ones it saw start
    const recent = all.filter(r => r.finished && Date.now() - r.finished < 120_000)
      .map(r => ({ id: r.id, kind: r.kind, page: r.page, title: r.title, status: r.status, error: r.error, ms: r.ms }));
    return NextResponse.json({ running, recent, active: all.filter(r => r.status === 'running').map(r => r.id) });
  }

  if (id) {
    const t = getTask(id);
    if (t && !TRACKED_KINDS.has(t.kind)) {
      return NextResponse.json({ run: { ...taskToRun(t), input: t.input, output: unwrap(t.output) } });
    }
    const r = store.getRun(id);
    if (r) return NextResponse.json({ run: { ...rowOut(r), input: safe(r.input), output: safe(r.output) } });
    if (t) return NextResponse.json({ run: { ...taskToRun(t), input: t.input, output: unwrap(t.output) } });
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const runs = [...legacyRuns(300), ...activityRuns(300).filter(r => !TRACKED_KINDS.has(r.kind))]
    .sort((a, b) => b.created - a.created);
  return NextResponse.json({
    runs,
    running: runs.filter(r => ['running', 'queued', 'paused', 'waiting'].includes(r.status)).length,
  });
}

/** POST { action: 'cancel' | 'delete', id } | { action: 'clear' } (finished runs) */
const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({} as any));
  const id = String(body?.id || '');
  const store = getStore();
  if (body?.action === 'clear') {
    const cleared = store.clearFinishedRuns() + store.clearFinishedTasks();
    return NextResponse.json({ cleared });
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const t = getTask(id);
  if (t && !TRACKED_KINDS.has(t.kind)) {
    if (body.action === 'cancel') return NextResponse.json({ ok: cancelTask(id) });
    if (body.action === 'delete') return NextResponse.json({ ok: deleteTask(id) });
    if (body.action === 'stop') return NextResponse.json(jobAction(id, 'stop'));
  }
  if (body.action === 'cancel') return NextResponse.json({ ok: cancelRun(id) });
  if (body.action === 'delete') { if (isLive(id)) cancelRun(id); store.delRun(id); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

const safe = (s: string) => { try { return JSON.parse(s || 'null'); } catch { return s; } };
/** A task's output is the use case's `{ status, body }` answer — the page wants the body. */
const unwrap = (out: unknown) => {
  const o = out as { status?: number; body?: any } | null;
  return o && typeof o === 'object' && 'body' in o ? o.body : out;
};
type LegacyRow = {
  id: string; kind: string; title: string; page: string; platform: string; status: string; steps: string;
  provider: string; model: string; error: string; created: number; finished: number | null; ms: number | null;
};
function rowOut(r: LegacyRow): ActivityRun {
  return { ...r, steps: Array.isArray(safe(r.steps)) ? safe(r.steps) : [] };
}
function legacyRuns(limit: number): ActivityRun[] {
  return getStore().listRuns(limit).map(rowOut);
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
