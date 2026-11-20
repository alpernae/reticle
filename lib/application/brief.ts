// lib/application/brief.ts — the Overview growth brief.
//
// The AI reads a SQL-backed digest of the whole database (source mix, rising
// topics, top-engaged posts, posting-hour histogram, hook patterns) and writes
// a short factual brief. The result is stored in the meta table and re-served
// by /api/state until the next run. If every AI lane is out of quota, a
// rules-based stats summary is stored instead (mode 'stats').
import 'server-only';
import { analysisDigest, digestText, statsSummary, markAnalysis, markAI } from '../engine';
import { smartAI } from '../aichain';
import type { UseCaseResult } from './drafts';
import type { WorkCtx } from './tasks';

export type BriefInput = { model?: { providerID: string; id: string } | null };

export async function growthBrief(body: BriefInput, ctx: WorkCtx): Promise<UseCaseResult> {
  const pinned = body.model?.providerID && body.model?.id ? body.model : null;
  const digest = analysisDigest();
  if (digest.total === 0) {
    return { status: 200, body: { mode: 'none', text: '', hint: 'No posts in the database yet — run a collector on Sources first.' } };
  }

  const prompt = `DATA DIGEST (SQLite aggregates + outlier winners — the only source of truth, never invent numbers outside it):
${digestText(digest)}

TASK: Write a short, factual brief of AT MOST 170 words in exactly this shape:
1) 3 bullet insights — one names the strongest winning PATTERN (format/hook + its lift or outlier figure), one the topic or platform momentum, one a concrete timing or hook recommendation.
2) Last line starts with "Post this week:" — one post idea on the creator's pillars that borrows the strongest winner's structure (name the card #).
Rules: quote only figures present in the digest. Plain text + "· " bullets (markdown-free). No headings, no preamble.

OUTPUT FORMAT (strict):
· <insight>
· <insight>
· <insight>
Post this week: <idea>`;

  ctx.step(`Writing the brief${pinned ? ` with ${pinned.providerID} · ${pinned.id}` : ''}`);
  const { out, model, errors } = await smartAI(prompt, 180000, pinned, ctx.signal, { role: 'brief' });
  ctx.via(model);
  if (out) {
    const analysis = { mode: 'ai' as const, text: out.slice(0, 2000), ts: Date.now(), via: model ? { providerID: model.providerID, id: model.id } : null };
    markAnalysis(analysis);
    return { status: 200, body: { ...analysis, hint: '', posts: digest.total } };
  }
  if (!pinned) markAI(false, 'AI unavailable: ' + (errors.join(' | ') || 'all lanes failed')); // a pinned model failing isn't 'AI off'
  const analysis = { mode: 'stats' as const, text: statsSummary(digest), ts: Date.now(), via: null };
  markAnalysis(analysis);
  const msg = errors.join(' | ') || 'AI unavailable — stats summary only';
  return {
    status: 200,
    body: { ...analysis, hint: 'AI not available — showing the rules-based stats summary.', aiError: msg, posts: digest.total },
    failure: msg,
  };
}
