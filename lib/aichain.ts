// Shared AI call chain used by Generate, Analyze and every Workflow.
// Provider order (Claude CLI → Claude API → OpenCode by default) lives in
// lib/ai.ts and is editable on Settings; the creator-aware system prompt
// (lib/prompt.ts) rides along with every call.
import 'server-only';
import { callAI, PROVIDER_LABEL, type ProviderId } from './ai';
import { systemPrompt, type PromptCtx } from './prompt';
import { markAI, markGoodModel } from './engine';

export type AIModelRef = { providerID: string; id: string };
export type AIResult = { out: string; model: AIModelRef | null; errors: string[]; ms?: number };

/** `pinned` = { providerID: 'claude-cli' | 'anthropic' | 'opencode', id: model } runs ONLY
 *  that provider/model (chosen per run in Generate / Toolkit / Formats / Workflows);
 *  null = the provider order from Settings with each provider's default model. */
/** `ctx` picks the playbook layers (platform / format / role) for the system prompt — lib/playbook.ts. */
export async function smartAI(prompt: string, timeoutMs = 180000, pinned: AIModelRef | null = null, signal?: AbortSignal, ctx: PromptCtx = {}): Promise<AIResult> {
  if (signal?.aborted) throw new Error('aborted: stopped by user');
  const only = pinned && pinned.providerID in PROVIDER_LABEL ? (pinned.providerID as ProviderId) : undefined;
  const r = await callAI(systemPrompt(ctx), prompt, { timeoutMs, signal, only, model: only && pinned?.id && pinned.id !== 'default' ? pinned.id : undefined });
  if (r.text) {
    const model = { providerID: r.provider, id: r.model };
    markAI(true, `AI working via ${PROVIDER_LABEL[r.provider]}${r.model ? ' · ' + r.model : ''} (${Math.round(r.ms / 100) / 10}s)`);
    markGoodModel(model);
    return { out: r.text, model, errors: r.errors, ms: r.ms };
  }
  // A pinned model failing (e.g. a free OpenCode model out of quota) says nothing about the
  // other providers — only an Auto-mode failure (every enabled provider failed) is "AI off".
  if (!only) markAI(false, 'AI unavailable: ' + (r.errors.join(' | ') || 'no provider enabled'));
  return { out: '', model: null, errors: r.errors };
}
