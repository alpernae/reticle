// lib/application/tools.ts — the Toolkit use case.
//
// One entry point for every Toolkit tool: validate the input fields, build the
// prompt, ask the AI, parse the answer, enforce platform limits and score the
// pattern fit. The HTTP route (app/api/tools) and the automation runner
// (lib/automations.ts) both call it.
import 'server-only';
import { smartAI } from '../aichain';
import { buildToolPrompt, grounding } from '../tool-prompts';
import { TOOLS, TOOL_PLATFORMS, type ToolPlatform } from '../tools';
import { fitScorer } from '../domain/score';
import { analyze } from '../domain/patterns';
import { allPayload } from '../engine';
import { toolFormat } from '../playbook';
import { checkReply, detectConstraint } from '../domain/replies';
import { fitToLimit, type LengthInfo } from '../enforce';
import { readTimezone } from '../timezone-store';
import type { UseCaseResult } from './drafts';
import type { WorkCtx } from './tasks';

// tools whose items are posts with a hard platform limit (bios have their own, shown in the UI)
const LIMITED = new Set(['caption', 'pinned', 'repurpose', 'replies']);

// tools whose output is a post you publish — those get a pattern-fit score
// (replies are excluded: the fit score is built from POST patterns and says nothing about replies)
const POSTABLE = new Set(['caption', 'repurpose', 'pinned', 'hooks', 'thread']);

export type ToolInput = {
  tool?: string; platform?: string; input?: Record<string, unknown>;
  model?: { providerID: string; id: string } | null;
};

const isPlat = (p: string): p is ToolPlatform => TOOL_PLATFORMS.some(x => x.key === p);

/** Run one Toolkit tool and return its parsed result. */
export async function runTool(body: ToolInput, ctx: WorkCtx): Promise<UseCaseResult> {
  const platform = String(body?.platform || '');
  if (!isPlat(platform)) {
    const msg = 'platform must be instagram, x, linkedin or youtube';
    return { status: 400, body: { error: msg }, failure: msg };
  }
  // Only the fields this tool defines are used and recorded — stray fields from another
  // tool (e.g. a caption's topic/cta sent along with a reply request) are dropped.
  const def = TOOLS.find(t => t.key === String(body?.tool || ''));
  const allowed = new Set((def?.fields || []).map(f => f.key));
  const input: Record<string, string> = {};
  for (const [k, v] of Object.entries(body?.input || {})) if (allowed.has(k) && typeof v === 'string' && v.trim()) input[k] = v;
  let built;
  try { built = buildToolPrompt(String(body?.tool || ''), platform, input); }
  catch (e: any) { const msg = String(e?.message || e); return { status: 400, body: { error: msg }, failure: msg }; }
  const pinned = body?.model?.providerID && body?.model?.id ? body.model : null;
  const tool = built.tool;
  // title = the tool's main free-text field (its first textarea/text), e.g. the post being replied to
  const mainField = tool.fields.find(f => f.kind !== 'select' && input[f.key]);
  const topic = mainField ? input[mainField.key].replace(/\s+/g, ' ').slice(0, 60) : '';
  const title = `${tool.name} · ${platform}${topic ? ` — ${topic}` : ''}`;

  try {
    ctx.step(`Asking ${pinned ? `${pinned.providerID} · ${pinned.id}` : 'the AI (auto provider)'}`);
    const r = await smartAI(built.prompt, 200000, pinned, ctx.signal, { platform, format: toolFormat(tool.key, platform), role: tool.key });
    ctx.via(r.model);
    if (!r.out) {
      const msg = r.errors.join(' | ') || 'AI unavailable';
      return { status: 502, title, body: { error: msg }, failure: msg };
    }
    ctx.step('Parsing the answer');
    const g = grounding(platform);
    const meta = { tool: tool.key, via: r.model, ms: r.ms, postsOnPlatform: g.postsOnPlatform, ...(tool.key === 'hashtags' ? { dataHashtags: g.hashtags.slice(0, 24) } : {}) };
    const out = r.out.replace(/^```\w*\n?|\n?```$/g, '').trim();
    if (tool.output === 'slides') {
      try {
        const arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
        const slides = (Array.isArray(arr) ? arr : []).map((s: any) => ({ title: String(s.title || '').slice(0, 120), body: String(s.body || '').slice(0, 400) })).filter((s: any) => s.title || s.body).slice(0, 12);
        if (!slides.length) throw new Error('empty');
        return { status: 200, title, body: { slides, ...meta } };
      } catch {
        const msg = 'AI answer was not valid slide JSON — try again';
        return { status: 502, title, body: { error: msg, raw: out.slice(0, 1500), ...meta }, failure: msg };
      }
    }
    const fit = POSTABLE.has(tool.key) ? fitScorer(analyze(allPayload().posts, readTimezone()), platform) : null;
    const fitCtx = { platform, format: toolFormat(tool.key, platform), role: tool.key };
    if (tool.output === 'single') {
      // threads: every post must fit; the app counts, the model shortens what's over
      const fitted = tool.key === 'thread' ? await fitToLimit(r.out.trim(), platform, platform === 'threads' ? 'th-chain' : 'x-thread', { pinned, signal: ctx.signal, ctx: fitCtx, thread: true }) : null;
      if (fitted?.info.shortened) ctx.step(`Shortened thread posts to fit ${fitted.info.limit}`);
      const text = fitted ? fitted.text : r.out.trim();
      if (fit) ctx.step('Scoring pattern fit');
      return { status: 200, title, body: { text, length: fitted?.info, ...meta, fit: fit ? fit(text) : undefined } };
    }
    let items = r.out.split(/\n?\s*===ITEM===\s*\n?/).map(s => s.replace(/^\s*(\d+[.)]\s+)/, '').trim()).filter(s => s.length > 1).slice(0, 12);
    let checks: ReturnType<typeof checkReply>[] | null = null;
    if (tool.key === 'replies') { // style label + rule check; replies that obey the post's game come first
      const rule = detectConstraint(String(input.source || ''));
      checks = items.map(it => checkReply(it, rule)).sort((a, b) => Number(b.ok === true) - Number(a.ok === true));
      items = checks.map(c => c.text);
      (meta as Record<string, unknown>).rule = rule?.label || null;
    }
    // posts must fit the platform limit as the platform counts it — fix the ones that don't
    let lengths: LengthInfo[] | undefined;
    if (LIMITED.has(tool.key)) {
      const fitted = await Promise.all(items.map(it => fitToLimit(it, platform, toolFormat(tool.key, platform), { pinned, signal: ctx.signal, ctx: fitCtx })));
      const n = fitted.filter(f => f.info.shortened).length;
      if (n) ctx.step(`Shortened ${n} draft${n > 1 ? 's' : ''} to fit ${fitted[0].info.limit} characters`);
      items = fitted.map(f => f.text);
      lengths = fitted.map(f => f.info);
    }
    if (fit) ctx.step('Scoring pattern fit');
    return {
      status: 200, title,
      body: {
        items, lengths, ...meta,
        ...(checks ? { replyChecks: checks.map(({ style, ok, why }) => ({ style, ok, why })) } : {}),
        fits: fit ? items.map(fit) : undefined,
      },
    };
  } catch (e: any) {
    if (ctx.signal.aborted) throw e; // cancelled — the worker turns this into a cancelled task
    const msg = String(e?.message || e).slice(0, 300);
    return { status: 500, title, body: { error: msg }, failure: msg };
  }
}
