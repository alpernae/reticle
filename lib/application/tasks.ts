// lib/application/tasks.ts — the durable task service.
//
// One table (`tasks`) records every long-running piece of work (ADR-001): AI
// generations, workflows, automations, collector runs. A task is queued, the
// worker claims it with a lease, runs its handler, and finishes it. Nothing
// lives only in memory any more: a task survives a server restart, can be
// cancelled from anywhere, and its step log is in `task_events`.
//
// This module is the service layer around that table — enqueue, control,
// read. The worker (lib/runtime/worker.ts) and the handlers
// (lib/application/task-handlers.ts) build on it.
import 'server-only';
import { getStore, type TaskRow, type TaskEventRow } from '../db';

export type TaskStatus = 'queued' | 'running' | 'paused' | 'waiting' | 'done' | 'failed' | 'cancelled';

export const TASK_STATUSES: TaskStatus[] = ['queued', 'running', 'paused', 'waiting', 'done', 'failed', 'cancelled'];
/** Statuses a task can no longer move on from (unless it is retried). */
export const TERMINAL_STATUSES: TaskStatus[] = ['done', 'failed', 'cancelled'];

export type Task = {
  id: string; kind: string; parentId: string | null; status: TaskStatus;
  input: unknown; output: unknown; error: string | null; checkpoint: unknown;
  provider: string; model: string; attempts: number; maxAttempts: number;
  runAfter: number; leaseUntil: number | null; cancelRequested: boolean;
  title: string; page: string; platform: string; trigger: string;
  created: number; started: number | null; finished: number | null;
};

export type TaskEvent = {
  taskId: string; seq: number; at: number; type: string;
  label: string | null; state: string | null; data: unknown;
};

export type EnqueueInput = {
  kind: string;
  input?: unknown;
  parentId?: string | null;
  title?: string;
  page?: string;
  platform?: string;
  trigger?: string;
  provider?: string;
  model?: { providerID: string; id: string } | null;
  maxAttempts?: number;
  runAfter?: number;
};

/** What a handler returns — the worker turns it into the task's next state.
 *  A failed task may still carry an output: the use case answered with a
 *  fallback (a template draft, a stats summary) and the caller still gets it. */
export type TaskResult =
  | { status: 'done'; output?: unknown }
  | { status: 'waiting'; runAfter: number; output?: unknown }
  | { status: 'failed'; error: string; output?: unknown; retry?: boolean };

/** What a handler gets: the task, a signal, and the tools to report progress. */
export type TaskCtx = {
  id: string;
  kind: string;
  input: any;
  attempt: number;
  checkpoint: any;
  signal: AbortSignal;
  /** Record a step ("Polling the collector") in the task's event log. */
  step: (label: string, state?: 'active' | 'done' | 'failed') => void;
  /** Record which provider/model answered. */
  via: (m: { providerID: string; id: string } | null | undefined) => void;
  /** Append a free-form note to the event log. */
  log: (text: string, data?: unknown) => void;
  /** Save progress so a restarted task can skip what it already did. */
  saveCheckpoint: (value: unknown) => void;
  /** Extend the lease right now (the worker heartbeats on its own). */
  heartbeat: () => void;
};

/** What a use case needs while it works: a signal, a step, and the provider
 *  that answered. A task context satisfies it — so a use case can be called
 *  from a task handler or from anywhere else that has the same three things. */
export type WorkCtx = {
  signal: AbortSignal;
  step: (label: string) => void;
  via: (m: { providerID: string; id: string } | null | undefined) => void;
};

const parseJson = <T,>(text: string | null | undefined, fallback: T): T => {
  if (text == null) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
};

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id, kind: r.kind, parentId: r.parentId, status: r.status as TaskStatus,
    input: parseJson<unknown>(r.input, {}), output: parseJson<unknown>(r.output, null),
    error: r.error, checkpoint: parseJson<unknown>(r.checkpoint, null),
    provider: r.provider, model: r.model, attempts: r.attempts, maxAttempts: r.maxAttempts,
    runAfter: r.runAfter, leaseUntil: r.leaseUntil, cancelRequested: !!r.cancelRequested,
    title: r.title, page: r.page, platform: r.platform, trigger: r.trigger,
    created: r.created, started: r.started, finished: r.finished,
  };
}

const rowToEvent = (r: TaskEventRow): TaskEvent => ({
  taskId: r.taskId, seq: r.seq, at: r.at, type: r.type,
  label: r.label, state: r.state, data: parseJson<unknown>(r.data, null),
});

// ---------------- ids ----------------
// Time-sortable: `t` + base36 time + base36 counter + base36 random. The
// counter makes ids unique inside one millisecond; the random tail keeps them
// unique across processes.
let idSeq = 0;
export function newTaskId(): string {
  idSeq = (idSeq + 1) % 1296;
  const t = Date.now().toString(36).padStart(9, '0');
  const s = idSeq.toString(36).padStart(2, '0');
  const r = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
  return `t${t}${s}${r}`;
}

// ---------------- events ----------------
/** Append one event to a task's log. Never throws — logging must not break work. */
export function recordTaskEvent(
  taskId: string,
  type: 'step' | 'via' | 'progress' | 'log',
  label?: string | null,
  state?: string | null,
  data?: unknown,
): void {
  try {
    const store = getStore();
    // a new step closes the previous one — the log shows one open step at a time
    if (type === 'step' && state === 'active') store.closeActiveTaskStep(taskId);
    store.addTaskEventRow({
      taskId,
      at: Date.now(),
      type,
      label: label == null ? null : String(label).slice(0, 300),
      state: state == null ? null : String(state).slice(0, 30),
      data: data === undefined ? null : JSON.stringify(data).slice(0, 20_000),
    });
  } catch { /* the log is a nicety — never fail work over it */ }
}

export function getTaskEvents(taskId: string): TaskEvent[] {
  return getStore().listTaskEventRows(taskId).map(rowToEvent);
}

// ---------------- queue ----------------
/** Put a task in the queue. The worker picks it up on its next tick. */
export function enqueueTask(spec: EnqueueInput): Task {
  const store = getStore();
  const now = Date.now();
  const row: TaskRow = {
    id: newTaskId(),
    kind: String(spec.kind || '').slice(0, 40),
    parentId: spec.parentId ? String(spec.parentId).slice(0, 60) : null,
    status: 'queued',
    input: JSON.stringify(spec.input ?? {}).slice(0, 100_000),
    output: null,
    error: null,
    checkpoint: null,
    provider: spec.provider || spec.model?.providerID || '',
    model: spec.model?.id || '',
    attempts: 0,
    maxAttempts: Math.max(1, Math.min(10, Math.round(Number(spec.maxAttempts) || 1))),
    runAfter: Math.max(now, Math.round(Number(spec.runAfter) || now)),
    leaseUntil: null,
    cancelRequested: 0,
    title: String(spec.title || spec.kind || 'task').slice(0, 160),
    page: String(spec.page || '').slice(0, 200),
    platform: String(spec.platform || '').slice(0, 20),
    trigger: String(spec.trigger || '').slice(0, 40),
    created: now,
    started: null,
    finished: null,
  };
  store.addTaskRow(row);
  recordTaskEvent(row.id, 'log', 'queued', 'active', { kind: row.kind });
  return rowToTask(row);
}

export function getTask(id: string): Task | null {
  const row = getStore().getTaskRow(String(id || ''));
  return row ? rowToTask(row) : null;
}

/** Rename a task once its handler knows more (e.g. "AI brief — 412 posts"). */
export function setTaskTitle(id: string, title: string): void {
  const t = String(title || '').slice(0, 160);
  if (t) getStore().patchTaskRow(id, { title: t });
}

export function listTasks(opts: { kind?: string; status?: string; limit?: number } = {}): Task[] {
  return getStore().listTaskRows(opts).map(rowToTask);
}

/** Ask the worker to stop. A queued task stops now; a running one is aborted
 *  by the next heartbeat and ends as 'cancelled'. */
export function cancelTask(id: string): boolean {
  const store = getStore();
  const row = store.getTaskRow(id);
  if (!row) return false;
  if (TERMINAL_STATUSES.includes(row.status as TaskStatus)) return false;
  const now = Date.now();
  if (row.status === 'running') {
    store.patchTaskRow(id, { cancelRequested: 1 });
    recordTaskEvent(id, 'log', 'cancel requested', 'active');
  } else {
    store.patchTaskRow(id, { status: 'cancelled', cancelRequested: 1, finished: now, leaseUntil: null });
    recordTaskEvent(id, 'log', 'cancelled', 'done');
  }
  return true;
}

/** Hold a task. A running task is stopped at its next heartbeat and stays
 *  'paused' with its checkpoint intact; `resumeTask` puts it back in the queue. */
export function pauseTask(id: string): boolean {
  const store = getStore();
  const row = store.getTaskRow(id);
  if (!row) return false;
  if (TERMINAL_STATUSES.includes(row.status as TaskStatus) || row.status === 'paused') return false;
  store.patchTaskRow(id, { status: 'paused' });
  recordTaskEvent(id, 'log', 'paused', 'active');
  return true;
}

export function resumeTask(id: string): boolean {
  const store = getStore();
  const row = store.getTaskRow(id);
  if (!row) return false;
  if (row.status !== 'paused') return false;
  store.patchTaskRow(id, { status: 'queued', runAfter: Date.now(), cancelRequested: 0, leaseUntil: null });
  recordTaskEvent(id, 'log', 'resumed', 'active');
  return true;
}

/** Run a finished task again from the start. */
export function retryTask(id: string): boolean {
  const store = getStore();
  const row = store.getTaskRow(id);
  if (!row) return false;
  if (!TERMINAL_STATUSES.includes(row.status as TaskStatus)) return false;
  store.patchTaskRow(id, {
    status: 'queued', attempts: 0, error: null, output: null, cancelRequested: 0,
    runAfter: Date.now(), leaseUntil: null, started: null, finished: null,
  });
  recordTaskEvent(id, 'log', 'queued again', 'active');
  return true;
}

export function deleteTask(id: string): boolean {
  const store = getStore();
  if (!store.getTaskRow(id)) return false;
  store.deleteTaskRow(id); // task_events go with it (ON DELETE CASCADE)
  return true;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Wait for a task to settle — the long-poll behind `GET /api/tasks/:id?wait=`.
 * Returns the task as soon as it reaches a terminal state (or is paused), or
 * the last known state when the timeout passes.
 */
export async function waitForTask(id: string, timeoutMs = 25_000, pollMs = 250): Promise<Task | null> {
  const deadline = Date.now() + Math.max(0, Math.min(120_000, timeoutMs));
  let last: Task | null = null;
  for (;;) {
    const t = getTask(id);
    if (!t) return last;
    last = t;
    if (TERMINAL_STATUSES.includes(t.status) || t.status === 'paused') return t;
    if (Date.now() >= deadline) return t;
    await sleep(pollMs);
  }
}
