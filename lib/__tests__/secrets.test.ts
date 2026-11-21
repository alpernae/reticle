import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let secrets: typeof import('../secrets');
let db: typeof import('../db');

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reticle-secrets-'));
  process.env.RETICLE_SECRET_KEY = 'ab'.repeat(32); // 32 bytes as hex
  secrets = await import('../secrets');
  db = await import('../db');
});

describe('encrypted secrets', () => {
  it('moves legacy plaintext meta secrets into the encrypted table once', () => {
    const store = db.getStore();
    store.setMeta('apifyToken', '  apify_api_legacy_1234567890  ');
    secrets.migrateLegacySecrets();

    expect(secrets.getSecret('apifyToken')).toBe('apify_api_legacy_1234567890');
    expect(store.getMeta('apifyToken')).toBe(''); // plaintext copy cleared
    expect(store.getSecretRow('apifyToken')?.ciphertext).toBeTruthy();
  });

  it('round-trips values and never stores the plaintext', () => {
    secrets.setSecret('anthropicKey', 'sk-ant-super-secret-value');
    expect(secrets.getSecret('anthropicKey')).toBe('sk-ant-super-secret-value');
    expect(secrets.hasSecret('anthropicKey')).toBe(true);

    const row = db.getStore().getSecretRow('anthropicKey')!;
    expect(JSON.stringify(row)).not.toContain('super-secret-value');
    expect(row.ciphertext).not.toBe('sk-ant-super-secret-value');
  });

  it('masks without exposing the value', () => {
    expect(secrets.secretMask('anthropicKey')).toBe('••••alue');
    expect(secrets.secretMask('missing')).toBeNull();
  });

  it('deletes on an empty value', () => {
    secrets.setSecret('youtubeApiKey', 'AIza-1234567890');
    expect(secrets.getSecret('youtubeApiKey')).toBe('AIza-1234567890');
    secrets.setSecret('youtubeApiKey', '');
    expect(secrets.getSecret('youtubeApiKey')).toBeNull();
    expect(secrets.hasSecret('youtubeApiKey')).toBe(false);
  });

  it('treats a corrupted row as not set', () => {
    db.getStore().setSecretRow('broken', 'AAAA', 'AAAA', 'AAAA');
    expect(secrets.getSecret('broken')).toBeNull();
  });
});
