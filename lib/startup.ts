// lib/startup.ts — runs once when the Reticle server starts (see instrumentation.ts).
//
// OpenCode autostart: if OpenCode is an enabled provider, start the local
// OpenCode service in the background so its models are listed and ready without
// a first-use delay. A boot never changes the user's provider settings: turning
// OpenCode off stays off (finding F14). Set PAYLOAD_OPENCODE_AUTOSTART=false to
// skip the service warm-up entirely.
import { readAIConfig, opencodeModels } from './ai';

export function onServerStart() {
  if (process.env.PAYLOAD_OPENCODE_AUTOSTART === 'false') return;
  try {
    if (!readAIConfig().enabled.opencode) return; // respect the saved setting
  } catch {
    return;
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
//
// The same tick also polls active Apify runs, so a collector that finishes
// while the Sources page is closed still imports its posts (finding F1).
export function startScheduler() {
  const g = globalThis as unknown as { __payloadScheduler?: ReturnType<typeof setInterval> };
  if (g.__payloadScheduler) return; // dev reloads re-run instrumentation

  let pollingApify = false;
  const pollApify = async () => {
    if (pollingApify) return; // a slow poll must not stack up behind the 30 s tick
    pollingApify = true;
    try {
      const { pollActiveRuns } = await import('./apify');
      await pollActiveRuns();
    } catch { /* no token yet, or a transient Apify error — retried next tick */ }
    finally { pollingApify = false; }
  };

  void (async () => {
    const tick = async () => {
      await pollApify();
      try {
        // the scheduler runs in-process — no HTTP hop, no scheduler key
        const { runDue } = await import('./automations');
        const started = runDue();
        if (started.length) console.info(`[payload] automations started: ${started.join(', ')}`);
      } catch (e: any) {
        console.warn('[payload] scheduler tick failed:', String(e?.message || e).slice(0, 200));
      }
    };
    // the old scheduler key is dead weight — drop it on the next boot
    try {
      const { deleteState } = await import('./app-state');
      deleteState('schedulerKey');
      const { getStore } = await import('./db');
      getStore().setMeta('schedulerKey', '');
    } catch { /* first boot */ }
    g.__payloadScheduler = setInterval(() => { void tick(); }, 30_000);
    setTimeout(() => { void tick(); }, 8_000);
  })();
}
