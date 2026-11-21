// lib/application/workflows.ts — the Studio agents (multi-step AI workflows).
//
// A workflow is a sequence of transparent steps; every step is one AI call.
// The catalog and the runner live here, free of any task machinery: the task
// worker calls `runAgentSteps` (lib/application/task-handlers.ts) and
// lib/jobs.ts reads the tasks back for the Studio page.
//
// The runner is resumable: the notes of the steps that already finished are
// passed in, so a task that was interrupted continues where it stopped instead
// of paying for the same AI calls twice.
import 'server-only';
import { analysisDigest, digestText, topPosts, allPayload, PLATFORM_HINTS } from '../engine';
import { smartAI, type AIModelRef } from '../aichain';

export type AgentCtx = {
  topic: string; platform: string; platformLabel: string;
  digest: string; digestive: ReturnType<typeof analysisDigest>;
  picks: string; winners: string; notes: string[];
  model: AIModelRef | null; // per-run provider/model pick (null = Settings order)
};

export type AgentStep = {
  name: string; label: string;
  run: (ctx: AgentCtx, signal: AbortSignal) => Promise<string>;
};

export type AgentDef = {
  kind: string; name: string; tagline: string;
  explain?: string; // plain-language: what it reads, what it does, what you get
  needsWinners?: boolean;
  steps: AgentStep[];
};

const GROUND = 'RULES: quote only figures present in the supplied digest data. If a number does not appear there, do not invent it. Plain text, no markdown headings.';

/** The AI's answer, or a readable failure ("no AI provider answered" when the
 *  provider chain had nothing to try — every provider is switched off). */
const answer = (r: { out: string; errors: string[] }): Promise<string> =>
  r.out ? Promise.resolve(r.out) : Promise.reject(new Error(r.errors.join(' | ') || 'no AI provider answered'));

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
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(answer),
      },
      {
        name: 'angles', label: 'Post angles',
        run: (ctx, signal) => smartAI([
          `TOPIC: "${ctx.topic}". Your earlier research of it:\n${ctx.notes[0] || ''}`,
          GROUND,
          `Produce exactly 4 post angles for a dev & cybersecurity creator, one per line: "· CONTRARIAN: ...", "· DATA: ...", "· GUIDE: ...", "· STORY: ...". Each under 30 words, each using at least one concrete fact from the research.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(answer),
      },
      {
        name: 'draft', label: 'Full draft',
        run: (ctx, signal) => smartAI([
          `TOPIC: "${ctx.topic}". Platform: ${ctx.platformLabel}. Format rules: ${PLATFORM_HINTS[ctx.platform]?.rules || ''}`,
          `Research:\n${ctx.notes[0] || ''}\nAngles:\n${ctx.notes[1] || ''}`,
          GROUND,
          `Pick the strongest angle and write ONE full post, ready to publish, in the ${ctx.platform} format. No preamble, no title line — just the post body.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(answer),
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
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(answer),
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
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(answer),
      },
      {
        name: 'firsts', label: 'Write first 3',
        run: (_ctx, signal) => smartAI([
          `Plan:\n${(_ctx.notes[0] || '')}\nPlatform rules: ${PLATFORM_HINTS[_ctx.platform]?.rules || ''}`,
          `Write the first 3 posts of this plan as one-line hooks (max 100 chars each), each prefixed "Day N:". Grounded in the plan only.`,
        ].join('\n'), 120000, _ctx.model, signal, { platform: _ctx.platform, role: 'workflow' }).then(answer),
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
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(answer),
      },
      {
        name: 'playbook', label: 'Repeatable playbook',
        run: (ctx, signal) => smartAI([
          `Patterns:\n${ctx.notes[0] || ''}`,
          GROUND,
          `Turn the analysis into a 6-line repeatable checklist the user can run before every post ("1. ..."), ending with one sentence: what to stop doing.`,
        ].join('\n'), 120000, ctx.model, signal, { platform: ctx.platform, role: 'workflow' }).then(answer),
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

/** Build the ground-truth context every agent reads. */
export async function buildAgentCtx(kind: string, topic: string, platform: string, model: AIModelRef | null = null): Promise<AgentCtx> {
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

export type AgentStepResult = { label: string; text: string; ms: number };

/**
 * Run the agent's steps. `done` holds the notes of the steps that already
 * finished (from the task checkpoint) — those steps are skipped.
 *
 * `onStart` is called before a step runs, `onDone` after it produced text.
 */
export async function runAgentSteps(
  def: AgentDef,
  ctx: AgentCtx,
  signal: AbortSignal,
  done: string[],
  onStart: (index: number, label: string) => void,
  onDone: (index: number, label: string, text: string, ms: number) => void,
): Promise<{ result: string; steps: AgentStepResult[] }> {
  const notes = [...done];
  ctx.notes = notes; // a resumed run starts with the notes it already has
  const results: AgentStepResult[] = [];
  for (let i = 0; i < def.steps.length; i++) {
    if (i < notes.length) { // already finished in an earlier run
      results.push({ label: def.steps[i].label, text: notes[i], ms: 0 });
      continue;
    }
    if (signal.aborted) throw new Error('cancelled');
    onStart(i, def.steps[i].label);
    const t0 = Date.now();
    const text = await def.steps[i].run(ctx, signal);
    const ms = Date.now() - t0;
    notes.push(text);
    ctx.notes = notes;
    results.push({ label: def.steps[i].label, text, ms });
    onDone(i, def.steps[i].label, text, ms);
  }
  const result = [
    `TOPIC: ${ctx.topic} · PLATFORM: ${ctx.platformLabel}`,
    ...results.map((s, i) => `\n── ${s.label} ──\n${s.text}`),
  ].join('\n');
  return { result, steps: results };
}
