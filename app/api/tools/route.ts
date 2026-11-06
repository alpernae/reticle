import { NextResponse } from 'next/server';
import { smartAI } from '@/lib/aichain';
import { buildToolPrompt, grounding } from '@/lib/tool-prompts';
import { TOOLS, TOOL_PLATFORMS, type ToolPlatform } from '@/lib/tools';
import { fitScorer } from '@/lib/score';
import { analyze } from '@/lib/patterns';
import { allPayload } from '@/lib/engine';
import { tracked, RunCancelled } from '@/lib/activity';
import { toolFormat } from '@/lib/playbook';
import { checkReply, detectConstraint } from '@/lib/replies';
import { fitToLimit, type LengthInfo } from '@/lib/enforce';

// tools whose items are posts with a hard platform limit (bios have their own, shown in the UI)
const LIMITED = new Set(['caption', 'pinned', 'repurpose', 'replies']);

// tools whose output is a post you publish — those get a pattern-fit score
// (replies are excluded: the fit score is built from POST patterns and says nothing about replies)
const POSTABLE = new Set(['caption', 'repurpose', 'pinned', 'hooks', 'thread']);

export const maxDuration = 240;

const isPlat = (p: string): p is ToolPlatform => TOOL_PLATFORMS.some(x => x.key === p);

/** POST { tool, platform, input: {...}, model? } → { items? | text? | slides?, via, ms, postsOnPlatform, runId }
 *  Every call is recorded on the Activity page (result kept even if you leave the page). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const platform = String(body?.platform || '');
  if (!isPlat(platform)) return NextResponse.json({ error: 'platform must be instagram, x, linkedin or youtube' }, { status: 400 });
  // Only the fields this tool defines are used and recorded — stray fields from another
  // tool (e.g. a caption's topic/cta sent along with a reply request) are dropped.
  const def = TOOLS.find(t => t.key === String(body?.tool || ''));
  const allowed = new Set((def?.fields || []).map(f => f.key));
  const input: Record<string, string> = {};
  for (const [k, v] of Object.entries(body?.input || {})) if (allowed.has(k) && typeof v === 'string' && v.trim()) input[k] = v;
  let built;
  try { built = buildToolPrompt(String(body?.tool || ''), platform, input); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
  const pinned = body?.model?.providerID && body?.model?.id ? body.model : null;
  const tool = built.tool;
  // title = the tool's main free-text field (its first textarea/text), e.g. the post being replied to
  const mainField = tool.fields.find(f => f.kind !== 'select' && input[f.key]);
  const topic = mainField ? input[mainField.key].replace(/\s+/g, ' ').slice(0, 60) : '';

  try {
    const result = await tracked({
      kind: 'tool', title: `${tool.name} · ${platform}${topic ? ` — ${topic}` : ''}`, page: `/toolkit?p=${platform}&t=${tool.key}`,
      platform, input: { tool: tool.key, ...input }, model: pinned,
    }, async run => {
      run.step(`Asking ${pinned ? `${pinned.providerID} · ${pinned.id}` : 'the AI (auto provider)'}`);
      const r = await smartAI(built.prompt, 200000, pinned, run.signal, { platform, format: toolFormat(tool.key, platform), role: tool.key });
      run.via(r.model);
      if (!r.out) return { error: r.errors.join(' | ') || 'AI unavailable' } as Record<string, unknown>;
      run.step('Parsing the answer');
      const g = grounding(platform);
      const meta = { tool: tool.key, via: r.model, ms: r.ms, postsOnPlatform: g.postsOnPlatform, ...(tool.key === 'hashtags' ? { dataHashtags: g.hashtags.slice(0, 24) } : {}) };
      const out = r.out.replace(/^```\w*\n?|\n?```$/g, '').trim();
      if (tool.output === 'slides') {
        try {
          const arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1));
          const slides = (Array.isArray(arr) ? arr : []).map((s: any) => ({ title: String(s.title || '').slice(0, 120), body: String(s.body || '').slice(0, 400) })).filter((s: any) => s.title || s.body).slice(0, 12);
          if (!slides.length) throw new Error('empty');
          return { slides, ...meta };
        } catch { return { error: 'AI answer was not valid slide JSON — try again', raw: out.slice(0, 1500), ...meta }; }
      }
      const fit = POSTABLE.has(tool.key) ? fitScorer(analyze(allPayload().posts), platform) : null;
      const ctx = { platform, format: toolFormat(tool.key, platform), role: tool.key };
      if (tool.output === 'single') {
        // threads: every post must fit; the app counts, the model shortens what's over
        const fitted = tool.key === 'thread' ? await fitToLimit(r.out.trim(), platform, platform === 'threads' ? 'th-chain' : 'x-thread', { pinned, signal: run.signal, ctx, thread: true }) : null;
        if (fitted?.info.shortened) run.step(`Shortened thread posts to fit ${fitted.info.limit}`);
        const text = fitted ? fitted.text : r.out.trim();
        if (fit) run.step('Scoring pattern fit');
        return { text, length: fitted?.info, ...meta, fit: fit ? fit(text) : undefined };
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
        const fitted = await Promise.all(items.map(it => fitToLimit(it, platform, toolFormat(tool.key, platform), { pinned, signal: run.signal, ctx })));
        const n = fitted.filter(f => f.info.shortened).length;
        if (n) run.step(`Shortened ${n} draft${n > 1 ? 's' : ''} to fit ${fitted[0].info.limit} characters`);
        items = fitted.map(f => f.text);
        lengths = fitted.map(f => f.info);
      }
      if (fit) run.step('Scoring pattern fit');
      return {
        items, lengths, ...meta,
        ...(checks ? { replyChecks: checks.map(({ style, ok, why }) => ({ style, ok, why })) } : {}),
        fits: fit ? items.map(fit) : undefined,
      };
    }, (o: any) => (o.error ? String(o.error) : null));
    return NextResponse.json(result, { status: (result as any).error ? 502 : 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e instanceof RunCancelled ? 'cancelled' : String(e?.message || e) }, { status: e instanceof RunCancelled ? 499 : 500 });
  }
}
