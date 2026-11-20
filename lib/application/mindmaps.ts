// lib/application/mindmaps.ts — expanding a mind-map branch with the AI.
//
// The path from the centre to the node keeps the ideas on the branch's
// subject; the ideas the map already has are sent too, so the model does not
// repeat them.
import 'server-only';
import { smartAI } from '../aichain';
import type { UseCaseResult } from './drafts';
import type { WorkCtx } from './tasks';

export type MindMapExpandInput = {
  path?: unknown[]; existing?: unknown[]; count?: number | string;
  model?: { providerID: string; id: string } | null;
};

export async function expandMindMap(body: MindMapExpandInput, ctx: WorkCtx): Promise<UseCaseResult> {
  const path: string[] = (Array.isArray(body.path) ? body.path : []).map((s: unknown) => String(s).slice(0, 200)).slice(0, 8);
  const existing: string[] = (Array.isArray(body.existing) ? body.existing : []).map((s: unknown) => String(s).slice(0, 120)).slice(0, 20);
  const n = Math.min(8, Math.max(2, Number(body.count) || 5));
  const model = body.model?.providerID && body.model?.id ? body.model : null;

  ctx.step('Asking for ideas');
  const r = await smartAI([
    'I am brainstorming in a mind map. The branch I am on, from the centre outwards:',
    path.map((p, i) => `${'  '.repeat(i)}- ${p}`).join('\n'),
    existing.length ? `Already under it (do not repeat these): ${existing.join(' | ')}` : '',
    `Give exactly ${n} new child ideas for the LAST item. Each short (at most 9 words), concrete, specific to me as a creator, and different from each other.`,
    'Output one per line and nothing else. You may start a line with "Q:" for a question to answer, "POST:" for a ready post idea, or "TODO:" for an action.',
  ].filter(Boolean).join('\n'), 120_000, model, ctx.signal, { role: 'ideas' });
  ctx.via(r.model);
  if (!r.out) {
    const msg = r.errors.join(' | ') || 'no answer';
    return { status: 400, body: { error: msg }, failure: msg };
  }
  const ideas = r.out.split('\n')
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, n)
    .map(l => {
      const m = /^(Q|POST|TODO)\s*:\s*/i.exec(l);
      const tag = m?.[1].toUpperCase();
      const kind = tag === 'Q' ? 'question' : tag === 'POST' ? 'post' : tag === 'TODO' ? 'task' : 'idea';
      return { text: l.replace(/^(Q|POST|TODO)\s*:\s*/i, '').replace(/^["“]|["”]$/g, '').slice(0, 120), kind };
    });
  return { status: 200, body: { ideas } };
}
