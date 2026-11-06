// lib/startup.ts — runs once when the Reticle server starts (see instrumentation.ts).
//
// OpenCode autostart: every server start re-enables OpenCode as a provider in
// Auto mode (keeping your provider order) and starts the local OpenCode service
// in the background, so its models are listed and ready without a first-use
// delay. Set PAYLOAD_OPENCODE_AUTOSTART=false to turn this off.
import { readAIConfig, saveAIConfig, opencodeModels } from './ai';

export function onServerStart() {
  if (process.env.PAYLOAD_OPENCODE_AUTOSTART === 'false') return;
  try {
    const cfg = readAIConfig();
    if (!cfg.enabled.opencode) {
      saveAIConfig({ enabled: { ...cfg.enabled, opencode: true } });
      console.info('[payload] OpenCode enabled in Auto mode (server start)');
    }
  } catch (e) {
    console.warn('[payload] could not enable OpenCode:', (e as Error).message);
  }
  // don't block startup — the service can take a few seconds to come up
  void (async () => {
    try {
      const { ensure } = await import('./opencodeai');
      await ensure();
      const m = await opencodeModels();
      console.info(`[payload] OpenCode service ready — ${m.list.length} models`);
    } catch (e) {
      console.warn('[payload] OpenCode service did not start (it will be retried on first use):', (e as Error).message);
    }
  })();
}

// ---------------- automation scheduler ----------------
// Every 30 seconds the server asks itself to run any due automation
// (lib/automations.ts → runDue). The call goes through the normal route, so
// runs are recorded on Activity like anything you start by hand. The key that
// lets it past the sign-in proxy lives only in this machine's SQLite.
export function startScheduler() {
  const g = globalThis as unknown as { __payloadScheduler?: ReturnType<typeof setInterval> };
  if (g.__payloadScheduler) return; // dev reloads re-run instrumentation
  void (async () => {
    const { getStore } = await import('./db');
    const store = getStore();
    let key = store.getMeta('schedulerKey') || '';
    if (key.length < 32) {
      key = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
      store.setMeta('schedulerKey', key);
    }
    const port = process.env.PORT || '3000';
    const tick = () => fetch(`http://127.0.0.1:${port}/api/automations/tick`, { method: 'POST', headers: { 'x-payload-scheduler': key } })
      .then(r => r.json()).then(j => { if (j?.started?.length) console.info(`[payload] automations started: ${j.started.join(', ')}`); })
      .catch(() => {}); // server still booting — next tick
    g.__payloadScheduler = setInterval(tick, 30_000);
    setTimeout(tick, 8_000);
  })();
}
