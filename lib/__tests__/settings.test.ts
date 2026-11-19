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
