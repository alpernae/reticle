# ADR-003: Typed storage, versioned migrations, and a separate encrypted secret store

**Status:** Accepted
**Date:** 2026-11-17
**Accepted:** 2026-11-20
**Deciders:** Maintainer (alpernae)

## Context

- The `meta (key, value)` table holds 22+ keys of very different kinds: **secrets** (`apifyToken`, `anthropicKey`, `claudeOAuthToken`, `youtubeApiKey`) in plaintext; **config** (`aiConfig`, `apifyConfig`, `creatorProfile`, `playbook`, …); **operational state** (`apifyRuns` up to 80 entries, `automations` with embedded history, `mindmaps`, `trackers`); **telemetry** (`aiLatency`, `aiModelStatus`, `lastAI`, `lastGoodModel`, written on every AI call); and **caches** (`opencodeModelList`). Each change rewrites a whole JSON blob. None of it can be indexed, queried or validated.
- Schema changes are made by `try { ALTER TABLE … } catch {}` and an `ensureColumns()` that runs at module load. `ai_runs` is created in two places, the `accounts` table is unused, and there is no schema version (`lib/db.ts:232-316`).
- `upsertPost` issues 3 autocommit statements per post. Imports are not transactional (`lib/db.ts:44-60`, `lib/normalize.ts:313-339`).
- `getStore()` builds a new wrapper and re-prepares statements on every call.

## Decision

1. **Migrations:** ordered files `infrastructure/db/migrations/NNN_*.sql|ts`, applied in one transaction on first DB open and tracked with `PRAGMA user_version`. Migration 001 reproduces today's schema exactly (so existing installs upgrade cleanly). Later migrations move data out of `meta`.
2. **Typed tables** for operational state: `tasks` / `task_events` ([ADR-001](0001-durable-task-system.md)), `collector_runs`, `automations`, `mindmaps`, `trackers`, `provider_health`, `cache`, `analytics_snapshot` ([ADR-004](0004-analytics-read-model.md)).
3. **`settings(key, value JSON, version)`** for user configuration, with a schema per key (Zod or hand-written) validated on both read and write and exposed through typed accessors. Adds `timezone`.
4. **`secrets(name, ciphertext, iv, tag, updated)`**, AES-256-GCM. The key is in `DATA_DIR/.reticle.key` (mode 0600, generated on first run) or the `RETICLE_SECRET_KEY` env var. Secrets are write-only over HTTP (reads return a mask).
5. **Connection hygiene:** one handle; `foreign_keys=ON`, `synchronous=NORMAL`, `busy_timeout=5000`; per-repo prepared-statement cache; a `tx(fn)` helper using `BEGIN IMMEDIATE`; every multi-write use case (import, categorize batch, automation save) runs in `tx`.
6. **Backups:** a nightly `VACUUM INTO` task keeping 7 snapshots under `DATA_DIR/backups/`.

## Options Considered

### Option A: Hand-written migrations + repos on `node:sqlite` (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low: a 60-line runner plus SQL files |
| Cost | None; keeps zero native deps |
| Scalability | Ample |
| Team familiarity | High: already raw SQL today |

**Pros:** no new dependency; explicit SQL; works with the existing `node:sqlite` choice.
**Cons:** query typing is manual (row casts).

### Option B: Drizzle ORM or Kysely over `node:sqlite`
**Pros:** typed queries, generated migrations (Drizzle Kit).
**Cons:** adds a dependency and a learning step during an already large refactor; driver support for `node:sqlite` is newer than for better-sqlite3. **Deferred**, and easy to adopt later because repos hide the query layer.

### Option C: Keep `meta` and add validation only
**Pros:** smallest change.
**Cons:** blobs stay unqueryable and secrets stay in plaintext next to data. Rejected.

## Trade-off Analysis

The data set is tiny but heterogeneous. The real problems are *mixing kinds of state* and *unversioned evolution*, not query ergonomics. Option A fixes both with no new dependency. Encrypting secrets with a key file next to the DB does not stop an attacker who has the whole data directory, but it does protect against the common leak paths: copying or sharing `data.sqlite` for debugging, backups uploaded somewhere, and `docker compose cp` of the DB.

## Consequences

- **Easier:** querying run history and automation history; schema evolution; data integrity (transactions, FKs); safe DB sharing for bug reports.
- **Harder:** the migration must handle existing installs (move `meta` keys idempotently, keep the old keys until the next release); losing the key file makes secrets unrecoverable (the user re-enters them, and the UI must say so).
- **Revisit:** adopt Kysely or Drizzle if hand-written row typing becomes a source of bugs.

## Action Items
1. [x] Migration runner + `user_version`; migration 001 = current schema.
2. [x] `tx()`, statement cache, repos for posts, results, settings, secrets.
3. [x] Migration 002: move `meta` keys into `secrets`, `settings`, `automations`, `collector_runs`, `provider_health`, `cache`; drop `accounts`; delete `ensureColumns`.
4. [x] Wrap `importNormalized` in `tx()` and collapse `upsertPost` to one `INSERT … ON CONFLICT DO UPDATE`.
5. [x] Nightly `VACUUM INTO` backup task; document restore in README.

## Implementation Notes (2026-11-20)

The decision landed as written, spread over two sessions:

- **The runner** is `lib/db/migrate.ts` — ordered TypeScript modules applied
  inside one transaction per migration, tracked with `PRAGMA user_version`.
  Migration 001 reproduces the old schema exactly, so an existing install
  upgrades without a wipe.
- **Migrations 002–007** did the move out of `meta`: encrypted secrets
  (AES-256-GCM), typed `settings`, and real tables for automations,
  collector runs, caches, provider health, app state, mind maps and
  trackers. `accounts` and `ensureColumns` are gone; a legacy `meta` value
  migrates lazily on first read and the `meta` copy is cleared.
- **`tx()`** uses `BEGIN IMMEDIATE`; the import path runs its upserts inside
  one transaction. The prepared-statement cache lives on the store handle,
  so a statement is prepared once per process.
- **The nightly backup** landed with phase 4e: a task (`kind: 'backup'`)
  that runs `VACUUM INTO` into `DATA_DIR/backups`, keeps the newest seven
  and reschedules itself for the next 03:00. The Settings page can take one
  by hand; `GET /api/status` reports the copies.
- **Two deviations.** The `secrets` table stores the ciphertext, the IV and
  the tag in one row (the decision listed three columns — one row is
  simpler and keeps the write atomic). And `settings` has no `version`
  column: the schema is validated on read and write instead, so a stale
  version would only be a second thing to migrate.
- **Restore** is documented in the README: stop the app, copy a backup over
  `data.sqlite`, start the app — and keep the same secrets key, or the
  stored tokens are unreadable and have to be entered again.

### Deviations

- **The migration folder moved.** The decision named
  `infrastructure/db/migrations/`; the files live in `lib/db/migrations/`,
  because ADR-002 replaced the old `infrastructure/` naming with the
  `lib/domain` → `lib/application` → `lib/http` + infra layers.
- **The per-key settings schema is partial.** The table has the promised
  shape (`key`, `value` JSON, `version`) and the typed accessors exist, but
  validation is a per-key parser passed to `readSetting(key, fallback,
  parse?)` rather than a full schema per key, and `writeSetting` does not
  validate on write. Enough to keep a bad value from crashing a read; not
  the complete contract the decision describes.
- **`tx()` covers the multi-write paths that exist.** The import
  (`lib/normalize.ts`), the analytics rebuild and the tracker batch run in a
  transaction; the categorize batch was moved into one as well. The
  automation save is a single row write, so it needs none.
- **The key file's `0600` mode is a POSIX bit.** It is applied where the
  platform supports it; on Windows the file inherits the user's own data
  directory permissions.
