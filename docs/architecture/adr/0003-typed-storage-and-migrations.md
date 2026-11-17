# ADR-003: Typed storage, versioned migrations, and a separate encrypted secret store

**Status:** Proposed
**Date:** 2026-11-17
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
1. [ ] Migration runner + `user_version`; migration 001 = current schema.
2. [ ] `tx()`, statement cache, repos for posts, results, settings, secrets.
3. [ ] Migration 002: move `meta` keys into `secrets`, `settings`, `automations`, `collector_runs`, `provider_health`, `cache`; drop `accounts`; delete `ensureColumns`.
4. [ ] Wrap `importNormalized` in `tx()` and collapse `upsertPost` to one `INSERT … ON CONFLICT DO UPDATE`.
5. [ ] Nightly `VACUUM INTO` backup task; document restore in README.
