// lib/application/polish.ts — revise ONE generated draft without re-running
// the whole generation.
//
// Grounded: the creator's original brief is the only source of facts, and the
// platform's pattern table + top winner structure keep the revision on a
// winning shape.
import 'server-only';
import { smartAI } from '../aichain';
import { allPayload } from '../engine';
import { analyze, patternLibrary, patternTable, winners, winnerCard } from '../domain/patterns';
import { fitScorer } from '../domain/score';
import { PLATFORM_LIMITS } from '../tools';
import { fitToLimit } from '../enforce';
import { readTimezone } from '../timezone-store';
import type { UseCaseResult } from './drafts';
import type { WorkCtx } from './tasks';

export type PolishInput = {
  text?: string; instruction?: string; platform?: string; format?: string | null;
  brief?: string; score?: boolean; model?: { providerID: string; id: string } | null;
};

export async function polishDraft(body: PolishInput, ctx: WorkCtx): Promise<UseCaseResult> {
  const text = String(body?.text || '').slice(0, 6000);
  const instruction = String(body?.instruction || '').slice(0, 2000).trim();
  const platform = String(body?.platform || 'x');
  const format = body?.format ? String(body.format) : null;
  const brief = String(body?.brief || '').slice(0, 4000).trim();
  const score = body?.score !== false;
  const pinned = body?.model?.providerID && body?.model?.id ? body.model : null;
  if (!text.trim() || !instruction) return { status: 400, body: { error: 'text and instruction are required' } };

  const rows = analyze(allPayload().posts, readTimezone());
  const mine = rows.filter(r => r.source === platform);
  const pool = mine.length >= 8 ? mine : rows;
  const lim = (PLATFORM_LIMITS as Record<string, { post: number; note: string }>)[platform];
  const prompt = `You are revising ONE existing draft. Do NOT start over — keep what already works and change what the instruction asks.

${brief ? `THE CREATOR'S ORIGINAL BRIEF (the ONLY source of facts — names, features, links, prerequisites. Never add claims, numbers or features that aren't here):\n---\n${brief}\n---\n` : 'No brief was given: do not add any new facts, numbers or claims; only rephrase and restructure.\n'}
CURRENT DRAFT:
---
${text}
---

WHAT TO CHANGE: ${instruction}

STAY ON A WINNING SHAPE (evidence from collected ${pool === mine ? platform : 'all-platform'} posts):
${patternTable(patternLibrary(pool), pool === mine ? platform : undefined, 8)}
Structure reference (learn the shape, never copy words):
${winners(pool, { limit: 2 }).map((w, i) => winnerCard(w, i, 220)).join('\n')}

RULES:
- Apply the instruction fully. Keep the hook type, length and formatting that the pattern table favours unless the instruction says otherwise.
- Pass the clarity check: a reader must understand WHAT it is, WHO it's for and any prerequisite from the brief.
- Stay within the platform limit${lim ? ` (${lim.note})` : ''}. Keep [placeholders] for anything only the creator knows.
- If a link belongs in the first reply (X) or first comment (LinkedIn), do NOT leave it in the post: put it inside the REVISED section as its last line, exactly "FIRST REPLY: <short text + the link>".
- Don't make it sound more certain than the brief supports — no invented results, users, benchmarks or guarantees.

OUTPUT exactly:
===REVISED===
<the full revised draft, ready to post>
===CHANGES===
- <2–4 short bullets: what you changed and why>`;

  ctx.step(`Revising with ${pinned ? `${pinned.providerID} · ${pinned.id}` : 'the AI (auto provider)'}`);
  const r = await smartAI(prompt, 150000, pinned, ctx.signal, { platform, format, role: 'refine' });
  ctx.via(r.model);
  if (!r.out) {
    const msg = r.errors.join(' | ') || 'AI unavailable';
    return { status: 502, body: { error: msg }, failure: msg };
  }
  ctx.step('Checking the revision');
  const m = /===REVISED===\s*([\s\S]*?)\s*(?:===CHANGES===\s*([\s\S]*))?$/.exec(r.out);
  const revised = (m?.[1] || r.out).replace(/^```\w*\n?|\n?```$/g, '').trim();
  // the model's own length claims ("~270 chars") are unreliable — drop them, the app counts
  const changes = (m?.[2] || '').split('\n').map(s => s.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean)
    .filter(c => !/\b(\d+\s*char|characters?\b.*\d|under the limit|within the limit)/i.test(c)).slice(0, 5);
  const fitCtx = { platform, format, role: 'refine' };
  const fitted = await fitToLimit(revised, platform, format, { pinned, signal: ctx.signal, ctx: fitCtx, thread: format === 'x-thread' || format === 'th-chain' });
  if (fitted.info.shortened) { ctx.step(`Shortened to fit ${fitted.info.limit} characters`); changes.push(`Shortened to ${fitted.info.length}/${fitted.info.limit} characters (counted the way ${platform === 'x' ? 'X' : platform} counts).`); }
  if (fitted.info.firstReply) changes.push('Moved the link to a separate first reply (copy it after posting).');
  const fit = score ? fitScorer(rows, platform) : null;
  return {
    status: 200,
    body: {
      text: fitted.text, firstReply: fitted.info.firstReply, length: fitted.info, changes,
      fitBefore: fit ? fit(text) : undefined, fitAfter: fit ? fit(fitted.text) : undefined,
      via: r.model, ms: r.ms,
    },
  };
}
