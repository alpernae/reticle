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
import { getStore } from './db';
import { tracked, type RunCtx } from './activity';
import { smartAI } from './aichain';
import { TOOLS } from './tools';
import { AGENTS } from './jobs';
import { PLATFORM_HINTS, analysisDigest, digestText } from './engine';
import { nextRunOf, type Schedule } from './schedule';

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
export type { Schedule } from './schedule';
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
const KEY = 'automations';
export function listAutomations(): Automation[] {
  try { const v = JSON.parse(getStore().getMeta(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveAll(list: Automation[]) { getStore().setMeta(KEY, JSON.stringify(list)); }
function patch(id: string, fn: (a: Automation) => void) {
  const list = listAutomations();
  const a = list.find(x => x.id === id);
  if (a) { fn(a); saveAll(list); }
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
  const list = listAutomations();
  const now = Date.now();
  const existing = input.id ? list.find(a => a.id === input.id) : undefined;
  const steps = (input.steps || existing?.steps || []).slice(0, 6).map((s, i) => sanitizeStep(s, i));
  if (!steps.length) throw new Error('Add at least one step.');
  const schedule = sanitizeSchedule(input.schedule || existing?.schedule);
  const enabled = input.enabled ?? existing?.enabled ?? true;
  const a: Automation = {
    id: existing?.id || 'auto' + now.toString(36),
    name: clean(input.name ?? existing?.name, 80).trim() || 'Untitled automation',
    description: clean(input.description ?? existing?.description, 300),
    enabled, steps, schedule,
    nextRun: enabled ? nextRunOf(schedule, now) : null,
    lastRun: existing?.lastRun ?? null,
    history: existing?.history || [],
    created: existing?.created || now, updated: now,
  };
  saveAll(existing ? list.map(x => (x.id === a.id ? a : x)) : [a, ...list]);
  return a;
}
export function deleteAutomation(id: string) { saveAll(listAutomations().filter(a => a.id !== id)); }
export function setEnabled(id: string, on: boolean) {
  return patch(id, a => { a.enabled = on; a.nextRun = on ? nextRunOf(a.schedule) : null; a.updated = Date.now(); });
}

// ---------------- running ----------------
const g = globalThis as unknown as { __payloadAutoRunning?: Set<string> };
const running = () => (g.__payloadAutoRunning ||= new Set());
export const isRunning = (id: string) => running().has(id);

function fill(prompt: string, prev: string, usePrev: boolean): string {
  const now = new Date();
  let p = prompt
    .replace(/\{\{\s*date\s*\}\}/gi, now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))
    .replace(/\{\{\s*weekday\s*\}\}/gi, now.toLocaleDateString('en-US', { weekday: 'long' }));
  if (/\{\{\s*prev\s*\}\}/i.test(p)) p = p.replace(/\{\{\s*prev\s*\}\}/gi, prev || '(no previous output)');
  else if (usePrev && prev) p = `${p}\n\nINPUT FROM THE PREVIOUS STEP:\n${prev}`;
  return p.trim();
}

const post = (body: unknown) => new Request('http://local/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Turn any worker response into plain text the next step can read. */
function toText(j: any): string {
  if (!j || typeof j !== 'object') return String(j ?? '');
  if (Array.isArray(j.variants)) return j.variants.map((v: any, i: number) => `── Draft ${i + 1}${v.angle ? ` · ${v.angle}` : ''} ──\n${v.text}${v.hashtags?.length ? '\n\n' + v.hashtags.join(' ') : ''}`).join('\n\n');
  if (Array.isArray(j.items)) return j.items.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n');
  if (Array.isArray(j.slides)) return j.slides.map((s: any, i: number) => `Slide ${i + 1}: ${s.title}\n${s.body}`).join('\n\n');
  if (typeof j.text === 'string') return j.text;
  return JSON.stringify(j).slice(0, 4000);
}

async function runStep(s: AutoStep, prompt: string, ctx: RunCtx): Promise<{ text: string; runId?: string }> {
  switch (s.worker) {
    case 'generate': {
      const { POST } = await import('@/app/api/generate/route');
      const r = await POST(post({ platform: s.platform, idea: prompt, format: s.format || null, tone: s.tone || null, model: s.model }));
      const j = await r.json();
      if (!r.ok || j.error || j.mode !== 'ai') throw new Error(j.aiError || j.error || j.hint || `Generate failed (${r.status})`);
      if (j.via) ctx.via(j.via);
      return { text: toText(j), runId: j.runId };
    }
    case 'tool': {
      const def = TOOLS.find(t => t.key === s.tool);
      if (!def) throw new Error('Pick a Toolkit tool for this step.');
      const field = def.fields.find(f => f.kind !== 'select') || def.fields[0];
      const { POST } = await import('@/app/api/tools/route');
      const r = await POST(post({ tool: def.key, platform: s.platform, input: field ? { [field.key]: prompt } : {}, model: s.model }));
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `Toolkit failed (${r.status})`);
      return { text: toText(j), runId: j.runId };
    }
    case 'agent': {
      const { createJob, jobsList } = await import('./jobs');
      const c = createJob({ kind: s.agent || 'dive', topic: prompt.slice(0, 80), platform: s.platform, model: s.model });
      if (!c.ok) throw new Error(c.error);
      for (let waited = 0; waited < 20 * 60_000; waited += 3000) {
        if (ctx.signal.aborted) throw new Error('cancelled by user');
        await sleep(3000);
        const job = jobsList().find(x => x.id === c.id);
        if (!job) throw new Error('the agent run disappeared');
        if (job.status === 'done') return { text: job.result, runId: c.id };
        if (['failed', 'stopped', 'interrupted'].includes(job.status)) throw new Error(job.err || `agent ${job.status}`);
      }
      throw new Error('the agent took longer than 20 minutes');
    }
    case 'collect': {
      const { apifyStart } = await import('./apify');
      const run = await apifyStart(s.platform as never);
      return { text: `Started the ${PLATFORM_HINTS[s.platform]?.label || s.platform} collector (Apify run ${run.id}). New posts are imported when it finishes.` };
    }
    default: {
      const data = s.withData ? `\n\nMY DATA (only use figures that appear here):\n${digestText(analysisDigest())}` : '';
      const r = await smartAI(prompt + data, 240_000, s.model, ctx.signal, { platform: s.platform, role: 'workflow' });
      if (!r.out) throw new Error(r.errors.join(' | ') || 'no answer');
      ctx.via(r.model);
      return { text: r.out };
    }
  }
}

export function workerLabel(s: AutoStep): string {
  const p = PLATFORM_HINTS[s.platform]?.label || s.platform;
  if (s.worker === 'tool') return `${TOOLS.find(t => t.key === s.tool)?.name || 'Toolkit'} · ${p}`;
  if (s.worker === 'agent') return `${AGENTS.find(a => a.kind === s.agent)?.name || 'Agent'} · ${p}`;
  return `${WORKERS.find(w => w.key === s.worker)?.label || s.worker} · ${p}`;
}

/** Run an automation now (scheduled or manual). Resolves when the chain ends. */
export async function runAutomation(id: string, trigger: 'schedule' | 'manual'): Promise<{ runId?: string; error?: string }> {
  const a = listAutomations().find(x => x.id === id);
  if (!a) return { error: 'not found' };
  if (running().has(id)) return { error: 'already running' };
  running().add(id);
  const started = Date.now();
  let runId = '';
  try {
    const res = await tracked(
      { kind: 'automation', title: `${a.name}`, page: `/automations?id=${a.id}`, platform: a.steps[a.steps.length - 1]?.platform, input: { automation: a.id, trigger, steps: a.steps.map(s => ({ worker: workerLabel(s), prompt: s.prompt })) } },
      async ctx => {
        runId = ctx.id;
        patch(id, x => { x.history = [{ at: started, status: 'running', runId: ctx.id, ms: null, trigger }, ...x.history].slice(0, 15); });
        const outs: { label: string; text: string; runId?: string }[] = [];
        let prev = '';
        for (let i = 0; i < a.steps.length; i++) {
          if (ctx.signal.aborted) throw new Error('cancelled by user');
          const s = a.steps[i];
          ctx.step(`Step ${i + 1}: ${workerLabel(s)}`);
          const r = await runStep(s, fill(s.prompt, prev, s.usePrev), ctx);
          outs.push({ label: workerLabel(s), text: r.text, runId: r.runId });
          prev = r.text;
        }
        ctx.step('Saved the result');
        return { automation: a.id, steps: outs, text: prev };
      },
    );
    patch(id, x => { x.lastRun = started; const h = x.history.find(r => r.runId === res.runId); if (h) { h.status = 'done'; h.ms = Date.now() - started; } });
    return { runId: res.runId };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    patch(id, x => {
      x.lastRun = started;
      const h = x.history.find(r => r.runId === runId);
      if (h) { h.status = /cancel/i.test(msg) ? 'cancelled' : 'failed'; h.ms = Date.now() - started; h.error = msg; }
      else x.history = [{ at: started, status: 'failed', runId, ms: Date.now() - started, error: msg, trigger }, ...x.history].slice(0, 15);
    });
    return { runId, error: msg };
  } finally {
    running().delete(id);
  }
}

/** Called by the scheduler tick: start every due automation (not awaited). */
export function runDue(now = Date.now()): string[] {
  const list = listAutomations();
  const started: string[] = [];
  for (const a of list) {
    if (!a.enabled || a.nextRun == null || a.nextRun > now || running().has(a.id)) continue;
    // move the schedule on BEFORE running, so a slow run is never started twice
    a.nextRun = a.schedule.type === 'once' ? null : nextRunOf(a.schedule, now);
    if (a.schedule.type === 'once') a.enabled = false;
    started.push(a.id);
  }
  if (started.length) {
    saveAll(list);
    for (const id of started) void runAutomation(id, 'schedule');
  }
  return started;
}

// ---------------- scheduler key (lets the server's own timer through the auth proxy) ----------------
export function schedulerKey(): string {
  const store = getStore();
  let k = store.getMeta('schedulerKey') || '';
  if (k.length < 32) {
    k = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
    store.setMeta('schedulerKey', k);
  }
  return k;
}
