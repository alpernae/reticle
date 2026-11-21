// lib/application/categorize.ts — the AI categorizer use case.
//
// Claude sorts the posts the keyword rules could not place — one batch of 40
// per call. The client loops until nothing is left; each batch is one task.
import 'server-only';
import { categorizeBatch, uncategorizedIds } from '../categorize';
import type { UseCaseResult } from './drafts';
import type { WorkCtx } from './tasks';

export type CategorizeInput = { model?: { providerID: string; id: string } | null };

export async function categorizeBatchTask(body: CategorizeInput, ctx: WorkCtx): Promise<UseCaseResult> {
  const model = body.model?.providerID && body.model?.id ? body.model : null;
  const left = uncategorizedIds().length;
  if (!left) return { status: 200, body: { done: 0, remaining: 0 } };

  ctx.step('Asking the AI to sort ' + Math.min(40, left) + ' posts');
  const out = await categorizeBatch(model, ctx.signal);
  ctx.via(out.via);
  if (out.error) return { status: 502, body: out, failure: out.error };
  return { status: 200, body: out };
}
