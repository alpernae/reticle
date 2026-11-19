import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db: typeof import('../db');
let automations: typeof import('../automations');
let apify: typeof import('../apify');
let cache: typeof import('../cache');
let ai: typeof import('../ai');
let appState: typeof import('../app-state');

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-operational-'));
  db = await import('../db');
  automations = await import('../automations');
  apify = await import('../apify');
  cache = await import('../cache');
  ai = await import('../ai');
  appState = await import('../app-state');
});

describe('automations table', () => {
  it('moves legacy meta.automations into rows once', () => {
    const store = db.getStore();
    store.setMeta('automations', JSON.stringify([{
      id: 'autoLegacy', name: 'Legacy', description: '', enabled: true,
      steps: [{ id: 's1', worker: 'prompt', platform: 'x', prompt: 'hi', usePrev: false }],
      schedule: { type: 'manual' }, nextRun: null, lastRun: null, history: [], created: 1, updated: 1,
    }]));

    expect(automations.listAutomations()).toHaveLength(1);
    expect(store.getMeta('automations')).toBe('');
    expect(store.getAutomationRow('autoLegacy')?.name).toBe('Legacy');

    // Idempotent: no duplicate rows on a second read.
    expect(automations.listAutomations()).toHaveLength(1);
  });

  it('creates, updates and deletes a single row', () => {
    const store = db.getStore();
    const saved = automations.saveAutomation({
      name: 'New automation',
      steps: [{ id: 's1', worker: 'prompt', platform: 'x', prompt: 'hello', usePrev: false }],
      schedule: { type: 'manual' },
    });
    expect(saved.id).toMatch(/^auto/);
    expect(store.listAutomationRows()).toHaveLength(2);

    automations.setEnabled(saved.id, false);
    expect(automations.listAutomations().find(a => a.id === saved.id)?.enabled).toBe(false);

    automations.deleteAutomation(saved.id);
    expect(store.getAutomationRow(saved.id)).toBeUndefined();
    expect(automations.listAutomations()).toHaveLength(1);
  });
});

describe('collector runs table', () => {
  it('moves legacy meta.apifyRuns into rows once', () => {
    const store = db.getStore();
    store.setMeta('apifyRuns', JSON.stringify([{
      id: 'run1', platform: 'x', actor: 'actor/x', ts: 5, status: 'SUCCEEDED', items: 3,
      imported: { added: 1, updated: 1, skipped: 1 }, error: null, note: 'deep scan: @a', costUsd: 0.12,
    }]));

    const runs = apify.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: 'run1', platform: 'x', status: 'SUCCEEDED', items: 3,
      imported: { added: 1, updated: 1, skipped: 1 }, note: 'deep scan: @a', costUsd: 0.12,
    });
    expect(store.getMeta('apifyRuns')).toBe('');
    expect(store.getCollectorRunRow('run1')?.imported).toBe(JSON.stringify({ added: 1, updated: 1, skipped: 1 }));
  });

  it('patches whitelisted fields and keeps the rest', () => {
    const store = db.getStore();
    store.patchCollectorRunRow('run1', { status: 'FAILED', error: 'boom', note: null });
    expect(store.getCollectorRunRow('run1')).toMatchObject({
      status: 'FAILED', error: 'boom', note: null, items: 3,
      imported: JSON.stringify({ added: 1, updated: 1, skipped: 1 }),
    });
  });

  it('prunes to the newest rows', () => {
    const store = db.getStore();
    for (let i = 0; i < 85; i++) {
      store.upsertCollectorRunRow({
        id: 'bulk' + i, platform: 'x', actor: 'a', ts: 1000 + i, status: 'SUCCEEDED',
        items: 0, imported: null, error: null, note: null, costUsd: null,
      });
    }
    store.pruneCollectorRuns(80);
    expect((store.db.prepare('SELECT COUNT(*) c FROM collector_runs').get() as { c: number }).c).toBe(80);
    expect(store.getCollectorRunRow('run1')).toBeUndefined(); // oldest, pruned
  });
});

describe('cache table', () => {
  it('round-trips and moves a legacy meta cache value once', () => {
    const store = db.getStore();
    store.setMeta('opencodeModelList', JSON.stringify([{ id: 'a::b', label: 'a / b' }]));

    expect(cache.readCache('opencodeModelList', [])).toEqual([{ id: 'a::b', label: 'a / b' }]);
    expect(store.getMeta('opencodeModelList')).toBe('');

    cache.writeCache('price:x', { perResult: 0.1 });
    expect(cache.readCache('price:x', null)).toEqual({ perResult: 0.1 });
    cache.dropCache('price:x');
    expect(cache.readCache('price:x', 'fallback')).toBe('fallback');
  });
});

describe('provider health table', () => {
  it('moves the legacy latency and status blobs into rows once', () => {
    const store = db.getStore();
    store.setMeta('aiLatency', JSON.stringify({ 'anthropic|m1': 1200 }));
    store.setMeta('aiModelStatus', JSON.stringify({
      'anthropic|m1': { ok: true, msg: 'answered', ts: 10 },
      'opencode|x': { ok: false, msg: 'quota', ts: 20, retryAt: 30 },
    }));

    expect(ai.readLatency()).toEqual({ 'anthropic|m1': 1200 });
    expect(store.getMeta('aiLatency')).toBe('');

    const status = ai.readModelStatus();
    expect(status['anthropic|m1']).toEqual({ ok: true, msg: 'answered', ts: 10 });
    expect(status['opencode|x']).toMatchObject({ ok: false, msg: 'quota', retryAt: 30 });
    expect(store.getMeta('aiModelStatus')).toBe('');
    expect(store.getProviderHealthRow('anthropic|m1')).toMatchObject({ ok: 1, latencyMs: 1200 });
  });

  it('records latency without clobbering status', () => {
    const store = db.getStore();
    store.setProviderLatency('anthropic|m1', 800);
    expect(store.getProviderHealthRow('anthropic|m1')).toMatchObject({ ok: 1, msg: 'answered', latencyMs: 800 });
  });
});

describe('app state table', () => {
  it('moves legacy markers out of meta and round-trips JSON', () => {
    const store = db.getStore();
    store.setMeta('lastAI', JSON.stringify({ ok: true, message: 'done', ts: 5 }));

    expect(appState.readState('lastAI', null)).toEqual({ ok: true, message: 'done', ts: 5 });
    expect(store.getMeta('lastAI')).toBe('');

    appState.writeState('lastAnalysis', { text: 'x' });
    expect(appState.readState('lastAnalysis', null)).toEqual({ text: 'x' });
    expect(store.getAppState('lastAnalysis')).toBe('{"text":"x"}');
  });
});
