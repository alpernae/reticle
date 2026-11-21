// lib/application/formats.ts — the Formats use cases: quick posts and the
// series-post polish.
//
// Both are AI calls that used to run inside the request (and be recorded in
// the Activity log). They are now use cases the task worker runs: the route
// enqueues a task and waits for it, and the steps land in the task's event log.
import 'server-only';
import { smartAI } from '../aichain';
import { AUDIENCES, QUICK_FORMATS } from '../formats';
import { allPayload } from '../engine';
import { analyze, winners } from '../domain/patterns';
import { fitScorer } from '../domain/score';
import { readTimezone } from '../timezone-store';
import type { UseCaseResult } from './drafts';
import type { WorkCtx } from './tasks';

export type QuickInput = {
  format?: string; audience?: string; platform?: string; count?: number | string;
  idea?: string; model?: { providerID: string; id: string } | null;
};

export type PolishSeriesInput = {
  text?: string; model?: { providerID: string; id: string } | null;
};

/** Split on lines of '---' that are NOT inside a ``` fenced code block. */
function splitOutsideFences(s: string): string[] {
  const out: string[] = [];
  let cur: string[] = [], inFence = false;
  for (const line of s.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && /^\s*---+\s*$/.test(line)) { out.push(cur.join('\n')); cur = []; continue; }
    cur.push(line);
  }
  out.push(cur.join('\n'));
  return out;
}

/** Write N short posts in one chosen format, grounded in the creator's data. */
export async function quickPosts(body: QuickInput, ctx: WorkCtx): Promise<UseCaseResult> {
  const pinned = body.model?.providerID && body.model?.id ? body.model : null;
  const f = QUICK_FORMATS.find(x => x.key === body.format) || QUICK_FORMATS[0];
  const aud = AUDIENCES.find(x => x.key === body.audience) || AUDIENCES[0];
  const count = Math.max(1, Math.min(10, Number(body.count) || 5));
  const platform = String(body.platform || 'x');

  // ground in real winners of the same shape when we have them
  const rows = analyze(allPayload().posts, readTimezone());
  const shape = rows.filter(r => r.words <= 30 && (f.key === 'poll' ? /\n\s*[-•]/.test(r.body || '') : f.key === 'convince' ? /convince me|change my mind/i.test(r.body || '') : r.hook === 'question' || r.hook === 'engagement-ask'));
  const ex = winners(shape, { limit: 5 }).map(w => `- "${(w.body || w.title).replace(/\s+/g, ' ').slice(0, 160)}" (${w.outlier}× vs creator's normal, @${w.author || '?'})`).join('\n');

  const prompt = `FORMAT: ${f.name}. ${f.brief}
    EXAMPLE OF THE SHAPE (do not reuse its wording): ${JSON.stringify(f.example)}
    AUDIENCE: ${aud.label}${aud.key === 'mix' ? ' — rotate across mobile developers, SaaS/startup founders and security researchers' : aud.key === 'bridge' ? ' — questions that connect security with building apps/SaaS (where the two worlds meet)' : ''}.
    PLATFORM: ${platform}. Keep each post short (under 220 characters unless the format needs a snippet).
    ${ex ? `SAME-SHAPE POSTS THAT WON IN THE DATA:\n${ex}\n` : ''}${body.idea ? `CREATOR'S ANGLE / CONTEXT: ${String(body.idea).slice(0, 600)}\n` : ''}
    TASK: Write ${count} different posts in this format for the creator. Each must be specific to the audience (name real tools, stacks, bug classes, platforms they use), answerable in one reply, and honest — no fake numbers, no rage bait, no follow-for-follow. Vary the topics.
    OUTPUT: the posts only, separated by a line containing exactly ===POST===`;

  ctx.step(`Asking ${pinned ? `${pinned.providerID} · ${pinned.id}` : 'the AI (auto provider)'}`);
  const r = await smartAI(prompt, 180000, pinned, ctx.signal, { platform, role: 'quick-' + f.key });
  ctx.via(r.model);
  if (!r.out) {
    const msg = r.errors.join(' | ') || 'AI unavailable';
    return { status: 502, body: { error: msg }, failure: msg };
  }
  // ===POST=== can't collide with code; fall back to fence-aware '---' splitting for older answers
  const parts = r.out.includes('===POST===') ? r.out.split(/\n?\s*===POST===\s*\n?/) : splitOutsideFences(r.out);
  const posts = parts.map(s => s.replace(/^\s*(\d+[.)]|#\d+:?)\s*/, '').trim()).filter(s => s.length > 5).slice(0, count);
  const fit = fitScorer(rows, platform);
  return {
    status: 200,
    body: {
      posts, fits: posts.map(p => fit(p.replace(/```[\s\S]*?```/g, '').replace(/\n?\s*ANSWER\s*:[\s\S]*$/i, ''))),
      via: r.model, ms: r.ms, grounded: !!ex,
    },
  };
}

/** Improve the free-text parts of a daily series post — keeping every number. */
export async function polishSeries(body: PolishSeriesInput, ctx: WorkCtx): Promise<UseCaseResult> {
  const pinned = body.model?.providerID && body.model?.id ? body.model : null;
  const text = String(body.text || '').slice(0, 2000);
  ctx.step(`Asking ${pinned ? `${pinned.providerID} · ${pinned.id}` : 'the AI (auto provider)'}`);
  const r = await smartAI(`Here is the creator's daily series post:
---
${text}
---
Improve ONLY the free-text parts (e.g. focus, lesson, shipped, blocker lines) so they are specific, punchy and in the creator's voice, and add at most ONE short line (≤ 90 chars) right after the headline that gives readers a reason to follow the series.
HARD RULES: keep the headline, every emoji label and EVERY number/amount exactly as written (including "$?" and 0). Do not add statistics. Do not name companies or bug bounty programs. Return only the final post text.`, 90000, pinned, ctx.signal, { platform: 'x', role: 'polish' });
  ctx.via(r.model);
  if (!r.out) {
    const msg = r.errors.join(' | ') || 'AI unavailable';
    return { status: 502, body: { error: msg }, failure: msg };
  }
  const out = r.out.replace(/^```\w*\n?|```$/g, '').trim();
  // guard: every number in the original must survive
  const nums = (s: string) => (s.match(/\$?\d[\d,.]*|\$\?/g) || []).map(x => x.replace(/[,.]$/, ''));
  const missing = nums(text).filter(n => !out.includes(n));
  if (missing.length) {
    const msg = `AI changed your numbers (${missing.slice(0, 4).join(', ')}) — kept your original.`;
    return { status: 502, body: { error: msg, text }, failure: msg };
  }
  return { status: 200, body: { text: out, via: r.model } };
}
