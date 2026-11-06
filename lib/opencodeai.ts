// OpenCode AI bridge — uses the local OpenCode background service for one-shot text generation.
import 'server-only';
import { Service } from '@opencode/client/service';
import fs from 'node:fs';
import path from 'node:path';
import { dbHandles } from './engine';

export type OpenCodeModel = { providerID: string; id: string };
let cached: { url: string; headers: Record<string, string> } | null = null;

/** The real opencode executable. The client library starts the service with
 *  spawn('opencode', …) WITHOUT a shell — on Windows `opencode` is an npm .cmd
 *  shim, which can't be spawned that way ("Failed to start server"). So resolve
 *  the native binary behind the shim. OPENCODE_BIN overrides. */
export function opencodeCommand(): string[] | undefined {
  const fromEnv = process.env.OPENCODE_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return [fromEnv, 'serve', '--service'];
  if (process.platform !== 'win32') return undefined; // the default works on macOS/Linux
  const dirs = String(process.env.PATH || '').split(path.delimiter).concat(path.join(process.env.APPDATA || '', 'npm'));
  for (const dir of dirs) {
    if (!dir) continue;
    const exe = path.join(dir, 'opencode.exe');
    if (fs.existsSync(exe)) return [exe, 'serve', '--service'];
    if (fs.existsSync(path.join(dir, 'opencode.cmd'))) {
      const inner = path.join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
      if (fs.existsSync(inner)) return [inner, 'serve', '--service'];
    }
  }
  return undefined;
}

/** Connect to the local OpenCode service, starting it if needed. */
export async function ensure() {
  if (cached) return cached;
  const command = opencodeCommand();
  const endpoint = await Service.ensure(command ? { command } : undefined);
  cached = { url: endpoint.url, headers: Service.headers(endpoint) as Record<string, string> };
  return cached;
}

export async function aiAvailable(): Promise<{ ok: boolean; message: string }> {
  try {
    const c = await ensure();
    const r = await fetch(c.url + '/api/info', { headers: c.headers, signal: AbortSignal.timeout(5000) });
    return r.ok ? { ok: true, message: 'OpenCode service ready' } : { ok: false, message: 'OpenCode service respond ' + r.status };
  } catch (e: any) {
    return { ok: false, message: 'OpenCode service unreachable: ' + e.message };
  }
}

/** Every model the local OpenCode service offers — including its own (free) models. */
export async function listAllModels(): Promise<OpenCodeModel[]> {
  const c = await ensure();
  const raw: any = await (await fetch(c.url + '/api/model', { headers: c.headers, signal: AbortSignal.timeout(8000) })).json();
  const out: OpenCodeModel[] = [];
  const seen = new Set<string>();
  for (const m of (Array.isArray(raw) ? raw : raw?.models || raw?.data || [])) {
    const providerID = m.providerID || m?.model?.providerID || '', id = m.id || m.modelID || '';
    const k = providerID + '/' + id;
    if (providerID && id && !seen.has(k)) { seen.add(k); out.push({ providerID, id }); }
  }
  return out.sort((a, b) => a.providerID.localeCompare(b.providerID) || a.id.localeCompare(b.id));
}

/** Discover models offered by all configured providers (used for auto-fallback). */
export async function listOtherProviderModels(): Promise<OpenCodeModel[]> {
  try {
    const c = await ensure();
    const raw: any = await (await fetch(c.url + '/api/model', { headers: c.headers, signal: AbortSignal.timeout(8000) })).json();
    const out: OpenCodeModel[] = [];
    for (const m of (Array.isArray(raw) ? raw : raw?.models || raw?.data || [])) {
      const providerID = m.providerID || '', id = m.id || m.modelID || '';
      if (providerID && id && providerID !== 'opencode') out.push({ providerID, id });
    }
    return out;
  } catch { return []; }
}

/** One-shot text generation via the local OpenCode service. Long timeout — models think.
 *  An optional AbortSignal lets callers (e.g. the Studio job runner) cancel in-flight calls. */
export async function aiText(prompt: string, timeoutMs = 180000, model?: OpenCodeModel | null, signal?: AbortSignal): Promise<string> {
  const c = await ensure();
  let res: Response;
  try {
    res = await fetch(c.url + '/api/experimental/generate/text', {
      method: 'POST',
      headers: { ...c.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(model ? { prompt, model } : { prompt }),
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
    });
  } catch (e: any) {
    // health is recorded per model in lib/ai.ts — one failing OpenCode model must not mark all AI as off
    throw new Error('OpenCode service error: ' + e.message);
  }
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = j?.message || j?.reason || 'HTTP ' + res.status;
    if (j?.retryAfterMs) {
      const hours = (j.retryAfterMs / 3600000).toFixed(1).replace(/\.0$/, '');
      msg += ` — quota resets in ~${hours}h`;
    }
    throw new Error(msg);
  }
  const text = typeof j === 'string' ? j : (j.data?.text ?? j.text ?? j.content ?? j.result ?? '');
  return String(text || '').trim();
}
