// lib/ai.ts — AI providers behind one call: Claude CLI · Claude API · OpenCode.
//
//  • claude-cli — runs `claude -p` (Claude Code, headless). Uses whatever the
//    CLI is logged into: your Claude Pro/Max subscription, no API key needed.
//    Optionally a long-lived token from `claude setup-token` is passed as
//    CLAUDE_CODE_OAUTH_TOKEN so it works even when the CLI isn't logged in.
//  • anthropic  — the Claude API via the official SDK and an API key from
//    console.anthropic.com (pay-as-you-go, fastest and most predictable).
//  • opencode   — the original local OpenCode service lane (kept as fallback).
//
// The order is configurable on Settings; the first provider that answers wins.
import 'server-only';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { getStore } from './db';

export type ProviderId = 'claude-cli' | 'anthropic' | 'opencode';
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  'claude-cli': 'Claude CLI (subscription)',
  anthropic: 'Claude API (API key)',
  opencode: 'OpenCode (local service)',
};

export type AIConfig = {
  order: ProviderId[];
  enabled: Record<ProviderId, boolean>;
  apiModel: string;       // Claude API model id
  apiEffort: 'low' | 'medium' | 'high';
  cliModel: string;       // claude CLI --model alias or id ('sonnet', 'opus', 'haiku', or a full id)
  cliPath: string;        // optional explicit path to the claude executable
  opencodeModel: string;  // 'providerID::modelID' or '' = OpenCode's own default
};

const DEFAULT_AI: AIConfig = {
  order: ['claude-cli', 'anthropic', 'opencode'],
  enabled: { 'claude-cli': true, anthropic: true, opencode: true },
  apiModel: 'claude-opus-5-5',
  apiEffort: 'medium',
  cliModel: 'sonnet',
  cliPath: '',
  opencodeModel: '',
};

export function readAIConfig(): AIConfig {
  const c: AIConfig = JSON.parse(JSON.stringify(DEFAULT_AI));
  try {
    const v = JSON.parse(getStore().getMeta('aiConfig') || '{}');
    if (Array.isArray(v.order)) {
      const ok = v.order.filter((p: string) => p in PROVIDER_LABEL) as ProviderId[];
      c.order = [...new Set([...ok, ...DEFAULT_AI.order])];
    }
    if (v.enabled) for (const p of DEFAULT_AI.order) if (typeof v.enabled[p] === 'boolean') c.enabled[p] = v.enabled[p];
    if (typeof v.apiModel === 'string' && /^claude-[\w.-]+$/.test(v.apiModel)) c.apiModel = v.apiModel;
    if (['low', 'medium', 'high'].includes(v.apiEffort)) c.apiEffort = v.apiEffort;
    if (typeof v.cliModel === 'string' && /^[\w.-]{2,60}$/.test(v.cliModel)) c.cliModel = v.cliModel;
    if (typeof v.cliPath === 'string') c.cliPath = v.cliPath.slice(0, 400);
    if (typeof v.opencodeModel === 'string') c.opencodeModel = v.opencodeModel.slice(0, 200);
  } catch {}
  return c;
}
export function saveAIConfig(next: Partial<AIConfig>): AIConfig {
  const merged = { ...readAIConfig(), ...next };
  getStore().setMeta('aiConfig', JSON.stringify(merged));
  return readAIConfig();
}

// ---------------- secrets (local SQLite meta only) ----------------
const mask = (s: string | null) => (s ? '••••' + s.slice(-4) : null);
export const getAnthropicKey = () => (getStore().getMeta('anthropicKey') || '').trim() || null;
export const setAnthropicKey = (k: string) => getStore().setMeta('anthropicKey', String(k || '').trim().slice(0, 300));
export const getClaudeOAuthToken = () => (getStore().getMeta('claudeOAuthToken') || '').trim() || null;
export const setClaudeOAuthToken = (k: string) => getStore().setMeta('claudeOAuthToken', String(k || '').trim().slice(0, 400));

// ---------------- claude CLI ----------------
/** Find the claude executable: configured path → PATH → common install dirs. */
export function findClaudeCli(): string | null {
  const cfg = readAIConfig().cliPath.trim();
  const found = cfg && fs.existsSync(cfg) ? cfg : searchClaudeCli();
  return found ? unwrapCmdShim(found) : null;
}
/** npm on Windows installs a claude.cmd shim around bin/claude.exe. Going through
 *  cmd.exe mangles long multi-line arguments (our system prompt), so use the exe. */
function unwrapCmdShim(p: string): string {
  if (!/\.cmd$/i.test(p)) return p;
  const exe = path.join(path.dirname(p), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return fs.existsSync(exe) ? exe : p;
}
function searchClaudeCli(): string | null {
  const isWin = process.platform === 'win32';
  const names = isWin ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const n of names) { const p = path.join(dir, n); if (dir && fs.existsSync(p)) return p; }
  }
  const home = os.homedir();
  const extra = isWin
    ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')]
    : [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'];
  return extra.find(p => p && fs.existsSync(p)) || null;
}

async function viaCli(system: string, prompt: string, timeoutMs: number, signal?: AbortSignal, modelOverride?: string): Promise<{ text: string; model: string }> {
  const bin = findClaudeCli();
  if (!bin) throw new Error('claude CLI not found — install it (npm i -g @anthropic-ai/claude-code) or set its path on Settings');
  const cfg = readAIConfig();
  const cliModel = modelOverride || cfg.cliModel;
  const args = ['-p', '--output-format', 'json', '--model', cliModel, '--max-turns', '1', '--append-system-prompt', system];
  // Drop session vars inherited when the dev server was launched from inside another
  // Claude Code session (host-managed auth, entrypoint markers) — they make the child
  // CLI expect auth from a host that isn't there and answer "Not logged in".
  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'CLAUDECODE' || (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN') || k.startsWith('CLAUDE_AGENT_SDK')) continue;
    env[k] = v;
  }
  const tok = getClaudeOAuthToken();
  if (tok) env.CLAUDE_CODE_OAUTH_TOKEN = tok;
  return new Promise((resolve, reject) => {
    // cwd = temp dir so the CLI doesn't pick up this repo's CLAUDE.md/AGENTS.md as instructions
    const child = spawn(bin, args, { cwd: os.tmpdir(), env, shell: /\.cmd$/i.test(bin), windowsHide: true });
    let out = '', err = '';
    const kill = () => { try { child.kill(); } catch {} };
    const t = setTimeout(() => { kill(); reject(new Error(`claude CLI timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    signal?.addEventListener('abort', () => { kill(); reject(new Error('aborted: stopped by user')); }, { once: true });
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(t); reject(new Error('claude CLI failed to start: ' + e.message)); });
    child.on('close', code => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out.trim().split('\n').filter(Boolean).pop() || '{}');
        if (j.is_error || !j.result) return reject(new Error(String(j.result || j.error || err || `exit ${code}`).slice(0, 240)));
        resolve({ text: String(j.result).trim(), model: cliModel });
      } catch {
        reject(new Error((err || out || `claude CLI exited ${code}`).trim().slice(0, 240)));
      }
    });
    child.stdin.end(prompt);
  });
}

// ---------------- Claude API ----------------
async function viaApi(system: string, prompt: string, timeoutMs: number, signal?: AbortSignal, modelOverride?: string): Promise<{ text: string; model: string }> {
  const key = getAnthropicKey();
  if (!key) throw new Error('no Anthropic API key saved');
  const cfg = readAIConfig();
  const client = new Anthropic({ apiKey: key, timeout: timeoutMs, maxRetries: 1 });
  const res = await client.beta.messages.create({
    model: modelOverride || cfg.apiModel,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: cfg.apiEffort },
    // security content can trip the cyber classifier — let the API re-route a refusal to a fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  }, { signal });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request' + (res.stop_details?.explanation ? ': ' + res.stop_details.explanation : ''));
  const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
  if (!text) throw new Error('empty response');
  return { text, model: res.model };
}

// ---------------- OpenCode (legacy lane) ----------------
/** OpenCode model ids travel as 'providerID::modelID' (model ids can contain '/'). */
export const parseOpenCodeModel = (s?: string) => {
  if (!s || s === 'default' || !s.includes('::')) return null;
  const i = s.indexOf('::');
  return { providerID: s.slice(0, i), id: s.slice(i + 2) };
};
async function viaOpenCode(system: string, prompt: string, timeoutMs: number, signal?: AbortSignal, modelOverride?: string): Promise<{ text: string; model: string }> {
  const { aiText } = await import('./opencodeai');
  const m = parseOpenCodeModel(modelOverride) || parseOpenCodeModel(readAIConfig().opencodeModel);
  const text = await aiText(`${system}\n\n---\n\nTASK:\n${prompt}`, timeoutMs, m, signal);
  if (!text) throw new Error('empty response');
  return { text, model: m ? `${m.providerID}/${m.id}` : 'opencode default' };
}

/** Models the local OpenCode service offers (all providers you have keys for). Cached 60s; [] when the service is down. */
// The last good list is saved in SQLite, so OpenCode models stay pickable while the
// service is down (it is started on first use anyway).
let ocCache: { at: number; list: { id: string; label: string }[]; error: string | null; stale: boolean } | null = null;
export async function opencodeModels(): Promise<{ list: { id: string; label: string }[]; error: string | null; stale: boolean }> {
  if (ocCache && Date.now() - ocCache.at < (ocCache.error ? 15_000 : 60_000)) return ocCache;
  let list: { id: string; label: string }[] = [], error: string | null = null, stale = false;
  try {
    const { listAllModels } = await import('./opencodeai');
    // first call may have to START the service — give it time
    const all = await Promise.race([listAllModels(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('OpenCode service did not answer in 20s')), 20_000))]);
    list = all.map(m => ({ id: `${m.providerID}::${m.id}`, label: `${m.providerID} / ${m.id}` }));
    if (list.length) getStore().setMeta('opencodeModelList', JSON.stringify(list));
    else error = 'OpenCode returned no models — run `opencode auth login` to add a provider';
  } catch (e: any) {
    error = String(e?.message || e).slice(0, 160);
    try { list = JSON.parse(getStore().getMeta('opencodeModelList') || '[]'); stale = list.length > 0; } catch {}
  }
  ocCache = { at: Date.now(), list, error, stale };
  return ocCache;
}

const RUNNERS: Record<ProviderId, typeof viaApi> = { 'claude-cli': viaCli, anthropic: viaApi, opencode: viaOpenCode };

export type AICall = { text: string; provider: ProviderId; model: string; ms: number; errors: string[] };

/** Run the prompt through the configured provider order; first success wins. */
export async function callAI(system: string, prompt: string, opts: { timeoutMs?: number; signal?: AbortSignal; only?: ProviderId; model?: string } = {}): Promise<AICall> {
  const cfg = readAIConfig();
  const order = opts.only ? [opts.only] : cfg.order.filter(p => cfg.enabled[p]);
  const errors: string[] = [];
  for (const p of order) {
    if (opts.signal?.aborted) throw new Error('aborted: stopped by user');
    const t0 = Date.now();
    const modelKey = opts.only === p && opts.model ? opts.model : p === 'claude-cli' ? cfg.cliModel : p === 'anthropic' ? cfg.apiModel : cfg.opencodeModel || 'default';
    try {
      const r = await RUNNERS[p](system, prompt, opts.timeoutMs ?? 180000, opts.signal, opts.only === p ? opts.model : undefined);
      const ms = Date.now() - t0;
      recordLatency(p, modelKey, ms);
      recordModelStatus(p, modelKey, true, 'answered in ' + Math.round(ms / 100) / 10 + 's');
      return { text: r.text, provider: p, model: r.model, ms, errors };
    } catch (e: any) {
      if (opts.signal?.aborted) throw e;
      const msg = String(e?.message || e).split('\n')[0].slice(0, 200);
      recordModelStatus(p, modelKey, false, msg);
      errors.push(`${PROVIDER_LABEL[p]}: ${msg}`);
    }
  }
  return { text: '', provider: order[0] || 'anthropic', model: '', ms: 0, errors };
}

export function aiProvidersStatus() {
  const cfg = readAIConfig();
  return {
    config: cfg,
    cliPath: findClaudeCli(),
    anthropicKey: mask(getAnthropicKey()),
    claudeOAuthToken: mask(getClaudeOAuthToken()),
    labels: PROVIDER_LABEL,
  };
}

/** What the per-run pickers (Generate, Toolkit, Formats, Workflows, brief, categorizer) can choose from. */
export const MODEL_CHOICES: Record<ProviderId, { id: string; label: string }[]> = {
  'claude-cli': [
    { id: 'sonnet', label: 'Sonnet (fast, balanced)' },
    { id: 'opus', label: 'Opus (best quality, slower)' },
    { id: 'haiku', label: 'Haiku (fastest)' },
  ],
  anthropic: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  ],
  opencode: [{ id: 'default', label: 'OpenCode default model' }],
};

// ---------------- measured latency (last success per provider|model) ----------------
export function readLatency(): Record<string, number> {
  try { return JSON.parse(getStore().getMeta('aiLatency') || '{}'); } catch { return {}; }
}
function recordLatency(provider: ProviderId, model: string, ms: number) {
  const m = readLatency();
  m[provider + '|' + (model || 'default')] = ms;
  getStore().setMeta('aiLatency', JSON.stringify(m));
}

// ---------------- per-model health (last outcome per provider|model) ----------------
// One model failing (e.g. an OpenCode free model out of quota) must not make the
// whole app look "AI off" — health is tracked per model, and the global chip is
// derived from whether ANY provider currently works.
export type ModelStatus = { ok: boolean; msg: string; ts: number; retryAt?: number };
export function readModelStatus(): Record<string, ModelStatus> {
  const store = getStore();
  const raw = store.getMeta('aiModelStatus');
  if (raw) { try { return JSON.parse(raw); } catch { return {}; } }
  // first read: backfill from the Activity history so the status is right immediately
  const m: Record<string, ModelStatus> = {};
  for (const r of [...store.listRuns(300)].reverse()) {
    if (!r.provider || !['done', 'failed'].includes(r.status)) continue;
    const ok = r.status === 'done';
    const st: ModelStatus = { ok, msg: ok ? 'answered' : r.error.slice(0, 240), ts: r.finished || r.created };
    const reset = /resets? in ~?\s*([\d.]+)\s*(h|hours?|m|min|minutes?)/i.exec(r.error || '');
    if (!ok && reset) st.retryAt = st.ts + Number(reset[1]) * (/^h/i.test(reset[2]) ? 36e5 : 6e4);
    m[r.provider + '|' + (r.model || 'default')] = st;
  }
  store.setMeta('aiModelStatus', JSON.stringify(m));
  return m;
}
function recordModelStatus(provider: ProviderId, model: string, ok: boolean, msg: string) {
  const m = readModelStatus();
  const st: ModelStatus = { ok, msg: msg.slice(0, 240), ts: Date.now() };
  // "quota resets in ~13.5h" → remember when it should work again
  const reset = /resets? in ~?\s*([\d.]+)\s*(h|hours?|m|min|minutes?)/i.exec(msg);
  if (!ok && reset) st.retryAt = Date.now() + Number(reset[1]) * (/^h/i.test(reset[2]) ? 36e5 : 6e4);
  m[provider + '|' + (model || 'default')] = st;
  getStore().setMeta('aiModelStatus', JSON.stringify(m));
}

/** App-wide AI health: ready if any enabled provider's last call worked (or it was never tried and is set up). */
export function aiHealth(): { ok: boolean; summary: string; providers: { id: ProviderId; label: string; state: 'ok' | 'failing' | 'quota' | 'untested' | 'off' | 'not set up'; detail: string }[] } {
  const cfg = readAIConfig();
  const st = readModelStatus();
  const providers = cfg.order.map(p => {
    const label = PROVIDER_LABEL[p].split(' (')[0];
    if (!cfg.enabled[p]) return { id: p, label, state: 'off' as const, detail: 'disabled in Settings' };
    if (p === 'claude-cli' && !findClaudeCli()) return { id: p, label, state: 'not set up' as const, detail: 'claude CLI not installed' };
    if (p === 'anthropic' && !getAnthropicKey()) return { id: p, label, state: 'not set up' as const, detail: 'no API key' };
    const entries = Object.entries(st).filter(([k]) => k.startsWith(p + '|')).sort((a, b) => b[1].ts - a[1].ts);
    if (!entries.length) return { id: p, label, state: 'untested' as const, detail: 'not used yet' };
    if (entries.some(([, s]) => s.ok && Date.now() - s.ts < 7 * 864e5)) {
      const good = entries.find(([, s]) => s.ok)!;
      return { id: p, label, state: 'ok' as const, detail: `${good[0].split('|')[1]} ${good[1].msg}` };
    }
    const [k, last] = entries[0];
    const quota = !!last.retryAt && last.retryAt > Date.now();
    return { id: p, label, state: quota ? 'quota' as const : 'failing' as const, detail: `${k.split('|')[1]}: ${last.msg}` };
  });
  const ok = providers.some(x => x.state === 'ok' || x.state === 'untested');
  const summary = providers.filter(x => x.state !== 'off').map(x => `${x.label}: ${x.state}`).join(' · ');
  return { ok, summary, providers };
}
