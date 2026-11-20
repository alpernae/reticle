// lib/jobs.ts — the Studio's workflow jobs, backed by the task system.
//
// A workflow used to own its own runtime (a globalThis map plus a `jobs`
// table). It is now a task of kind "workflow": the worker runs it, its steps
// live in `task_events`, and it survives a server restart. This module is the
// read/write facade the Studio page and the Activity page use — the shapes it
// returns are unchanged.
import 'server-only';
import { AGENTS, agentCatalog } from './application/workflows';
import { allPayload } from './engine';
import {
  cancelTask, deleteTask, enqueueTask, getTask, getTaskEvents, listTasks, pauseTask, resumeTask,
  type Task,
} from './application/tasks';

export { AGENTS, agentCatalog };
export type { AgentCtx, AgentDef, AgentStep } from './application/workflows';

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'stopped' | 'interrupted';
export type JobStep = { name: string; label: string; state: StepState; note?: string; dur?: number };
export type JobRow = {
  id: string; kind: string; topic: string; platform: string; model?: string;
  status: JobStatus; steps: JobStep[]; result: string; err: string;
  created: number; started: number | null; finished: number | null;
};

const STATUS: Record<string, JobStatus> = {
  queued: 'queued', running: 'running', paused: 'paused', waiting: 'queued',
  done: 'done', failed: 'failed', cancelled: 'stopped',
};

type WorkflowCheckpoint = { notes?: string[]; meta?: { ms: number; chars: number }[] };

function taskToJob(t: Task): JobRow {
  const input = (t.input || {}) as { kind?: string; topic?: string; platform?: string; model?: { providerID: string; id: string } | null };
  const def = AGENTS.find(a => a.kind === input.kind);
  const cp = (t.checkpoint || null) as WorkflowCheckpoint | null;
  const events = getTaskEvents(t.id).filter(e => e.type === 'step');
  const steps: JobStep[] = (def?.steps || []).map((s, i) => {
    const ev = events.find(e => e.label === s.label);
    const meta = cp?.meta?.[i];
    const data = (ev?.data || null) as { note?: string; dur?: number | null } | null;
    const state: StepState = ev?.state === 'failed' ? 'failed'
      : ev?.state === 'done' || meta ? 'done'
        : ev?.state === 'active' ? 'active' : 'pending';
    const note = data?.note || (meta ? `${meta.chars} chars · ${Math.round(meta.ms / 1000)}s` : undefined);
    const dur = data?.dur ?? (meta ? Math.round(meta.ms / 1000) : undefined);
    return {
      name: s.name, label: s.label, state,
      ...(note ? { note } : {}),
      ...(dur != null ? { dur } : {}),
    };
  });
  const out = (t.output || null) as { result?: string } | null;
  const model = input.model ? `${input.model.providerID}|${input.model.id}` : '';
  return {
    id: t.id, kind: String(input.kind || ''), topic: String(input.topic || ''), platform: String(input.platform || 'x'),
    model, status: STATUS[t.status] || 'queued', steps,
    result: out?.result || '', err: t.error || '',
    created: t.created, started: t.started, finished: t.finished,
  };
}

/** Every workflow, newest first. */
export function jobsList(): JobRow[] {
  return listTasks({ kind: 'workflow', limit: 100 }).map(taskToJob);
}

export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

/** Queue an agent run. The worker picks it up right away. */
export function createJob(input: { kind?: string; topic?: string; platform?: string; model?: { providerID?: string; id?: string } | null }): CreateResult {
  const kind = String(input.kind || '');
  const def = AGENTS.find(a => a.kind === kind);
  if (!def) return { ok: false, error: 'unknown agent kind' };
  if (def.needsWinners && !(allPayload().manual?.length)) return { ok: false, error: 'no results yet — Generate saves its outputs to Winners automatically' };

  const topic = String(input.topic || '').slice(0, 80);
  const platform = String(input.platform || 'x').slice(0, 12);
  const model = input.model?.providerID && input.model?.id ? { providerID: String(input.model.providerID).slice(0, 20), id: String(input.model.id).slice(0, 60) } : null;
  const task = enqueueTask({
    kind: 'workflow',
    input: { kind, topic, platform, model },
    title: `${def.name}${topic ? ` — ${topic}` : ''}`,
    page: '/workflows',
    platform,
    trigger: 'studio',
  });
  return { ok: true, id: task.id };
}

/** Pause / resume / stop a workflow. Same verbs as before, now on the task. */
export function jobAction(id: string, action: string): { ok: boolean; error?: string } {
  const task = getTask(id);
  if (!task) return { ok: false, error: 'job has no active runner (already finished, or server restarted)' };
  if (action === 'pause' && (task.status === 'running' || task.status === 'queued')) {
    return pauseTask(id) ? { ok: true } : { ok: false, error: `cannot pause while the job is ${task.status}` };
  }
  if (action === 'resume' && task.status === 'paused') {
    return resumeTask(id) ? { ok: true } : { ok: false, error: 'cannot resume this job' };
  }
  if (action === 'stop' && ['queued', 'running', 'paused', 'waiting'].includes(task.status)) {
    return cancelTask(id) ? { ok: true } : { ok: false, error: `cannot stop while the job is ${task.status}` };
  }
  return { ok: false, error: `action "${action}" is not valid while the job is ${task.status}` };
}

export function deleteJob(id: string): { ok: boolean } {
  return { ok: deleteTask(id) };
}
