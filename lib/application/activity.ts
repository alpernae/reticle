// lib/application/activity.ts — the Activity log, read from the task table.
//
// Activity used to merge two tables (ai_runs + jobs). Now every run is a task
// (ADR-001), so the log is one list: tasks, newest first, with the step log
// that `task_events` keeps for each one.
import 'server-only';
import { getTaskEvents, listTasks, type Task, type TaskEvent } from './tasks';

export type ActivityStep = { label: string; at: number; state: string };

export type ActivityRun = {
  id: string; kind: string; title: string; page: string; platform: string; status: string;
  steps: ActivityStep[]; provider: string; model: string; error: string;
  created: number; finished: number | null; ms: number | null;
};

/** The step log of a task, in the shape the Activity page draws. */
export function taskSteps(taskId: string, events?: TaskEvent[]): ActivityStep[] {
  const evs = events ?? getTaskEvents(taskId);
  return evs.filter(e => e.type === 'step').map(e => ({
    label: e.label || '', at: e.at, state: e.state || 'active',
  }));
}

/** One task as an Activity row. */
export function taskToRun(t: Task, events?: TaskEvent[]): ActivityRun {
  return {
    id: t.id, kind: t.kind, title: t.title, page: t.page, platform: t.platform,
    status: t.status, steps: taskSteps(t.id, events),
    provider: t.provider, model: t.model, error: t.error || '',
    created: t.created, finished: t.finished,
    ms: t.finished ? (t.started ? t.finished - t.started : t.finished - t.created) : null,
  };
}

/** Every task as an Activity row, newest first. */
export function activityRuns(limit = 300): ActivityRun[] {
  return listTasks({ limit }).map(t => taskToRun(t)).sort((a, b) => b.created - a.created);
}

/** The statuses that mean "this task is still going". */
export const ACTIVE_STATUSES = ['running', 'queued', 'paused', 'waiting'];

export type ActivitySummary = {
  running: number;
  active: string[];   // the ids of the running tasks
  recent: { id: string; kind: string; page: string | null; title: string; status: string; error?: string | null; ms?: number | null }[];
};

/**
 * The cheap summary the shell polls for today: how many tasks run, which
 * ones, and what finished in the last two minutes. The live event stream
 * (`/api/events`) pushes exactly this, so both paths read one implementation.
 */
export function activitySummary(limit = 100): ActivitySummary {
  const runs = activityRuns(limit);
  const running = runs.filter(r => ACTIVE_STATUSES.includes(r.status)).length;
  const recent = runs
    .filter(r => r.finished && Date.now() - r.finished < 120_000)
    .map(r => ({ id: r.id, kind: r.kind, page: r.page, title: r.title, status: r.status, error: r.error, ms: r.ms }));
  return { running, recent, active: runs.filter(r => r.status === 'running').map(r => r.id) };
}
