// lib/activity.ts — the Activity log: every AI generation the user starts
// (Generate, Toolkit, Formats, Overview brief, categorizer) is recorded as a
// run with live steps, provider/model, duration and its full result.
//
// Runs are executed by the server request that started them and their result
// is SAVED here — so the user can leave the page (go design a thumbnail while
// a draft is generating) and pick the result up later on the Activity page.
// Running runs can be cancelled (their AbortController aborts the AI call).
import 'server-only';
import { getStore } from './db';

export type RunKind = 'generate' | 'tool' | 'format-quick' | 'format-polish' | 'brief' | 'categorize' | 'refine' | 'automation' | 'mindmap' | 'ask';
export type RunStep = { label: string; at: number; state: 'active' | 'done' | 'failed' };

type Live = { abort: AbortController; steps: RunStep[] };
const g = globalThis as unknown as { __payloadRuns?: Map<string, Live>; __payloadRunsChecked?: boolean };
const live = () => (g.__payloadRuns ||= new Map());

export type RunCtx = {
  id: string;
  signal: AbortSignal;
  /** Mark the previous step done and start a new one (shown live on Activity). */
  step: (label: string) => void;
  /** Record which provider/model actually answered. */
  via: (m: { providerID: string; id: string } | null | undefined) => void;
};

export class RunCancelled extends Error { constructor() { super('cancelled by user'); } }

/**
 * Run `fn` as a tracked Activity run. Whatever `fn` returns is stored as the
 * run's output (JSON) and returned to the caller unchanged. Errors are stored
 * and re-thrown. `fn` should pass ctx.signal into smartAI so Cancel works.
 */
export async function tracked<T>(
  meta: { kind: RunKind; title: string; page: string; platform?: string; input?: unknown; model?: { providerID: string; id: string } | null },
  fn: (ctx: RunCtx) => Promise<T>,
  isFailure?: (out: T) => string | null,
): Promise<T & { runId: string }> {
  const store = getStore();
  if (!g.__payloadRunsChecked) { store.markOrphanRuns(new Set(live().keys())); g.__payloadRunsChecked = true; }
  const id = 'run' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const created = Date.now();
  const steps: RunStep[] = [{ label: 'Reading your data & building the prompt', at: created, state: 'active' }];
  const abort = new AbortController();
  live().set(id, { abort, steps });
  store.addRun({
    id, kind: meta.kind, title: String(meta.title || meta.kind).slice(0, 160), page: meta.page, platform: meta.platform || '',
    input: JSON.stringify(meta.input ?? {}).slice(0, 20_000), steps: JSON.stringify(steps),
    provider: meta.model?.providerID || '', model: meta.model?.id || '', created,
  });
  const persistSteps = () => store.saveRun(id, { steps: JSON.stringify(steps) });
  const ctx: RunCtx = {
    id, signal: abort.signal,
    step: label => {
      const last = steps[steps.length - 1];
      if (last && last.state === 'active') last.state = 'done';
      steps.push({ label, at: Date.now(), state: 'active' });
      persistSteps();
    },
    via: m => { if (m) store.saveRun(id, { provider: m.providerID, model: m.id }); },
  };
  const finish = (status: string, patch: { output?: string; error?: string }) => {
    const last = steps[steps.length - 1];
    if (last && last.state === 'active') last.state = status === 'done' ? 'done' : 'failed';
    store.saveRun(id, { status, steps: JSON.stringify(steps), finished: Date.now(), ms: Date.now() - created, ...patch });
    live().delete(id);
  };
  try {
    const out = await fn(ctx);
    if (abort.signal.aborted) { finish('cancelled', { error: 'cancelled by user' }); throw new RunCancelled(); }
    const failure = isFailure?.(out) || null;
    finish(failure ? 'failed' : 'done', { output: JSON.stringify(out).slice(0, 400_000), ...(failure ? { error: failure.slice(0, 1000) } : {}) });
    return Object.assign(out as object, { runId: id }) as T & { runId: string };
  } catch (e: any) {
    if (live().has(id)) finish(abort.signal.aborted ? 'cancelled' : 'failed', { error: abort.signal.aborted ? 'cancelled by user' : String(e?.message || e).slice(0, 1000) });
    throw abort.signal.aborted ? new RunCancelled() : e; // routes answer 499 'cancelled', not a 500
  }
}

export function cancelRun(id: string): boolean {
  const l = live().get(id);
  if (!l) return false;
  l.abort.abort();
  getStore().saveRun(id, { status: 'cancelled', error: 'cancelled by user', finished: Date.now() });
  return true;
}
export const isLive = (id: string) => live().has(id);
