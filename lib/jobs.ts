// Studio job runner — long-running AI agents as trackable, pausable, stoppable jobs.
// Each job is a sequence of transparent steps; every step is one AI call stored in
// SQLite as it transitions, so the Studio page can poll and render live progress.
// The process-lifetime runtime lives on globalThis; SQLite is the source of truth.
import 'server-only';
import { getStore } from './db';
import { analysisDigest, digestText, topPosts, allPayload, PLATFORM_HINTS } from './engine';
import { smartAI, type AIModelRef } from './aichain';

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'stopped' | 'interrupted';
export type JobStep = { name: string; label: string; state: StepState; note?: string; dur?: number };
export type JobRow = {
  id: string; kind: string; topic: string; platform: string; model?: string;
  status: JobStatus; steps: JobStep[]; result: string; err: string;
  created: number; started: number | null; finished: number | null;
};

// ---------------- runtime registry (survives dev-route reloads) ----------------
type Runtime = { status: JobStatus; steps: JobStep[]; result: string; abort: AbortController };
const g = globalThis as unknown as { __socialPanelJobRuntime?: { rts: Map<string, Runtime> } };
const rt = () => (g.__socialPanelJobRuntime ||= { rts: new Map<string, Runtime>() });

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  const onAbort = () => { clearTimeout(t); rej(new Error('aborted')); };
  if (signal.aborted) return onAbort();
  signal.addEventListener('abort', onAbort, { once: true });
});

// ---------------- ground-truth context every agent reads ----------------
type Ctx = {
  topic: string; platform: string; platformLabel: string;
  digest: string; digestive: ReturnType<typeof analysisDigest>;
  picks: string; winners: string; notes: string[];
  model: AIModelRef | null; // per-run provider/model pick (null = Settings order)
};

async function buildCtx(kind: string, topic: string, platform: string, model: AIModelRef | null = null): Promise<Ctx> {
  const digestive = analysisDigest();
  const digest = digestText(digestive);
  const rows = topPosts(10, undefined);
  const picks = rows.map((p, i) => `${i + 1}. ${p.title} [score ${p.score}, ${p.source}]`).join('\n') || '(none)';
  const winners = (allPayload().manual || [])
    .slice(0, 10)
    .map(m => `• [${m.platform}, eng ${m.eng}] ${m.text.replace(/\s+/g, ' ').slice(0, 120)}`)
    .join('\n');
  if (kind === 'autopsy' && !winners) throw new Error('no results logged yet — this agent needs your real post results (they appear here once Generate saves them to Winners)');
  return {
    topic: topic || digestive.risingTopics[0]?.name || 'developer tools',
    platform, platformLabel: PLATFORM_HINTS[platform]?.label || 'X / Twitter',
    digest, digestive, picks, winners, notes: [], model,
  };
}

// ---------------- agent catalog — every step is one honest AI call ----------------
export type AgentDef = {
  kind: string; name: string; tagline: string;
  explain?: string; // plain-language: what it reads, what it does, what you get
  needsWinners?: boolean;
  steps: { name: string; label: string; run: (ctx: Ctx, signal: AbortSignal) => Promise<string> }[];
};

const GROUND = 'RULES: quote only figures present in the supplied digest data. If a number does not appear there, do not invent it. Plain text, no markdown headings.';

export const AGENTS: AgentDef[] = [
  {
    kind: 'dive',
    explain: "Reads the data digest (outlier winners, pattern table, rising topics) for your topic → 1) writes a short state-of-the-topic: who posts about it and which angles win, 2) turns that into 4 angles (contrarian, data, guide, story), 3) writes ONE full post from the strongest angle in your platform format. Use it when you have a topic but no angle.",
    name: 'Topic deep-dive',
    tagline: 'read a rising topic, then angles, then a ready draft',
    steps: [
      {
        name: 'recon', label: 'Read the room',
        run: (ctx, signal) => smartAI([
          `You are a research analyst. TOPIC: "${ctx.topic}".`,
          `DATA DIGEST (only source of truth):\n${ctx.digest}`,
          `TOP RECENT POSTS:\n${ctx.picks}`,
          GROUND,
          `Write a factual 4-sentence state-of-the-topic: who is posting about it, what the highest-engagement post angles are, and what is conspicuously missing. 90 words max.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
      {
        name: 'angles', label: 'Post angles',
        run: (ctx, signal) => smartAI([
          `TOPIC: "${ctx.topic}". Your earlier research of it:\n${ctx.notes[0] || ''}`,
          GROUND,
          `Produce exactly 4 post angles for a dev & cybersecurity creator, one per line: "· CONTRARIAN: ...", "· DATA: ...", "· GUIDE: ...", "· STORY: ...". Each under 30 words, each using at least one concrete fact from the research.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
      {
        name: 'draft', label: 'Full draft',
        run: (ctx, signal) => smartAI([
          `TOPIC: "${ctx.topic}". Platform: ${ctx.platformLabel}. Format rules: ${PLATFORM_HINTS[ctx.platform]?.rules || ''}`,
          `Research:\n${ctx.notes[0] || ''}\nAngles:\n${ctx.notes[1] || ''}`,
          GROUND,
          `Pick the strongest angle and write ONE full post, ready to publish, in the ${ctx.platform} format. No preamble, no title line — just the post body.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
    ],
  },
  {
    kind: 'hooks',
    explain: "Studies the winners in your database → 1) names the 3 hook formulas that win most (e.g. \"number + loss\", \"contrarian claim\") with evidence, 2) writes 10 one-line hooks on your topic using those formulas. Use it to fill your first lines for the week.",
    name: 'Hook hunter',
    tagline: 'extract hook formulas, mint variants on your topic',
    steps: [
      {
        name: 'patterns', label: 'Pattern read',
        run: (ctx, signal) => smartAI([
          `DATA DIGEST:\n${ctx.digest}`,
          `TOP RECENT POSTS:\n${ctx.picks}`,
          ctx.winners ? `THE USER'S OWN WINNERS:\n${ctx.winners}` : '',
          GROUND,
          `Identify the 3 strongest hook formulas visible in the data (e.g. "number + loss", "contrarian claim"). One per line: "· <formula> — <why it wins, citing the data>"`,
        ].filter(Boolean).join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
      {
        name: 'variants', label: '10 hook variants',
        run: (ctx, signal) => smartAI([
          `TOPIC: "${ctx.topic}". Formulas:\n${ctx.notes[0] || ''}`,
          `Write exactly 10 hooks for ${ctx.topic}, numbered 1.-10., each one line, max 90 chars. Mix the formulas from your analysis: at least 2 with a concrete number from the digest, 2 questions, 2 contrarian claims, 2 "how" lines, 2 story-openers. No hashtag, no emoji.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
    ],
  },
  {
    kind: 'calendar',
    explain: "Reads the digest (best hours, rising topics, patterns) → 1) plans 7 days of posts with day, hour, topic and angle, 2) writes the first 3 as ready hooks. Use it on Sunday to plan the week.",
    name: 'Weekly calendar',
    tagline: 'a 7-day posting plan on your best hours, first 3 written out',
    steps: [
      {
        name: 'plan', label: 'Plan 7 days',
        run: (ctx, signal) => smartAI([
          `DATA DIGEST:\n${ctx.digest}`,
          GROUND,
          `Draft a 7-day posting calendar for a dev & cybersecurity creator. One line per day: "Day N (<weekday>) — HH:00 — <topic from the digest's rising topics> — <one-line angle>". Anchor the hours to the digest's best posting hours. Vary topics across the week.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
      {
        name: 'firsts', label: 'Write first 3',
        run: (_ctx, signal) => smartAI([
          `Plan:\n${(_ctx.notes[0] || '')}\nPlatform rules: ${PLATFORM_HINTS[_ctx.platform]?.rules || ''}`,
          `Write the first 3 posts of this plan as one-line hooks (max 100 chars each), each prefixed "Day N:". Grounded in the plan only.`,
        ].join('\n'), 120000, _ctx.model, signal, { platform: _ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
    ],
  },
  {
    kind: 'autopsy',
    explain: "Needs your own logged results (Winners page) → 1) finds what your best-performing posts share (structure, tone, length, CTA), 2) turns it into a 6-step checklist to run before every post, plus one thing to stop doing.",
    name: 'Winners autopsy',
    tagline: 'why your best posts worked, as a repeatable playbook',
    needsWinners: true,
    steps: [
      {
        name: 'extract', label: 'Extract patterns',
        run: (ctx, signal) => smartAI([
          `THE USER'S OWN POST RESULTS (engagement logged by them):\n${ctx.winners}`,
          `For context, public winners in their niche:\n${ctx.picks}`,
          `Name what the user's top posts share: structural pattern, emotional register, topic, length, CTA style. 3 bullets max, plain text.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
      {
        name: 'playbook', label: 'Repeatable playbook',
        run: (ctx, signal) => smartAI([
          `Patterns:\n${ctx.notes[0] || ''}`,
          GROUND,
          `Turn the analysis into a 6-line repeatable checklist the user can run before every post ("1. ..."), ending with one sentence: what to stop doing.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(r => r.out || Promise.reject(new Error(r.errors.join(' | ')))),
      },
    ],
  },
];

export function agentCatalog() {
  return AGENTS.map(a => ({
    kind: a.kind, name: a.name, tagline: a.tagline, explain: a.explain || '',
    stepLabels: a.steps.map(s => s.label),
    needsWinners: !!a.needsWinners, steps: a.steps.length,
  }));
}

// ---------------- persistence helpers ----------------
const rowToJob = (r: NonNullable<ReturnType<ReturnType<typeof getStore>['getJobRow']>>): JobRow => {
  let steps: JobStep[] = [];
  try { steps = JSON.parse(r.steps); } catch {}
  return { ...r, steps, status: r.status as JobStatus };
};

const persist = (id: string, patch: { status?: JobStatus; steps?: JobStep[]; result?: string; err?: string; started?: number | null; finished?: number | null }) => {
  getStore().saveJob(id, {
    ...patch,
    steps: patch.steps ? JSON.stringify(patch.steps) : undefined,
  });
};

function reconcile() {
  // jobs whose runner died with a previous server process → honest "interrupted"
  const store = getStore();
  for (const r of store.allJobs()) {
    if (['queued', 'running', 'paused'].includes(r.status) && !rt().rts.has(r.id)) {
      store.saveJob(r.id, { status: 'interrupted', err: 'server restarted mid-run' });
    }
  }
}

// ---------------- runner ----------------
async function runJob(id: string, kind: string, ctxPromise: Promise<Ctx>) {
  const ru = rt().rts.get(id)!;
  const def = AGENTS.find(a => a.kind === kind)!;
  // status reads go through a function so control-flow analysis can't narrow
  // the property between the loop mutations and the checks
  const st0 = (): JobStatus => rt().rts.get(id)?.status ?? ru.status;
  try {
    const ctx = await ctxPromise;
    ru.status = 'running' as JobStatus; persist(id, { status: 'running' });
    for (let i = 0; i < def.steps.length; i++) {
      // pause gate — hold between steps; abort if stopped
      while (st0() === 'paused') await sleep(400, ru.abort.signal);
      if (st0() === 'stopped') throw new Error('__stopped__');

      const st = ru.steps[i];
      st.state = 'active'; persist(id, { steps: ru.steps });
      const t0 = Date.now();
      try {
        const out = await def.steps[i].run(ctx, ru.abort.signal);
        st.state = 'done';
        st.dur = Math.round((Date.now() - t0) / 1000);
        st.note = `${out.length} chars · ${st.dur}s`;
        ctx.notes.push(out);
      } catch (e: any) {
        if (st0() === 'stopped') {
          for (let k = i; k < ru.steps.length; k++) { ru.steps[k].state = 'skipped'; ru.steps[k].note = 'stopped'; }
          throw new Error('__stopped__');
        }
        st.state = 'failed';
        st.note = String(e.message).split('\n')[0].slice(0, 160);
        throw e;
      }
      persist(id, { steps: ru.steps });
    }
    const result = [
      `TOPIC: ${ctx.topic} · PLATFORM: ${ctx.platformLabel}`,
      ...ru.steps.map((s, i) => `\n── ${s.label} ──\n${ctx.notes[i]}`),
    ].join('\n');
    ru.result = result;
    ru.status = 'done' as JobStatus; persist(id, { status: 'done', steps: ru.steps, result, finished: Date.now() });
  } catch (e: any) {
    if (e?.message === '__stopped__' || st0() === 'stopped') {
      ru.status = 'stopped' as JobStatus; persist(id, { status: 'stopped', steps: ru.steps, finished: Date.now() });
    } else {
      ru.status = 'failed' as JobStatus; persist(id, { status: 'failed', steps: ru.steps, err: String(e?.message || 'unknown').slice(0, 300), finished: Date.now() });
    }
  } finally {
    rt().rts.delete(id);
  }
}

// ---------------- public API (used by /api/jobs routes) ----------------
export function jobsList(): JobRow[] {
  reconcile();
  return getStore().allJobs().map(r => {
    const live = rt().rts.get(r.id); // live status edge (paused between DB writes)
    return rowToJob({ ...r, status: (live?.status ?? r.status) as JobStatus });
  });
}

export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export function createJob(input: { kind?: string; topic?: string; platform?: string; model?: { providerID?: string; id?: string } | null }): CreateResult {
  const kind = String(input.kind || '');
  const def = AGENTS.find(a => a.kind === kind);
  if (!def) return { ok: false, error: 'unknown agent kind' };
  const payload = allPayload();
  if (def.needsWinners && !(payload.manual?.length)) return { ok: false, error: 'no results yet — Generate saves its outputs to Winners automatically' };

  const id = 'job' + Date.now().toString(36) + Math.floor(Math.random() * 900 + 100).toString(36);
  const steps: JobStep[] = def.steps.map(s => ({ name: s.name, label: s.label, state: 'pending' as StepState }));
  const model = input.model?.providerID && input.model?.id ? { providerID: String(input.model.providerID).slice(0, 20), id: String(input.model.id).slice(0, 60) } : null;
  getStore().addJob({ id, kind, topic: String(input.topic || '').slice(0, 80), platform: String(input.platform || 'x').slice(0, 12), steps: JSON.stringify(steps), created: Date.now(), model: model ? model.providerID + '|' + model.id : '' });

  const rt1: Runtime = { status: 'queued', steps, result: '', abort: new AbortController() };
  rt().rts.set(id, rt1);
  const ctxPromise = buildCtx(kind, String(input.topic || '').slice(0, 80), String(input.platform || 'x').slice(0, 12), model);
  void runJob(id, kind, ctxPromise); // fire-and-forget — the server process owns it
  return { ok: true, id };
}

export function jobAction(id: string, action: string): { ok: boolean; error?: string } {
  const ru = rt().rts.get(id);
  if (!ru) return { ok: false, error: 'job has no active runner (already finished, or server restarted)' };
  if (action === 'pause' && ru.status === 'running') {
    ru.status = 'paused'; persist(id, { status: 'paused' });
    return { ok: true };
  }
  if (action === 'resume' && ru.status === 'paused') {
    ru.status = 'running'; persist(id, { status: 'running' });
    return { ok: true };
  }
  if (action === 'stop' && ['queued', 'running', 'paused'].includes(ru.status)) {
    ru.status = 'stopped';
    ru.abort.abort();                 // kills the in-flight AI call
    persist(id, { status: 'stopped' });
    return { ok: true };
  }
  return { ok: false, error: `action "${action}" is not valid while the job is ${ru.status}` };
}

export function deleteJob(id: string): { ok: boolean } {
  const ru = rt().rts.get(id);
  if (ru) { ru.status = 'stopped'; ru.abort.abort(); rt().rts.delete(id); }
  getStore().delJob(id);
  return { ok: true };
}
