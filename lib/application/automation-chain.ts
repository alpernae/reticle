// lib/application/automation-chain.ts — runs an automation's steps.
//
// An automation is a chain of 1–6 steps. Each step calls one worker (Generate,
// a Toolkit tool, a Workflow agent, a free-form prompt, or the collector) with
// your prompt, platform and model. A step can take the previous step's output:
// write {{prev}} in its prompt, or tick "use previous output" and it is
// appended.
//
// The chain runs inside a task (kind "automation"), so it is durable: it
// survives a restart, it can be cancelled, and its steps are in the task's
// event log.
import 'server-only';
import { PLATFORM_HINTS, analysisDigest, digestText } from '../engine';
import { smartAI } from '../aichain';
import { TOOLS } from '../tools';
import { AGENTS } from './workflows';
import type { AutoStep, Automation } from '../automations';

/** Fill the placeholders a step's prompt may contain. */
export function fillPrompt(prompt: string, prev: string, usePrev: boolean): string {
  const now = new Date();
  let p = prompt
    .replace(/\{\{\s*date\s*\}\}/gi, now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))
    .replace(/\{\{\s*weekday\s*\}\}/gi, now.toLocaleDateString('en-US', { weekday: 'long' }));
  if (/\{\{\s*prev\s*\}\}/i.test(p)) p = p.replace(/\{\{\s*prev\s*\}\}/gi, prev || '(no previous output)');
  else if (usePrev && prev) p = `${p}\n\nINPUT FROM THE PREVIOUS STEP:\n${prev}`;
  return p.trim();
}

/** Turn any worker response into plain text the next step can read. */
export function toText(j: any): string {
  if (!j || typeof j !== 'object') return String(j ?? '');
  if (Array.isArray(j.variants)) return j.variants.map((v: any, i: number) => `── Draft ${i + 1}${v.angle ? ` · ${v.angle}` : ''} ──\n${v.text}${v.hashtags?.length ? '\n\n' + v.hashtags.join(' ') : ''}`).join('\n\n');
  if (Array.isArray(j.items)) return j.items.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n');
  if (Array.isArray(j.slides)) return j.slides.map((s: any, i: number) => `Slide ${i + 1}: ${s.title}\n${s.body}`).join('\n\n');
  if (typeof j.text === 'string') return j.text;
  return JSON.stringify(j).slice(0, 4000);
}

export type ChainCtx = {
  step: (label: string) => void;
  via: (m: { providerID: string; id: string } | null | undefined) => void;
  signal: AbortSignal;
};

/** Run one step of the chain and return its text. */
export async function runStep(s: AutoStep, prompt: string, ctx: ChainCtx): Promise<{ text: string; runId?: string }> {
  switch (s.worker) {
    case 'generate': {
      const { generateDrafts } = await import('./drafts');
      const res = await generateDrafts({ platform: s.platform, idea: prompt, format: s.format || null, tone: s.tone || null, model: s.model }, { signal: ctx.signal });
      const j = res.body;
      if (res.status !== 200 || j?.error || j?.mode !== 'ai') throw new Error(j?.aiError || j?.error || j?.hint || `Generate failed (${res.status})`);
      if (j.via) ctx.via(j.via);
      return { text: toText(j), runId: j.runId };
    }
    case 'tool': {
      const def = TOOLS.find(t => t.key === s.tool);
      if (!def) throw new Error('Pick a Toolkit tool for this step.');
      const field = def.fields.find(f => f.kind !== 'select') || def.fields[0];
      const { runTool } = await import('./tools');
      const res = await runTool({ tool: def.key, platform: s.platform, input: field ? { [field.key]: prompt } : {}, model: s.model }, { signal: ctx.signal });
      const j = res.body;
      if (res.status !== 200 || j?.error) throw new Error(j?.error || `Toolkit failed (${res.status})`);
      return { text: toText(j), runId: j.runId };
    }
    case 'agent': {
      // A workflow agent is a task of its own — queue it and wait for it.
      const { enqueueTask, waitForTask } = await import('./tasks');
      const agent = AGENTS.find(a => a.kind === s.agent);
      const task = enqueueTask({
        kind: 'workflow',
        input: { kind: s.agent || 'dive', topic: prompt.slice(0, 80), platform: s.platform, model: s.model },
        title: agent?.name || 'Workflow',
        page: '/workflows',
        platform: s.platform,
        trigger: 'automation',
      });
      const done = await waitForTask(task.id, 20 * 60_000, 1000);
      if (!done) throw new Error('the agent run disappeared');
      if (done.status !== 'done') throw new Error(done.error || `agent ${done.status}`);
      const out = done.output as { result?: string } | null;
      return { text: out?.result || '', runId: task.id };
    }
    case 'collect': {
      // The collector is a durable task: it starts the Apify run, keeps
      // polling it in the background and imports the dataset when it finishes
      // — even when the Sources page is closed (finding F1).
      const { enqueueTask } = await import('./tasks');
      const task = enqueueTask({
        kind: 'collect',
        input: { platform: s.platform },
        title: `Collect ${PLATFORM_HINTS[s.platform]?.label || s.platform} posts`,
        page: '/sources',
        platform: s.platform,
        trigger: 'automation',
        maxAttempts: 3,
      });
      return { text: `Queued the ${PLATFORM_HINTS[s.platform]?.label || s.platform} collector (task ${task.id}). The new posts are imported when the run finishes — you can close this page.` };
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

/** Run the whole chain and return its steps. */
export async function runAutomationChain(a: Automation, trigger: 'schedule' | 'manual', ctx: ChainCtx): Promise<{ automation: string; steps: { label: string; text: string; runId?: string }[]; text: string }> {
  const outs: { label: string; text: string; runId?: string }[] = [];
  let prev = '';
  for (let i = 0; i < a.steps.length; i++) {
    if (ctx.signal.aborted) throw new Error('cancelled by user');
    const s = a.steps[i];
    ctx.step(`Step ${i + 1}: ${workerLabel(s)}`);
    const r = await runStep(s, fillPrompt(s.prompt, prev, s.usePrev), ctx);
    outs.push({ label: workerLabel(s), text: r.text, runId: r.runId });
    prev = r.text;
  }
  ctx.step('Saved the result');
  return { automation: a.id, steps: outs, text: prev, trigger } as { automation: string; steps: { label: string; text: string; runId?: string }[]; text: string };
}

/** The human label of a step ("Generate posts · X / Twitter"). */
export function workerLabel(s: AutoStep): string {
  const p = PLATFORM_HINTS[s.platform]?.label || s.platform;
  if (s.worker === 'tool') return `${TOOLS.find(t => t.key === s.tool)?.name || 'Toolkit'} · ${p}`;
  if (s.worker === 'agent') return `${AGENTS.find(a => a.kind === s.agent)?.name || 'Agent'} · ${p}`;
  return `${WORKER_LABELS[s.worker] || s.worker} · ${p}`;
}

/** The worker names (kept here so the label helper needs no import cycle). */
const WORKER_LABELS: Record<string, string> = {
  generate: 'Generate posts',
  tool: 'Toolkit tool',
  agent: 'Workflow agent',
  prompt: 'Custom prompt',
  collect: 'Collect posts',
};
