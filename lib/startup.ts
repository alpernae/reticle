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

// ---------------- task worker ----------------
// The durable task worker (lib/runtime/worker.ts) claims queued tasks with a
// lease, runs them, and recovers work whose owner died. It starts with the
// server so scheduled collection and AI work progress without a page open.
export async function startTaskWorker() {
  try {
    // imported lazily so the worker's dependencies (Apify, AI) are not pulled
    // into every process that only needs the scheduler
    const { startWorker } = await import('./runtime/worker');
    startWorker();
  } catch (e: any) {
    console.warn('[task] worker did not start:', String(e?.message || e).slice(0, 200));
  }
}

// ---------------- automation scheduler ----------------
// Every 30 seconds the server asks itself to run any due automation
// (lib/automations.ts → runDue). The call is in-process — no HTTP hop, no
// scheduler key — and the run is recorded on Activity like anything you start
// by hand.
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

  // The analytics snapshot (ADR-004) goes stale on its own: the "last 48 h"
  // windows move even when no data changes. It is refreshed every 15 minutes,
  // in a task — never on a request.
  let lastAnalyticsCheck = 0;
  const refreshAnalytics = async () => {
    if (Date.now() - lastAnalyticsCheck < 15 * 60 * 1000) return;
    lastAnalyticsCheck = Date.now();
    try {
      const { currentSnapshot } = await import('./analytics-read');
      if (currentSnapshot()) return; // still current
      const { scheduleRebuild } = await import('./application/analytics');
      scheduleRebuild(1_000);
    } catch { /* the worker will catch up */ }
  };

  // The nightly backup (phase 4e): one recurring task that writes a consistent
  // copy of the database. The scheduler only makes sure it exists — the task
  // reschedules itself after every run.
  let lastBackupCheck = 0;
  const ensureBackup = async () => {
    if (Date.now() - lastBackupCheck < 60 * 60 * 1000) return;
    lastBackupCheck = Date.now();
    try {
      const { ensureBackupTask } = await import('./application/backup');
      ensureBackupTask();
    } catch { /* the worker will catch up */ }
  };

  void (async () => {
    const tick = async () => {
      await pollApify();
      await refreshAnalytics();
      await ensureBackup();
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
