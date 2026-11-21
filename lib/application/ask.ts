// lib/application/ask.ts — "Ask Reticle" (the top-bar dock).
//
// Finds the collected posts that match the question, then answers it from the
// creator's data digest + those posts. The matching posts are found here (not
// in the route) so the answer and the evidence travel together.
import 'server-only';
import { allPayload, analysisDigest, digestText } from '../engine';
import { analyze } from '../domain/patterns';
import { smartAI } from '../aichain';
import { readTimezone } from '../timezone-store';
import type { UseCaseResult } from './drafts';
import type { WorkCtx } from './tasks';

export type AskInput = { q?: string; model?: { providerID: string; id: string } | null };

const STOP = new Set('a an the and or of to in on for with about what which who how why is are was were do does did my me i you your it this that best top most posts post show find give tell get me from at by be can should'.split(' '));

export async function askReticle(body: AskInput, ctx: WorkCtx): Promise<UseCaseResult> {
  const q = String(body.q || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (q.length < 3) return { status: 400, body: { error: 'Ask a question.' } };
  const model = body.model?.providerID && body.model?.id ? body.model : null;

  // keyword match over collected posts, best breakouts first
  const words = q.toLowerCase().split(/[^a-z0-9#@+.]+/).filter(w => w.length > 2 && !STOP.has(w));
  const rows = analyze(allPayload().posts, readTimezone());
  const scored = rows.map(r => {
    const hay = `${r.title} ${r.body || ''} ${(r.topics || []).join(' ')} ${r.author || ''} ${r.source}`.toLowerCase();
    const hits = words.filter(w => hay.includes(w)).length;
    return { r, hits };
  }).filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits || b.r.outlier - a.r.outlier);
  const posts = scored.slice(0, 6).map(({ r }) => ({
    id: r.id, title: (r.hookLine || r.title).slice(0, 140), source: r.source, author: r.author || null,
    outlier: Math.round(r.outlier * 10) / 10, likes: r.score, link: r.link,
  }));

  ctx.step('Reading your data');
  const digest = digestText(analysisDigest());
  const examples = scored.slice(0, 8).map(({ r }, i) => `${i + 1}. [${r.source}, @${r.author || '?'}, ${r.outlier.toFixed(1)}× their normal, ${r.score} likes] ${(r.hookLine || r.title).slice(0, 200)}`).join('\n');
  ctx.step('Answering');
  const r = await smartAI([
    `QUESTION: ${q}`,
    `MY DATA DIGEST (only source of truth for numbers):\n${digest}`,
    examples ? `COLLECTED POSTS THAT MATCH THE QUESTION:\n${examples}` : 'No collected post matches the question words.',
    'Answer in at most 6 short lines, plain text, no markdown headings or bold. Be concrete and specific to me. Only cite numbers that appear above; if the data cannot answer, say so in one line and suggest what to collect.',
  ].join('\n\n'), 150_000, model, ctx.signal, { role: 'brief' });
  ctx.via(r.model);
  if (!r.out) {
    const msg = r.errors.join(' | ') || 'no answer';
    return { status: 500, body: { error: msg, posts }, failure: msg };
  }
  return { status: 200, body: { answer: r.out.replace(/\*\*/g, '').trim(), posts } };
}
