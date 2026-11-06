import { NextResponse, connection } from 'next/server';
import { aiProvidersStatus, callAI, saveAIConfig, setAnthropicKey, setClaudeOAuthToken, PROVIDER_LABEL, MODEL_CHOICES, opencodeModels, readLatency, readModelStatus, type ProviderId } from '@/lib/ai';
import { readProfile, saveProfile } from '@/lib/prompt';

export const maxDuration = 120;

/** GET — provider config + secret masks + creator profile. */
export async function GET() {
  await connection(); // request-time: SQLite reads are sync, so without this Next prerenders & caches the response
  return NextResponse.json(await statusWithModels());
}

/** POST { action: 'config', config } | { action: 'key', anthropicKey?, claudeOAuthToken? }
 *       | { action: 'profile', profile } | { action: 'test', provider } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  switch (body?.action) {
    case 'config':
      saveAIConfig(body.config || {});
      break;
    case 'key':
      if (typeof body.anthropicKey === 'string') setAnthropicKey(body.anthropicKey);
      if (typeof body.claudeOAuthToken === 'string') setClaudeOAuthToken(body.claudeOAuthToken);
      break;
    case 'profile':
      saveProfile(body.profile || {});
      break;
    case 'test': {
      const p = String(body.provider || '') as ProviderId;
      if (!(p in PROVIDER_LABEL)) return NextResponse.json({ error: 'unknown provider' }, { status: 400 });
      const model = typeof body.model === 'string' && body.model && body.model !== 'default' ? body.model.slice(0, 200) : undefined;
      const r = await callAI('You are a connectivity check.', 'Reply with exactly: READY', { only: p, model, timeoutMs: Number(body.timeoutMs) > 0 ? Math.min(240000, Number(body.timeoutMs)) : 90000 });
      return NextResponse.json({ ok: !!r.text, provider: p, model: r.model, ms: r.ms, reply: r.text.slice(0, 60), error: r.errors[0] || null });
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  return NextResponse.json(await statusWithModels());
}

/** Provider status + model lists; OpenCode's list is read live from the local service. */
async function statusWithModels() {
  const oc = await opencodeModels();
  return {
    ...aiProvidersStatus(), profile: readProfile(),
    models: { ...MODEL_CHOICES, opencode: [{ id: 'default', label: 'OpenCode default model' }, ...oc.list] },
    opencodeError: oc.error,
    opencodeStale: oc.stale, // list is the last saved one — service unreachable right now
    modelStatus: readModelStatus(), // last outcome per provider|model (quota, failures)
    latency: readLatency(), // ms of the last successful call per 'provider|model'
  };
}
