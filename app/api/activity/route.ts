import { NextResponse, connection } from 'next/server';
import { getStore } from '@/lib/db';
import { cancelRun, isLive } from '@/lib/activity';
import { jobsList, jobAction, deleteJob } from '@/lib/jobs';

/**
 * GET            → { runs, running } — every AI run (Generate, Toolkit, Formats, brief,
 *                  categorizer) merged with Workflow jobs, newest first
 * GET ?id=<id>   → one run with its full input + output
 */
export async function GET(req: Request) {
  await connection(); // request-time — SQLite reads are sync
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  const store = getStore();
  if (params.get('summary')) { // cheap poll for the sidebar / top-bar badge
    const runs = store.listRuns(50);
    const running = runs.filter(r => r.status === 'running').length
      + jobsList().filter(j => ['queued', 'running', 'paused'].includes(j.status)).length;
    // runs that finished in the last 2 minutes — the shell toasts the ones it saw start
    const recent = runs.filter(r => r.finished && Date.now() - r.finished < 120_000).map(r => ({ id: r.id, kind: r.kind, page: r.page, title: r.title, status: r.status, error: r.error, ms: r.ms }));
    return NextResponse.json({ running, recent, active: runs.filter(r => r.status === 'running').map(r => r.id) });
  }
  if (id) {
    if (id.startsWith('job')) {
      const j = jobsList().find(x => x.id === id);
      if (!j) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json({ run: jobToRun(j), job: j });
    }
    const r = store.getRun(id);
    if (!r) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ run: { ...rowOut(r), input: safe(r.input), output: safe(r.output) } });
  }
  const runs = [...store.listRuns(300).map(rowOut), ...jobsList().map(jobToRun)].sort((a, b) => b.created - a.created);
  return NextResponse.json({ runs, running: runs.filter(r => r.status === 'running' || r.status === 'paused' || r.status === 'queued').length });
}

/** POST { action: 'cancel' | 'delete', id } | { action: 'clear' } (finished runs) */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const id = String(body?.id || '');
  const store = getStore();
  if (body?.action === 'clear') return NextResponse.json({ cleared: store.clearFinishedRuns() });
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (id.startsWith('job')) { // Workflow jobs keep their own controls
    if (body.action === 'cancel') return NextResponse.json(jobAction(id, 'stop'));
    if (body.action === 'delete') return NextResponse.json(deleteJob(id));
  }
  if (body.action === 'cancel') return NextResponse.json({ ok: cancelRun(id) });
  if (body.action === 'delete') { if (isLive(id)) cancelRun(id); store.delRun(id); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

const safe = (s: string) => { try { return JSON.parse(s || 'null'); } catch { return s; } };
type Out = { id: string; kind: string; title: string; page: string; platform: string; status: string; steps: { label: string; at: number; state: string }[]; provider: string; model: string; error: string; created: number; finished: number | null; ms: number | null };
function rowOut(r: { id: string; kind: string; title: string; page: string; platform: string; status: string; steps: string; provider: string; model: string; error: string; created: number; finished: number | null; ms: number | null }): Out {
  return { ...r, steps: Array.isArray(safe(r.steps)) ? safe(r.steps) : [] };
}
function jobToRun(j: ReturnType<typeof jobsList>[number]): Out & { result?: string } {
  const [provider, model] = (j.model || '').split('|');
  return {
    id: j.id, kind: 'workflow', title: `Workflow · ${j.kind}${j.topic ? ` — ${j.topic}` : ''}`, page: '/workflows', platform: j.platform,
    status: j.status === 'done' ? 'done' : j.status, provider: provider || '', model: model || '', error: j.err || '',
    steps: j.steps.map(s => ({ label: s.label + (s.note ? ` — ${s.note}` : ''), at: j.started || j.created, state: s.state === 'pending' ? 'pending' : s.state })),
    created: j.created, finished: j.finished, ms: j.finished && j.started ? j.finished - j.started : null,
  };
}
