// lib/automations.ts — scheduled AI pipelines.
//
// An automation is a chain of 1–6 steps. Each step calls one WORKER (Generate,
// a Toolkit tool, a Workflow agent, a free-form prompt, or a collector) with
// your own prompt, platform and model. A step can take the previous step's
// output: write {{prev}} in its prompt, or tick "use previous output" and it
// is appended. Every run is recorded on Activity (kind "automation") with one
// live step per chain step, and the final output is saved there.
//
// Schedules: manual, once (a date + time), daily, weekly (days + time), or
// every N hours — in this machine's local time. A scheduler started with the
// server (lib/startup.ts) calls /api/automations/tick every 30 seconds; due
// automations run then. If the server was off at the scheduled time, the run
// happens once when it comes back, then the schedule continues from now.
//
// Stored as JSON in SQLite meta ('automations') — one user, a handful of rows.
import 'server-only';
import { getStore, type AutomationRow } from './db';
import { smartAI } from './aichain';
import { TOOLS } from './tools';
import { nextRunOf, type Schedule } from './domain/schedule';
import { readTimezone } from './timezone-store';
import { enqueueTask, listTasks, TERMINAL_STATUSES } from './application/tasks';
import { workerLabel } from './application/automation-chain';
import { AGENTS } from './application/workflows';

export type WorkerKind = 'generate' | 'tool' | 'agent' | 'prompt' | 'collect';
export type ModelRef = { providerID: string; id: string } | null;
export type AutoStep = {
  id: string;
  worker: WorkerKind;
  platform: string;          // x | linkedin | instagram | threads | tiktok | youtube
  prompt: string;            // your instructions; {{prev}}, {{date}}, {{weekday}} are filled in
  usePrev: boolean;          // append the previous step's output when {{prev}} isn't used
  tool?: string;             // worker 'tool'
  agent?: string;            // worker 'agent'
  format?: string;           // worker 'generate'
  tone?: string;             // worker 'generate'
  withData?: boolean;        // worker 'prompt': include your data digest
  model?: ModelRef;
};
export type { Schedule } from './domain/schedule';
export type AutoRunRec = { at: number; status: string; runId: string; ms: number | null; error?: string; trigger: 'schedule' | 'manual' };
export type Automation = {
  id: string; name: string; description: string; enabled: boolean;
  steps: AutoStep[]; schedule: Schedule;
  nextRun: number | null; lastRun: number | null;
  history: AutoRunRec[];
  created: number; updated: number;
};

export const WORKERS: { key: WorkerKind; label: string; hint: string }[] = [
  { key: 'generate', label: 'Generate posts', hint: '3 drafts in your voice, borrowing the structure of winners. The prompt is your idea.' },
  { key: 'tool', label: 'Toolkit tool', hint: 'Any Toolkit text tool: hooks, ideas, captions, bios, threads, replies… The prompt fills its main field.' },
  { key: 'agent', label: 'Workflow agent', hint: 'A multi-step agent (deep-dive, hook hunter, weekly calendar, autopsy). The prompt is its topic.' },
  { key: 'prompt', label: 'Custom prompt', hint: 'Your own instructions, sent as-is with your creator profile (and optionally your data digest).' },
  { key: 'collect', label: 'Collect posts', hint: 'Starts the Apify collector for a platform (uses your Sources list and spend limit).' },
];

// ---------------- storage ----------------
// One row per automation in the `automations` table; steps/schedule/history are
// JSON columns. Legacy meta.automations is moved over on first read.
const KEY = 'automations';

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}
function rowToAutomation(r: AutomationRow): Automation {
  return {
    id: r.id, name: r.name, description: r.description, enabled: !!r.enabled,
    steps: parseJson<AutoStep[]>(r.steps, []),
    schedule: parseJson<Schedule>(r.schedule, { type: 'manual' }),
    nextRun: r.nextRun, lastRun: r.lastRun,
    history: parseJson<AutoRunRec[]>(r.history, []),
    created: r.created, updated: r.updated,
  };
}
function automationToRow(a: Automation): AutomationRow {
  return {
    id: a.id, name: a.name, description: a.description, enabled: a.enabled ? 1 : 0,
    steps: JSON.stringify(a.steps), schedule: JSON.stringify(a.schedule),
    nextRun: a.nextRun, lastRun: a.lastRun, history: JSON.stringify(a.history),
    created: a.created, updated: a.updated,
  };
}

let migratedLegacy = false;
/** One-time, idempotent move of meta.automations into the table. */
function migrateLegacyAutomations() {
  if (migratedLegacy) return;
  migratedLegacy = true;
  const store = getStore();
  const raw = store.getMeta(KEY);
  if (raw == null) return;
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) for (const a of list as Automation[]) {
      if (!a?.id || store.getAutomationRow(a.id)) continue;
      store.upsertAutomationRow(automationToRow(a));
    }
  } catch {}
  store.setMeta(KEY, ''); // the table is authoritative now
}

export function listAutomations(): Automation[] {
  migrateLegacyAutomations();
  return getStore().listAutomationRows().map(rowToAutomation);
}
function patch(id: string, fn: (a: Automation) => void) {
  migrateLegacyAutomations();
  const row = getStore().getAutomationRow(id);
  if (!row) return undefined;
  const a = rowToAutomation(row);
  fn(a);
  getStore().upsertAutomationRow(automationToRow(a));
  return a;
}

const PLATS = ['x', 'linkedin', 'instagram', 'threads', 'tiktok', 'youtube'];
const clean = (s: unknown, n: number) => String(s ?? '').slice(0, n);

function sanitizeStep(s: Partial<AutoStep>, i: number): AutoStep {
  const worker = (WORKERS.some(w => w.key === s.worker) ? s.worker : 'prompt') as WorkerKind;
  const model = s.model?.providerID && s.model?.id ? { providerID: clean(s.model.providerID, 20), id: clean(s.model.id, 80) } : null;
  return {
    id: clean(s.id, 30) || 'st' + Date.now().toString(36) + i,
    worker, platform: PLATS.includes(String(s.platform)) ? String(s.platform) : 'x',
    prompt: clean(s.prompt, 6000), usePrev: s.usePrev !== false && i > 0,
    tool: s.tool && TOOLS.some(t => t.key === s.tool) ? s.tool : undefined,
    agent: s.agent && AGENTS.some(a => a.kind === s.agent) ? s.agent : undefined,
    format: s.format ? clean(s.format, 30) : undefined, tone: s.tone ? clean(s.tone, 30) : undefined,
    withData: !!s.withData, model,
  };
}
function sanitizeSchedule(s: Partial<Schedule> | undefined): Schedule {
  const type = (['manual', 'once', 'daily', 'weekly', 'interval'] as const).includes(s?.type as never) ? s!.type! : 'manual';
  const time = /^\d{2}:\d{2}$/.test(String(s?.time)) ? String(s!.time) : '09:00';
  return {
    type,
    at: type === 'once' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(s?.at)) ? String(s!.at).slice(0, 16) : undefined,
    time: type === 'daily' || type === 'weekly' ? time : undefined,
    days: type === 'weekly' ? [...new Set((s?.days || []).map(Number).filter(d => d >= 0 && d <= 6))].sort() : undefined,
    everyHours: type === 'interval' ? Math.min(168, Math.max(1, Math.round(Number(s?.everyHours) || 24))) : undefined,
  };
}

export { nextRunOf };

export function saveAutomation(input: Partial<Automation>): Automation {
  migrateLegacyAutomations();
  const now = Date.now();
  const existingRow = input.id ? getStore().getAutomationRow(input.id) : undefined;
  const existing = existingRow ? rowToAutomation(existingRow) : undefined;
  const steps = (input.steps || existing?.steps || []).slice(0, 6).map((s, i) => sanitizeStep(s, i));
  if (!steps.length) throw new Error('Add at least one step.');
  const schedule = sanitizeSchedule(input.schedule || existing?.schedule);
  const enabled = input.enabled ?? existing?.enabled ?? true;
  const a: Automation = {
    id: existing?.id || 'auto' + now.toString(36),
    name: clean(input.name ?? existing?.name, 80).trim() || 'Untitled automation',
    description: clean(input.description ?? existing?.description, 300),
    enabled, steps, schedule,
    nextRun: enabled ? nextRunOf(schedule, now, readTimezone()) : null,
    lastRun: existing?.lastRun ?? null,
    history: existing?.history || [],
    created: existing?.created || now, updated: now,
  };
  getStore().upsertAutomationRow(automationToRow(a));
  return a;
}
export function deleteAutomation(id: string) { migrateLegacyAutomations(); getStore().deleteAutomationRow(id); }
export function setEnabled(id: string, on: boolean) {
  return patch(id, a => { a.enabled = on; a.nextRun = on ? nextRunOf(a.schedule, Date.now(), readTimezone()) : null; a.updated = Date.now(); });
}

// ---------------- running ----------------
// An automation run is a task (kind "automation"): the worker runs the chain,
// the steps are in the task's event log, and a restart does not lose the run.
// `runAutomation` only queues it.
export function isRunning(id: string): boolean {
  return listTasks({ kind: 'automation', limit: 100 }).some(t =>
    !TERMINAL_STATUSES.includes(t.status) && (t.input as any)?.automationId === id);
}

/** Queue an automation run. Resolves as soon as it is queued. */
export function runAutomation(id: string, trigger: 'schedule' | 'manual'): { runId?: string; error?: string } {
  const a = listAutomations().find(x => x.id === id);
  if (!a) return { error: 'not found' };
  if (isRunning(id)) return { error: 'already running' };
  const task = enqueueTask({
    kind: 'automation',
    input: { automationId: id, trigger, steps: a.steps.map(s => ({ worker: workerLabel(s), prompt: s.prompt })) },
    title: a.name,
    page: `/automations?id=${a.id}`,
    platform: a.steps[a.steps.length - 1]?.platform,
    trigger,
  });
  patch(id, x => {
    x.history = [{ at: Date.now(), status: 'running', runId: task.id, ms: null, trigger }, ...x.history].slice(0, 15);
  });
  return { runId: task.id };
}

/** The worker calls this when the chain finishes (or fails). */
export function recordAutomationRun(id: string, runId: string, status: string, ms: number | null, error?: string) {
  patch(id, x => {
    x.lastRun = Date.now();
    const h = x.history.find(r => r.runId === runId);
    if (h) {
      h.status = status;
      h.ms = ms;
      if (error) h.error = error;
    } else {
      const rec: AutoRunRec = { at: Date.now(), status, runId, ms, trigger: 'manual' };
      if (error) rec.error = error;
      x.history = [rec, ...x.history].slice(0, 15);
    }
  });
}

/** Called by the scheduler tick: queue every due automation. */
export function runDue(now = Date.now()): string[] {
  const started: string[] = [];
  for (const a of listAutomations()) {
    if (!a.enabled || a.nextRun == null || a.nextRun > now || isRunning(a.id)) continue;
    // move the schedule on BEFORE running, so a slow run is never started twice
    a.nextRun = a.schedule.type === 'once' ? null : nextRunOf(a.schedule, now, readTimezone());
    if (a.schedule.type === 'once') a.enabled = false;
    a.updated = now;
    getStore().upsertAutomationRow(automationToRow(a));
    started.push(a.id);
  }
  for (const id of started) runAutomation(id, 'schedule');
  return started;
}

// The scheduler tick runs in-process (lib/startup.ts) — it calls runDue() directly,
// so there is no scheduler key and no HTTP hop any more.
