// lib/settings-schema.ts — one hand-written schema per settings key (ADR-003).
//
// The ADR asks for "a schema per key (Zod or hand-written) validated on both
// read and write". This is the hand-written version: no new dependency, and
// the checks are deliberately permissive.
//
// Permissive means two things:
//
//   • a stored row that does not fit falls back to the default instead of
//     crashing a page — a bad setting is never worse than a missing one;
//   • a field this build does not know about is kept as it is, so a value
//     written by a newer build survives a round trip through this layer.
//
// The consumers (readAIConfig, readConfig, readProfile …) still do their own
// per-field checks; this layer guards the *shape* of the value and the one
// place where a bad value can be written in the first place.
import 'server-only';

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export type Schema<T = unknown> = {
  /** A short name for the shape, used in error messages. */
  kind: string;
  check(value: unknown): Checked<T>;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A leaf schema: one test, one error message. */
function leaf<T>(kind: string, test: (v: unknown) => string | null): Schema<T> {
  return {
    kind,
    check(value) {
      const err = test(value);
      return err ? { ok: false, error: err } : { ok: true, value: value as T };
    },
  };
}

/**
 * An object schema: every known field is checked, unknown fields are kept.
 * An absent field is fine — the consumer has a default for it.
 */
function object<T extends Record<string, unknown>>(fields: Record<string, Schema<any>>): Schema<T> {
  return {
    kind: 'object',
    check(value) {
      if (!isPlainObject(value)) return { ok: false, error: 'expected an object' };
      for (const [key, sch] of Object.entries(fields)) {
        if (!(key in value)) continue;
        const res = sch.check(value[key]);
        if (!res.ok) return { ok: false, error: `${key} ${res.error}` };
      }
      return { ok: true, value: value as T };
    },
  };
}

// ---------------- leaves ----------------
export const aString = leaf<string>('a string', v => (typeof v === 'string' ? null : 'should be a string'));
export const aNumber = leaf<number>('a number', v => (typeof v === 'number' && Number.isFinite(v) ? null : 'should be a finite number'));
export const aNonNegative = leaf<number>('a number', v =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null : 'should be a number ≥ 0');
export const aStringArray = leaf<string[]>('a list of strings', v =>
  Array.isArray(v) && v.every(x => typeof x === 'string') ? null : 'should be a list of strings');
export const aStringMap = leaf<Record<string, string>>('a text map', v =>
  isPlainObject(v) && Object.values(v).every(x => typeof x === 'string') ? null : 'should be a map of strings');
export const aBooleanMap = leaf<Record<string, boolean>>('a switch map', v =>
  isPlainObject(v) && Object.values(v).every(x => typeof x === 'boolean') ? null : 'should be a map of booleans');

// ---------------- the registry ----------------

/** One platform's collector settings. */
const platformConfig = object({ actor: aString, maxItems: aNumber, sources: aString });

/** The AI router's settings. */
const aiConfig = object({
  order: aStringArray,
  enabled: aBooleanMap,
  apiModel: aString,
  apiEffort: aString,
  cliModel: aString,
  cliPath: aString,
  opencodeModel: aString,
});

/** The collector settings, per platform. */
const apifyConfig = object({
  x: platformConfig,
  linkedin: platformConfig,
  instagram: platformConfig,
  threads: platformConfig,
  tiktok: platformConfig,
  youtube: platformConfig,
});

/** The creator profile from Settings. */
const creatorProfile = object({
  name: aString,
  handle: aString,
  identity: aString,
  pillars: aString,
  audience: aString,
  voice: aString,
  goals: aString,
  avoid: aString,
});

/** The playbook overrides from Settings: four buckets of per-key texts. */
const playbook = object({
  platforms: aStringMap,
  formats: aStringMap,
  roles: aStringMap,
  voice: aStringMap,
});

/**
 * Every settings key this build knows about.
 *
 * A key that is not here is still allowed — the settings table is open to
 * extension, and an unknown key is stored as it is.
 */
export const SETTING_SCHEMAS: Record<string, Schema<any>> = {
  aiConfig,
  apifyConfig,
  creatorProfile,
  playbook,
  timezone: aString,
  apifyBudgetUsd: aNonNegative,
  aiDailyRunBudget: aNonNegative,
};

/** The schema for a key, if this build knows one. */
export function schemaFor(key: string): Schema<any> | undefined {
  return SETTING_SCHEMAS[key];
}
