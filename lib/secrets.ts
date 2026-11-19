// lib/secrets.ts — API tokens encrypted at rest with AES-256-GCM.
//
// Rows live in the `secrets` table, never in `meta`. The 32-byte key comes from
// RETICLE_SECRET_KEY (hex or base64) or from DATA_DIR/.reticle.key, generated
// on first use with mode 0600. Losing the key only means re-entering tokens:
// a row that cannot be decrypted is treated as absent, and the Settings page
// shows "not set".
import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getStore } from './db';

const KEY_FILE = path.join(DATA_DIR, '.reticle.key');

/** Plaintext meta keys written by older builds; moved into `secrets` on first use. */
const LEGACY = ['apifyToken', 'anthropicKey', 'claudeOAuthToken', 'youtubeApiKey'];

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const env = (process.env.RETICLE_SECRET_KEY || '').trim();
  if (env) {
    const buf = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : Buffer.from(env, 'base64');
    if (buf.length !== 32) throw new Error('RETICLE_SECRET_KEY must be 32 bytes (64 hex chars or base64)');
    cachedKey = buf;
    return buf;
  }
  try {
    const raw = fs.readFileSync(KEY_FILE);
    if (raw.length === 32) { cachedKey = raw; return raw; }
    console.warn('[reticle] .reticle.key has the wrong length; generating a new key (old secrets will need re-entry)');
  } catch { /* first run */ }
  const fresh = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, fresh, { mode: 0o600 });
  try { fs.chmodSync(KEY_FILE, 0o600); } catch {}
  cachedKey = fresh;
  return fresh;
}

function writeSecret(store: ReturnType<typeof getStore>, name: string, value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  store.setSecretRow(name, ct.toString('base64'), iv.toString('base64'), cipher.getAuthTag().toString('base64'));
}

function readSecret(store: ReturnType<typeof getStore>, name: string): string | null {
  const row = store.getSecretRow(name);
  if (!row) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key or corrupted row → treat as not set
  }
}

let migratedLegacy = false;

/** One-time, idempotent move of plaintext meta secrets into the encrypted table. */
export function migrateLegacySecrets() {
  if (migratedLegacy) return;
  migratedLegacy = true;
  const store = getStore();
  for (const name of LEGACY) {
    const plain = (store.getMeta(name) || '').trim();
    if (!plain) continue;
    if (!store.getSecretRow(name)) writeSecret(store, name, plain);
    store.setMeta(name, ''); // the encrypted copy is now authoritative
  }
}

export function getSecret(name: string): string | null {
  migrateLegacySecrets();
  const v = readSecret(getStore(), name);
  return v && v.trim() ? v.trim() : null;
}

/** Empty value deletes the row. */
export function setSecret(name: string, value: string) {
  migrateLegacySecrets();
  const v = String(value ?? '').trim();
  const store = getStore();
  if (!v) { store.deleteSecretRow(name); return; }
  writeSecret(store, name, v);
}

export function hasSecret(name: string): boolean {
  migrateLegacySecrets();
  return !!getStore().getSecretRow(name);
}

export function secretMask(name: string): string | null {
  const v = getSecret(name);
  return v ? '••••' + v.slice(-4) : null;
}
