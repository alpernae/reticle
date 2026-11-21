// lib/application/task-handlers.ts — what a task actually does.
//
// A handler gets the task (input + checkpoint), an AbortSignal and a small
// reporting API (step / via / log / saveCheckpoint), and returns the task's
// next state. The worker (lib/runtime/worker.ts) claims, leases, heartbeats
// and finishes the task around it.
//
// The first ported kinds are `collect` and `ingest` (ADR-001 action item 4):
// a collect task starts an Apify run and re-schedules itself until the run
// finishes, then queues the ingest task that imports the dataset. That chain
// is what fixes F1 — scheduled collection now progresses with the Sources page
// closed.
import 'server-only';
import { apifyStart, apifyPollStatus, apifyIngest, type ApifyPlatform } from '../apify';
import { enqueueTask, recordTaskEvent, type TaskCtx, type TaskResult } from './tasks';

export type TaskHandler = {
  /** Limiter key — tasks that share a resource never run past its limit. */
  resource?: string;
  /** How many tasks of this kind may run at once (per resource). */
  limit?: number;
  run: (ctx: TaskCtx) => Promise<TaskResult>;
};

/** How long a collect task waits before it polls Apify again. */
const COLLECT_POLL_MS = 15_000;
const TERMINAL_FAIL = new Set(['FAILED', 'ABORTED', 'ABORTING', 'TIMED-OUT']);

const PLAT_LABEL: Record<string, string> = {
  x: 'X / Twitter', linkedin: 'LinkedIn', instagram: 'Instagram',
  threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube',
};

/**
 * `collect` — start (or resume) an Apify collector for one platform.
 * The Apify run id lives in the task's checkpoint, so a restart continues the
 * same run instead of paying for a second one.
 */
const collect: TaskHandler = {
  resource: 'apify',
  limit: 2,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const input = ctx.input || {};
    const platform = String(input.platform || 'x');
    const sources = input.sources ? String(input.sources) : undefined;

    let runId = String(ctx.checkpoint?.runId || '');
    if (!runId) {
      ctx.step(`Starting the ${PLAT_LABEL[platform] || platform} collector`);
      const run = await apifyStart(platform as ApifyPlatform, sources);
      runId = run.id;
      ctx.saveCheckpoint({ runId, startedAt: Date.now() });
      ctx.log(`Apify run ${runId} started`);
    } else {
      ctx.step('Checking the collector run');
    }

    const { status } = await apifyPollStatus(runId);
    if (status === 'SUCCEEDED') {
      ctx.step('Queueing the import');
      const ingest = enqueueTask({
        kind: 'ingest',
        parentId: ctx.id,
        input: { runId, platform },
        title: `Import ${PLAT_LABEL[platform] || platform} posts`,
        page: '/sources',
        platform,
        trigger: 'collect',
      });
      ctx.log(`import queued (${ingest.id})`);
      return { status: 'done', output: { runId, ingestId: ingest.id, status } };
    }
    if (TERMINAL_FAIL.has(status)) {
      return { status: 'failed', error: `the Apify run ended as ${status}` };
    }
    // still running — come back later (the attempt counter is not spent on a wake-up)
    return { status: 'waiting', runAfter: Date.now() + COLLECT_POLL_MS, output: { runId, status } };
  },
};

/**
 * `ingest` — download a finished run's dataset and import it into the posts
 * table. The import itself is one transaction (lib/normalize.ts), so a crash
 * never leaves half a dataset behind.
 */
const ingest: TaskHandler = {
  resource: 'apify-import',
  limit: 1,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const runId = String(ctx.input?.runId || '');
    if (!runId) return { status: 'failed', error: 'ingest needs a runId' };
    ctx.step('Downloading the dataset');
    const out = await apifyIngest(runId);
    if (!out) {
      ctx.log('already imported — nothing to do');
      return { status: 'done', output: { runId, skipped: true } };
    }
    ctx.step(`Imported ${out.result.added} new posts (${out.result.updated} refreshed)`);
    if (out.note) ctx.log(out.note);
    // the analytics are stale now — rebuild them in a task (debounced)
    if (out.result.added || out.result.updated) {
      try { (await import('./analytics')).scheduleRebuild(); } catch { /* the worker catches up on the next boot */ }
    }
    return { status: 'done', output: { runId, items: out.items, ...out.result, ...(out.note ? { note: out.note } : {}) } };
  },
};

/**
 * `generate` — the "3 grounded drafts" use case (lib/application/drafts.ts).
 * The AI call runs in the worker, so the result belongs to the task even if
 * the page that asked for it is closed.
 */
const generate: TaskHandler = {
  resource: 'ai',
  limit: 2,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const { generateDrafts } = await import('./drafts');
    const { setTaskTitle } = await import('./tasks');
    ctx.step('Building the prompt from your winners');
    const res = await generateDrafts(ctx.input || {}, ctx);
    if (res.title) setTaskTitle(ctx.id, res.title);
    if (res.failure) return { status: 'failed', error: res.failure, output: res };
    if (res.status !== 200) return { status: 'failed', error: String((res.body as any)?.error || `generate failed (${res.status})`), output: res };
    return { status: 'done', output: res };
  },
};

/**
 * `tool` — one Toolkit tool (lib/application/tools.ts).
 */
const tool: TaskHandler = {
  resource: 'ai',
  limit: 2,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const { runTool } = await import('./tools');
    const { setTaskTitle } = await import('./tasks');
    ctx.step('Asking the AI');
    const res = await runTool(ctx.input || {}, ctx);
    if (res.title) setTaskTitle(ctx.id, res.title);
    if (res.failure) return { status: 'failed', error: res.failure, output: res };
    if (res.status !== 200) return { status: 'failed', error: String((res.body as any)?.error || `tool failed (${res.status})`), output: res };
    return { status: 'done', output: res };
  },
};

/**
 * `workflow` — a Studio agent (lib/application/workflows.ts): a chain of AI
 * steps. Every finished step is written to the task's checkpoint, so an
 * interrupted workflow continues where it stopped instead of paying for the
 * same AI calls twice.
 */
const workflow: TaskHandler = {
  resource: 'workflow',
  limit: 2,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const { AGENTS, buildAgentCtx, runAgentSteps } = await import('./workflows');
    const input = ctx.input || {};
    const def = AGENTS.find(a => a.kind === input.kind);
    if (!def) return { status: 'failed', error: `unknown agent "${String(input.kind || '')}"` };

    const cp = (ctx.checkpoint || {}) as { notes?: string[]; meta?: { ms: number; chars: number }[] };
    const done = Array.isArray(cp.notes) ? cp.notes : [];
    const meta = Array.isArray(cp.meta) ? [...cp.meta] : [];
    const notes = [...done];
    const agentCtx = await buildAgentCtx(
      def.kind,
      String(input.topic || ''),
      String(input.platform || 'x'),
      input.model?.providerID && input.model?.id ? input.model : null,
    );

    const out = await runAgentSteps(
      def,
      agentCtx,
      ctx.signal,
      done,
      (_i, label) => ctx.step(label),
      (i, _label, text, ms) => {
        meta[i] = { ms, chars: text.length };
        notes.push(text);
        ctx.saveCheckpoint({ notes: [...notes], meta });
      },
    );
    return { status: 'done', output: out };
  },
};

/**
 * `automation` — an automation's chain (lib/application/automation-chain.ts).
 * Each step calls one worker; the chain's output and steps are the task's
 * output, and the automation's history is updated when it finishes.
 */
const automation: TaskHandler = {
  resource: 'automation',
  limit: 2,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const { listAutomations, recordAutomationRun } = await import('../automations');
    const { runAutomationChain } = await import('./automation-chain');
    const input = ctx.input || {};
    const a = listAutomations().find(x => x.id === input.automationId);
    if (!a) return { status: 'failed', error: 'the automation no longer exists' };
    const started = Date.now();
    try {
      const out = await runAutomationChain(a, input.trigger === 'schedule' ? 'schedule' : 'manual', {
        step: label => ctx.step(label),
        via: m => ctx.via(m),
        signal: ctx.signal,
      });
      recordAutomationRun(a.id, ctx.id, 'done', Date.now() - started);
      return { status: 'done', output: out };
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      recordAutomationRun(a.id, ctx.id, /cancel/i.test(msg) ? 'cancelled' : 'failed', Date.now() - started, msg);
      throw e;
    }
  },
};

/**
 * The AI use cases that are plain request/answer work: Formats (quick posts,
 * series polish), the Overview brief, the categorizer, Ask, the mind-map
 * expander and the draft polisher. Each one is a use case in
 * lib/application/*; the task wraps it so the work is durable.
 *
 * A use case that answers with a fallback (a template draft, a stats summary)
 * still returns its body — but marks the task as failed, so the Activity log
 * shows what really happened.
 */
const useCase = (load: () => Promise<(input: any, ctx: any) => Promise<any>>): TaskHandler => ({
  resource: 'ai',
  limit: 2,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const fn = await load();
    const res = await fn(ctx.input || {}, ctx);
    if (res?.failure) return { status: 'failed', error: res.failure, output: res };
    return { status: 'done', output: res };
  },
});

const formatQuick = useCase(async () => (await import('./formats')).quickPosts);
const formatPolish = useCase(async () => (await import('./formats')).polishSeries);
const categorize = useCase(async () => (await import('./categorize')).categorizeBatchTask);
const ask = useCase(async () => (await import('./ask')).askReticle);
const mindmap = useCase(async () => (await import('./mindmaps')).expandMindMap);
const refine = useCase(async () => (await import('./polish')).polishDraft);

/** `brief` — the Overview growth brief. The title learns the post count. */
const brief: TaskHandler = {
  resource: 'ai',
  limit: 2,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const { growthBrief } = await import('./brief');
    const { setTaskTitle } = await import('./tasks');
    const res = await growthBrief(ctx.input || {}, ctx);
    const posts = (res.body as any)?.posts;
    if (typeof posts === 'number') setTaskTitle(ctx.id, `AI growth brief — ${posts} posts`);
    if (res?.failure) return { status: 'failed', error: res.failure, output: res };
    return { status: 'done', output: res };
  },
};

/**
 * `analytics` — rebuild the analytics read model (ADR-004).
 *
 * The derived post columns, the baselines and the snapshot are computed here,
 * in a task — never on a request path. Writes bump the data version and queue
 * this task (debounced), so several imports in a row cause one rebuild.
 */
const analytics: TaskHandler = {
  resource: 'analytics',
  limit: 1,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const { rebuild } = await import('./analytics');
    ctx.step('Recomputing the analytics');
    const out = rebuild();
    ctx.step(`Analyzed ${out.posts} posts`);
    return { status: 'done', output: out };
  },
};

/**
 * `backup` — write a consistent copy of the database.
 *
 * `VACUUM INTO` produces one clean file (no WAL sidecar) while the app keeps
 * running. After a nightly run the task goes back to 'waiting' with the next
 * 03:00, so there is one recurring backup row; a manual run just finishes.
 */
const backup: TaskHandler = {
  resource: 'backup',
  limit: 1,
  async run(ctx: TaskCtx): Promise<TaskResult> {
    const { runBackup } = await import('../backup');
    const { nextBackupAt } = await import('./backup');
    ctx.step('Writing the database backup');
    const out = runBackup();
    ctx.step(`Wrote ${out.name} (${Math.round(out.bytes / 1024)} KB)`);
    if (out.pruned.length) ctx.log(`Removed ${out.pruned.length} old backup(s)`, { pruned: out.pruned });
    const manual = !!ctx.input?.manual;
    if (manual) return { status: 'done', output: out };
    const nextAt = nextBackupAt(Date.now());
    ctx.log(`Next backup ${new Date(nextAt).toLocaleString('en-US')}`);
    return { status: 'waiting', runAfter: nextAt, output: out };
  },
};

/** Every task kind the worker knows how to run. */
export const HANDLERS: Record<string, TaskHandler> = {
  collect, ingest, generate, tool, workflow, automation, analytics, backup,
  'format-quick': formatQuick,
  'format-polish': formatPolish,
  brief,
  categorize,
  ask,
  mindmap,
  refine,
};

/** Register (or replace) a task kind — new kinds plug in here. */
export function registerHandler(kind: string, handler: TaskHandler) {
  HANDLERS[kind] = handler;
}

/** Remove a task kind (the tests use it to clean up). */
export function unregisterHandler(kind: string) {
  delete HANDLERS[kind];
}

/** The kinds that may be claimed right now (used by the worker's limiter). */
export function handlerKinds(): string[] {
  return Object.keys(HANDLERS);
}

export { recordTaskEvent };
