// lib/runtime/worker.ts — the in-process task worker.
//
// The worker is the only thing that runs tasks. It claims a queued task with a
// lease (an atomic UPDATE … RETURNING), runs the handler for the task's kind,
// heartbeats the lease while the handler works, and writes the task's next
// state. A task whose lease expires — or that belonged to a server process
// that is gone — is recovered and run again on boot, so work survives a
// restart (ADR-001).
//
// The worker shares the event loop with the HTTP server; the expensive part of
// every task is waiting on I/O (an Apify call, an AI subprocess), so that is
// fine for a single-user local app.
import 'server-only';
import { getStore, type TaskRow } from '../db';
import { HANDLERS, type TaskHandler } from '../application/task-handlers';
import { recordTaskEvent, type TaskCtx } from '../application/tasks';

/** How long a claim owns a task before the worker must renew it. */
const LEASE_MS = 60_000;
/** How often the worker checks for cancellation and renews the lease. */
const HEARTBEAT_MS = 5_000;
/** How often the worker looks for work. */
const TICK_MS = 1_000;
/** How many tasks may run at the same time, across all kinds. */
const MAX_CONCURRENT = 4;
/** How many finished tasks to keep. */
const RETENTION = 1000;

/** Tunables — tests shrink the timers so a task finishes in milliseconds. */
export const WORKER_CONFIG = {
  leaseMs: LEASE_MS,
  heartbeatMs: HEARTBEAT_MS,
  tickMs: TICK_MS,
  maxConcurrent: MAX_CONCURRENT,
  retention: RETENTION,
};

type Running = { id: string; kind: string; resource: string; abort: AbortController; promise: Promise<void> };
type WorkerState = { bootAt: number; running: Map<string, Running>; timer: ReturnType<typeof setInterval> | null };

const g = globalThis as unknown as { __payloadWorker?: WorkerState };
const state = (): WorkerState => (g.__payloadWorker ||= { bootAt: Date.now(), running: new Map(), timer: null });

const parseJson = <T,>(text: string | null | undefined, fallback: T): T => {
  if (text == null) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
};

/** The kinds whose limiter has a free slot right now. */
function claimableKinds(): string[] {
  const used = new Map<string, number>();
  for (const r of state().running.values()) used.set(r.resource, (used.get(r.resource) || 0) + 1);
  const out: string[] = [];
  for (const [kind, h] of Object.entries(HANDLERS)) {
    const resource = h.resource || kind;
    const limit = h.limit ?? 2;
    if ((used.get(resource) || 0) < limit) out.push(kind);
  }
  return out;
}

function buildCtx(row: TaskRow, abort: AbortController): TaskCtx {
  const store = getStore();
  return {
    id: row.id,
    kind: row.kind,
    input: parseJson<any>(row.input, {}),
    attempt: row.attempts,
    checkpoint: parseJson<any>(row.checkpoint, null),
    signal: abort.signal,
    step: (label, state = 'active') => recordTaskEvent(row.id, 'step', label, state),
    via: m => {
      if (!m) return;
      store.patchTaskRow(row.id, { provider: m.providerID, model: m.id });
      recordTaskEvent(row.id, 'via', `${m.providerID} · ${m.id}`);
    },
    log: (text, data) => recordTaskEvent(row.id, 'log', text, null, data),
    saveCheckpoint: value => store.patchTaskRow(row.id, { checkpoint: JSON.stringify(value ?? null).slice(0, 100_000) }),
    heartbeat: () => store.extendTaskLease(row.id, Date.now() + WORKER_CONFIG.leaseMs),
  };
}

const log = (row: TaskRow, status: string, ms: number, extra = '') =>
  console.info(`[task] ${row.id} ${row.kind} ${status} ${ms}ms${extra ? ' · ' + extra : ''}`);

/** Write the task's next state, unless the user cancelled or paused it meanwhile. */
function settle(row: TaskRow, patch: { status: string; output?: unknown; error?: string | null; runAfter?: number }, ms: number) {
  const store = getStore();
  const current = store.getTaskRow(row.id);
  const cancelled = !!current?.cancelRequested;
  const paused = current?.status === 'paused';
  if (cancelled) {
    store.patchTaskRow(row.id, { status: 'cancelled', error: 'cancelled by user', finished: Date.now(), leaseUntil: null });
    recordTaskEvent(row.id, 'log', 'cancelled', 'done');
    log(row, 'cancelled', ms);
    return;
  }
  if (paused && patch.status !== 'paused') {
    store.patchTaskRow(row.id, { status: 'paused', leaseUntil: null });
    recordTaskEvent(row.id, 'log', 'paused', 'active');
    log(row, 'paused', ms);
    return;
  }
  store.patchTaskRow(row.id, {
    status: patch.status,
    output: patch.output === undefined ? undefined : JSON.stringify(patch.output).slice(0, 400_000),
    error: patch.error === undefined ? undefined : patch.error,
    runAfter: patch.runAfter,
    leaseUntil: null,
    finished: patch.status === 'done' || patch.status === 'failed' || patch.status === 'cancelled' ? Date.now() : null,
  });
  log(row, patch.status, ms);
}

/** A failed task is retried while it has attempts left; the wait grows each time. */
function failTask(row: TaskRow, message: string, ms: number, retry = true) {
  const store = getStore();
  const current = store.getTaskRow(row.id);
  const cancelled = !!current?.cancelRequested;
  const paused = current?.status === 'paused';
  if (cancelled) { settle(row, { status: 'cancelled' }, ms); return; }
  if (paused) { settle(row, { status: 'paused' }, ms); return; }
  const attempts = current?.attempts ?? row.attempts;
  const maxAttempts = current?.maxAttempts ?? row.maxAttempts;
  const canRetry = retry && attempts < maxAttempts;
  if (canRetry) {
    const wait = Math.min(120_000, 5_000 * 2 ** Math.max(0, attempts - 1));
    store.patchTaskRow(row.id, { status: 'queued', error: message.slice(0, 1000), runAfter: Date.now() + wait, leaseUntil: null });
    recordTaskEvent(row.id, 'log', `failed — retrying in ${Math.round(wait / 1000)}s`, 'active', { error: message.slice(0, 300) });
    log(row, 'retry', ms, message.slice(0, 120));
    return;
  }
  store.patchTaskRow(row.id, { status: 'failed', error: message.slice(0, 1000), finished: Date.now(), leaseUntil: null });
  recordTaskEvent(row.id, 'log', message.slice(0, 300), 'failed');
  log(row, 'failed', ms, message.slice(0, 120));
}

async function execute(row: TaskRow, handler: TaskHandler, abort: AbortController) {
  const store = getStore();
  const started = Date.now();
  const ctx = buildCtx(row, abort);

  // The heartbeat renews the lease and watches for cancel / pause requests.
  const heartbeat = setInterval(() => {
    try {
      const t = store.getTaskRow(row.id);
      if (!t) return;
      if (t.cancelRequested || t.status === 'paused') { abort.abort(); return; }
      store.extendTaskLease(row.id, Date.now() + WORKER_CONFIG.leaseMs);
    } catch { /* the DB is busy — the next heartbeat tries again */ }
  }, WORKER_CONFIG.heartbeatMs);

  try {
    const result = await handler.run(ctx);
    const ms = Date.now() - started;
    if (result.status === 'done') settle(row, { status: 'done', output: result.output ?? null }, ms);
    else if (result.status === 'waiting') settle(row, { status: 'waiting', runAfter: result.runAfter, output: result.output ?? null }, ms);
    else failTask(row, result.error || 'task failed', ms, result.retry !== false);
  } catch (e: any) {
    const ms = Date.now() - started;
    const msg = String(e?.message || e).slice(0, 1000);
    if (abort.signal.aborted) {
      // cancelled or paused — settle() decides which
      settle(row, { status: 'failed', error: msg }, ms);
      const current = store.getTaskRow(row.id);
      if (current && current.status === 'cancelled') store.patchTaskRow(row.id, { error: 'cancelled by user', finished: Date.now() });
      return;
    }
    failTask(row, msg, ms);
  } finally {
    clearInterval(heartbeat);
  }
}

let ticking = false;
async function tick() {
  if (ticking) return; // a slow claim must not stack up
  ticking = true;
  try {
    const store = getStore();
    while (state().running.size < WORKER_CONFIG.maxConcurrent) {
      const kinds = claimableKinds();
      if (!kinds.length) break;
      const row = store.claimNextTaskRow(Date.now(), WORKER_CONFIG.leaseMs, kinds);
      if (!row) break;
      const handler = HANDLERS[row.kind];
      if (!handler) {
        store.patchTaskRow(row.id, { status: 'failed', error: `no handler for kind "${row.kind}"`, finished: Date.now(), leaseUntil: null });
        continue;
      }
      const abort = new AbortController();
      const rec: Running = { id: row.id, kind: row.kind, resource: handler.resource || row.kind, abort, promise: Promise.resolve() };
      state().running.set(row.id, rec);
      rec.promise = execute(row, handler, abort).finally(() => { state().running.delete(row.id); });
    }
  } catch (e: any) {
    console.warn('[task] worker tick failed:', String(e?.message || e).slice(0, 200));
  } finally {
    ticking = false;
  }
}

/** Recover work whose owner is gone (called on boot, and by the tests). */
export function recoverTasks(bootAt = Date.now()): number {
  try {
    const recovered = getStore().recoverStaleTasks(Date.now(), bootAt);
    if (recovered) console.info(`[task] recovered ${recovered} task(s) from the previous run`);
    return recovered;
  } catch (e: any) {
    console.warn('[task] recovery failed:', String(e?.message || e).slice(0, 200));
    return 0;
  }
}

/**
 * Claim whatever is ready and wait until those tasks finish. The worker uses
 * this in tests (and it is handy for a "run now" button).
 */
export async function runUntilIdle(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await tick();
    const running = [...state().running.values()];
    if (!running.length) return;
    await Promise.race([
      Promise.allSettled(running.map(r => r.promise)),
      new Promise(r => setTimeout(r, 25)),
    ]);
    if (Date.now() > deadline) return;
  }
}

/**
 * Start the worker. Called once per server process from lib/startup.ts;
 * a dev hot reload finds the worker already running and leaves it alone.
 */
export function startWorker() {
  const st = state();
  if (st.timer) return; // already running in this process
  st.bootAt = Date.now();

  // Recover work whose owner is gone: an expired lease, or a task that was
  // running when this process started (the old process is definitively dead).
  recoverTasks(st.bootAt);

  let ticks = 0;
  st.timer = setInterval(() => {
    void tick();
    // keep the queue tidy: the newest RETENTION finished tasks survive
    if (++ticks % 60 === 0) {
      try { getStore().pruneFinishedTasks(WORKER_CONFIG.retention); } catch { /* next minute */ }
    }
  }, WORKER_CONFIG.tickMs);
  void tick();
}

/** Stop the worker (tests, shutdown). */
export function stopWorker() {
  const st = state();
  if (st.timer) clearInterval(st.timer);
  st.timer = null;
  for (const r of st.running.values()) r.abort.abort();
  st.running.clear();
}

/** A snapshot for the health endpoint / tests. */
export function workerStatus() {
  const st = state();
  return {
    running: st.running.size,
    bootAt: st.bootAt,
    tasks: [...st.running.values()].map(r => ({ id: r.id, kind: r.kind, resource: r.resource })),
  };
}
