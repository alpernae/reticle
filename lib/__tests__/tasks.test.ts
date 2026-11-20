// lib/__tests__/tasks.test.ts — the durable task system (ADR-001).
//
// The worker is driven directly (runUntilIdle) instead of by its timer, so the
// suite stays fast and deterministic. Test-only task kinds are registered for
// the duration of the test.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db: typeof import('../db');
let tasks: typeof import('../application/tasks');
let handlers: typeof import('../application/task-handlers');
let worker: typeof import('../runtime/worker');

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-tasks-'));
  db = await import('../db');
  tasks = await import('../application/tasks');
  handlers = await import('../application/task-handlers');
  worker = await import('../runtime/worker');
});

afterAll(() => {
  worker.WORKER_CONFIG.heartbeatMs = 5_000;
});

beforeEach(() => {
  // fast heartbeats so a cancel is noticed within milliseconds
  worker.WORKER_CONFIG.heartbeatMs = 20;
  for (const t of db.getStore().listTaskRows({ limit: 500 })) db.getStore().deleteTaskRow(t.id);
});

describe('task queue', () => {
  it('enqueues a task and records its first event', () => {
    const task = tasks.enqueueTask({ kind: 'demo', input: { hello: 'world' }, title: 'Demo task' });

    expect(task.id).toMatch(/^t/);
    expect(task.status).toBe('queued');
    expect(task.input).toEqual({ hello: 'world' });
    expect(task.attempts).toBe(0);

    const row = db.getStore().getTaskRow(task.id);
    expect(row?.kind).toBe('demo');
    expect(row?.status).toBe('queued');
    expect(tasks.getTaskEvents(task.id).length).toBeGreaterThan(0);
  });

  it('runs a queued task and finishes it with its output', async () => {
    handlers.registerHandler('demo', {
      limit: 2,
      async run(ctx) {
        ctx.step('doing the thing');
        ctx.via({ providerID: 'claude-cli', id: 'test-model' });
        return { status: 'done', output: { echoed: ctx.input.value } };
      },
    });

    const task = tasks.enqueueTask({ kind: 'demo', input: { value: 42 } });
    await worker.runUntilIdle();

    const done = tasks.getTask(task.id)!;
    expect(done.status).toBe('done');
    expect(done.output).toEqual({ echoed: 42 });
    expect(done.finished).toBeTruthy();
    expect(done.provider).toBe('claude-cli');
    expect(tasks.getTaskEvents(task.id).map(e => e.label)).toContain('doing the thing');
    handlers.unregisterHandler('demo');
  });

  it('retries a failed task while it has attempts left, then gives up', async () => {
    let runs = 0;
    handlers.registerHandler('flaky', {
      limit: 1,
      async run() {
        runs++;
        throw new Error('boom');
      },
    });

    const task = tasks.enqueueTask({ kind: 'flaky', maxAttempts: 2 });
    await worker.runUntilIdle();
    // first failure → queued again with a backoff (not due yet)
    expect(tasks.getTask(task.id)!.status).toBe('queued');
    expect(tasks.getTask(task.id)!.error).toContain('boom');

    // make it due again and let the second attempt run
    db.getStore().patchTaskRow(task.id, { runAfter: Date.now() - 1 });
    await worker.runUntilIdle();

    const failed = tasks.getTask(task.id)!;
    expect(runs).toBe(2);
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(2);
    handlers.unregisterHandler('flaky');
  });

  it('keeps a waiting task waiting and does not spend an attempt on the wake-up', async () => {
    let wakes = 0;
    handlers.registerHandler('waiter', {
      limit: 1,
      async run(ctx) {
        wakes++;
        ctx.saveCheckpoint({ wakes });
        if (wakes < 3) return { status: 'waiting', runAfter: Date.now() + 5 };
        return { status: 'done', output: { wakes } };
      },
    });

    const task = tasks.enqueueTask({ kind: 'waiter', maxAttempts: 1 });
    await worker.runUntilIdle();
    expect(tasks.getTask(task.id)!.status).toBe('waiting');
    expect(tasks.getTask(task.id)!.attempts).toBe(1); // the first run counts

    // wake it up twice more
    for (let i = 0; i < 2; i++) {
      db.getStore().patchTaskRow(task.id, { runAfter: Date.now() - 1 });
      await worker.runUntilIdle();
    }

    const done = tasks.getTask(task.id)!;
    expect(done.status).toBe('done');
    expect(done.attempts).toBe(1); // wake-ups are free
    expect(done.output).toEqual({ wakes: 3 });
    handlers.unregisterHandler('waiter');
  });

  it('cancels a running task through the heartbeat', async () => {
    handlers.registerHandler('slow', {
      limit: 1,
      async run(ctx) {
        await new Promise<void>(resolve => {
          const t = setInterval(() => {
            if (ctx.signal.aborted) { clearInterval(t); resolve(); }
          }, 10);
        });
        if (ctx.signal.aborted) throw new Error('aborted');
        return { status: 'done' };
      },
    });

    const task = tasks.enqueueTask({ kind: 'slow' });
    await worker.runUntilIdle(50); // let the worker claim it and start
    expect(tasks.getTask(task.id)!.status).toBe('running');

    expect(tasks.cancelTask(task.id)).toBe(true);
    await worker.runUntilIdle();

    const cancelled = tasks.getTask(task.id)!;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toContain('cancelled');
    handlers.unregisterHandler('slow');
  });

  it('pauses a task and resumes it with its checkpoint intact', async () => {
    handlers.registerHandler('pausable', {
      limit: 1,
      async run(ctx) {
        ctx.saveCheckpoint({ halfway: true });
        await new Promise<void>(resolve => {
          const t = setInterval(() => { if (ctx.signal.aborted) { clearInterval(t); resolve(); } }, 10);
        });
        return { status: 'done' };
      },
    });

    const task = tasks.enqueueTask({ kind: 'pausable' });
    await worker.runUntilIdle(50);
    expect(tasks.getTask(task.id)!.status).toBe('running');

    expect(tasks.pauseTask(task.id)).toBe(true);
    await worker.runUntilIdle();
    expect(tasks.getTask(task.id)!.status).toBe('paused');
    expect(tasks.getTask(task.id)!.checkpoint).toEqual({ halfway: true });

    expect(tasks.resumeTask(task.id)).toBe(true);
    expect(tasks.getTask(task.id)!.status).toBe('queued');
    handlers.unregisterHandler('pausable');
  });

  it('recovers a task whose owner is gone and runs it again', async () => {
    let runs = 0;
    handlers.registerHandler('recoverable', {
      limit: 1,
      async run() { runs++; return { status: 'done', output: { runs } }; },
    });

    // a task left 'running' by a process that died
    const task = tasks.enqueueTask({ kind: 'recoverable' });
    db.getStore().patchTaskRow(task.id, { status: 'running', started: Date.now() - 60_000, leaseUntil: Date.now() - 1 });

    expect(worker.recoverTasks(Date.now())).toBe(1);
    expect(tasks.getTask(task.id)!.status).toBe('queued');

    await worker.runUntilIdle();
    expect(tasks.getTask(task.id)!.status).toBe('done');
    expect(runs).toBe(1);
    handlers.unregisterHandler('recoverable');
  });

  it('waits for a task to settle and returns it', async () => {
    handlers.registerHandler('quick', {
      limit: 1,
      async run() { return { status: 'done', output: { ok: true } }; },
    });
    const task = tasks.enqueueTask({ kind: 'quick' });
    const waiter = tasks.waitForTask(task.id, 5_000);
    await worker.runUntilIdle();
    const settled = await waiter;
    expect(settled?.status).toBe('done');
    handlers.unregisterHandler('quick');
  });

  it('deletes a task and its events together', () => {
    const task = tasks.enqueueTask({ kind: 'demo' });
    expect(tasks.getTaskEvents(task.id).length).toBeGreaterThan(0);
    expect(tasks.deleteTask(task.id)).toBe(true);
    expect(tasks.getTask(task.id)).toBeNull();
    expect(db.getStore().listTaskEventRows(task.id)).toHaveLength(0);
  });
});
