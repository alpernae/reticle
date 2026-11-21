import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db: typeof import('../db');
let settings: typeof import('../settings');

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-settings-'));
  db = await import('../db');
  settings = await import('../settings');
});

describe('settings', () => {
  it('moves legacy meta config into the settings table once', () => {
    const store = db.getStore();
    store.setMeta('aiConfig', JSON.stringify({ cliModel: 'sonnet' }));
    store.setMeta('timezone', 'Europe/Istanbul');
    store.setMeta('apifyBudgetUsd', '12.5');
    store.setMeta('creatorProfile', JSON.stringify({ name: 'Alperen' }));

    expect(settings.readSetting('aiConfig', {})).toEqual({ cliModel: 'sonnet' });
    expect(settings.readSetting('timezone', '')).toBe('Europe/Istanbul');
    expect(settings.readSetting('apifyBudgetUsd', 0)).toBe(12.5);
    expect(settings.readSetting('creatorProfile', {})).toMatchObject({ name: 'Alperen' });

    expect(store.getMeta('timezone')).toBe(''); // plaintext meta copy cleared
    expect(store.getSettingRow('timezone')?.value).toBe('"Europe/Istanbul"');

    // Idempotent: a second pass must not duplicate or overwrite.
    settings.migrateLegacySettings();
    expect(settings.readSetting('aiConfig', {})).toEqual({ cliModel: 'sonnet' });
  });

  it('round-trips and deletes a value', () => {
    settings.writeSetting('playbook', { platforms: { x: 'be direct' } });
    expect(settings.readSetting('playbook', {})).toEqual({ platforms: { x: 'be direct' } });
    settings.deleteSetting('playbook');
    expect(settings.readSetting('playbook', { fallback: true })).toEqual({ fallback: true });
  });

  it('falls back on unreadable JSON and applies the validator', () => {
    db.getStore().setSettingRow('broken', '{nope', 1);
    expect(settings.readSetting('broken', 'fallback')).toBe('fallback');

    settings.writeSetting('count', 5);
    expect(settings.readSetting('count', 0, v => (typeof v === 'number' && v > 10 ? v : null))).toBe(0);
  });
});

describe('the per-key schemas (ADR-003)', () => {
  it('accepts a well-formed value and keeps fields it does not know', () => {
    settings.writeSetting('aiConfig', { order: ['claude-cli'], enabled: { 'claude-cli': true }, futureField: 42 });
    const read = settings.readSetting<Record<string, any>>('aiConfig', {});
    expect(read.order).toEqual(['claude-cli']);
    expect(read.enabled['claude-cli']).toBe(true);
    expect(read.futureField).toBe(42); // a newer build's field survives
  });

  it('refuses a value that does not fit the key', () => {
    expect(() => settings.writeSetting('aiConfig', { order: 'claude-cli' })).toThrow(settings.SettingError);
    expect(() => settings.writeSetting('apifyBudgetUsd', -5)).toThrow(settings.SettingError);
    expect(() => settings.writeSetting('timezone', { zone: 'Europe/Istanbul' })).toThrow(settings.SettingError);
    expect(() => settings.writeSetting('creatorProfile', { name: 42 })).toThrow(settings.SettingError);
    // the last good value is still there
    expect(settings.readSetting<Record<string, any>>('aiConfig', {}).order).toEqual(['claude-cli']);
  });

  it('falls back to the default when a stored row is broken', () => {
    db.getStore().setSettingRow('apifyConfig', JSON.stringify({ x: 'not-an-object' }), 1);
    expect(settings.readSetting('apifyConfig', { fallback: true })).toEqual({ fallback: true });
    // a valid row still comes through
    db.getStore().setSettingRow('apifyConfig', JSON.stringify({ x: { actor: 'a/b', maxItems: 10, sources: '@a' } }), 1);
    expect(settings.readSetting<any>('apifyConfig', {}).x.actor).toBe('a/b');
  });

  it('leaves unknown keys alone', () => {
    settings.writeSetting('someFutureKey', { anything: true });
    expect(settings.readSetting('someFutureKey', {})).toEqual({ anything: true });
  });

  it('answers a rejected write with a 400', async () => {
    const { route } = await import('../http/route');
    const token = 'settings-test-session';
    db.getStore().addSession(token, 'admin@test.local', Date.now() + 60_000);

    const handler = route(async () => {
      settings.writeSetting('apifyBudgetUsd', -1); // refused by the schema
      return { ok: true };
    });
    const req = new Request('http://localhost/api/settings', { headers: { cookie: `sf_ses=${token}` } });
    const res = await handler(req);

    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('apifyBudgetUsd');
  });
});
