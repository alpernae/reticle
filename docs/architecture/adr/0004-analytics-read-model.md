# ADR-004: Materialized analytics read model, keyed by a data version

**Status:** Accepted
**Date:** 2026-11-17
**Accepted:** 2026-11-20
**Deciders:** Maintainer (alpernae)

## Context

Every analytics read rebuilds everything from raw rows:

- `load()` (`lib/engine.ts:25`) runs `SELECT * FROM posts` (≤ 6,000 rows, bodies up to 5 KB) and JSON-parses topics, hashtags and categories for each row.
- `analysisDigest()` calls it about 4× (`topicSpikes`, `hookStats`, `analyze(load())`, `hourHistogram`). `/api/generate` calls `allPayload()` twice plus `topicSpikes()`. A workflow's `buildCtx` does about 7 loads.
- `/api/state` returns **every post** to the browser together with timing, outliers and geo.
- All of it is synchronous (`node:sqlite` plus CPU work) on the single event loop, so one heavy request delays every other request, including the auth check in `proxy.ts`.
- Hour buckets use the server's local time (`getHours()`), which is UTC in Docker.

The underlying data only changes on ingest, categorization, result logging and classifier upgrades, which happen a few times a day.

## Decision

Compute analytics **when data changes**, not when it is read:

1. **Derived columns on `posts`** written at ingest: `eng`, `hook`, `hook_line`, `words`, `length_bucket`, `has_link`, `emoji_count`, `outlier`, `baseline`.
2. **Baselines tables** `author_baselines` and `platform_baselines`, updated in the ingest transaction for the affected authors and platforms. `outlier` is recomputed only for those authors' posts.
3. **`data_version`** (a counter in `settings`) is bumped by every write that affects analytics.
4. **`analytics_snapshot(version, computed_at, tz, payload)`** holds the pattern library, topic spikes, hook stats, hour histogram (in the user's timezone), recycled clusters, geo regions and digest text. It is rebuilt by a debounced `analytics.rebuild` task ([ADR-001](0001-durable-task-system.md)) when `data_version` or `tz` changes, plus a 15-minute refresh for time-window metrics.
5. **Reads** go through `analytics.snapshot()` (a single-row read, memoized by version) plus indexed queries (`ORDER BY outlier DESC LIMIT n`, cursor pagination).
6. **`/api/state` is replaced** by page-scoped endpoints (`/api/overview`, `/api/posts`, `/api/patterns`, `/api/best-time`).

## Options Considered

### Option A: Snapshot + derived columns (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium: ingest gains a derive step; one rebuild task |
| Cost | A few hundred KB of extra storage |
| Scalability | Reads are O(1); rebuild is O(n log n), about once per import |
| Team familiarity | High: same functions, called at a different time |

**Pros:** request latency independent of corpus size; the event loop is freed; prompts and pages read the same numbers; easy to inspect (the snapshot *is* "what the AI saw").
**Cons:** staleness window (about 2 s debounce after ingest); cache invalidation is now our job.

### Option B: In-memory memoization of `load()` keyed by `data_version`
**Pros:** a tiny change and a big immediate win (about 7 loads become 1).
**Cons:** still blocks the request that misses the cache; still sends the whole corpus to the browser; lost on restart. **Adopt as a phase-0 stopgap**, not as the end state.

### Option C: SQL views and aggregates for everything
**Pros:** no derived state.
**Cons:** medians, hook classification and pattern lifts are awkward or impossible in SQLite SQL; the logic would split between TS and SQL. Rejected.

## Trade-off Analysis

The read:write ratio is very high (pages poll every few seconds; data changes a few times a day), which is the textbook case for a materialized read model. Domain functions (`analyze`, `patternLibrary`, …) are reused unchanged. Only *when* and *where* they run changes, so the risk is low.

## Consequences

- **Easier:** fast page loads at any corpus size; consistent numbers across Overview, Generate and prompts; correct local-time analytics; reproducible prompts (snapshot version recorded on each task).
- **Harder:** every analytics-affecting write must bump `data_version` (enforce this inside the repos, not at call sites).
- **Revisit:** past about 50k posts, make baselines incremental (streaming medians or t-digest) instead of recomputing per affected author.

## Action Items
1. [x] Phase-0 stopgap: memoize `load()` / `analyze()` by a `data_version` counter.
2. [x] Migration: derived columns + baselines tables + `analytics_snapshot`.
3. [x] Derive at ingest, inside the import transaction; bump `data_version`.
4. [x] `analytics.rebuild` task (debounced) + 15-minute refresh; pass `tz` into hour bucketing.
5. [x] Page-scoped read endpoints; retire `/api/state`.

## Implementation Notes (2026-11-20)

The decision landed as written, with four deviations worth recording:

- **The version counter lives in `app_state`, not `settings`.** `app_state` is
  already the home of the operational markers, so a new key (`dataVersion`)
  was cheaper than a second table of typed settings. It is read through
  `lib/data-version.ts` (`dataVersion()`, `bumpDataVersion()`), which lives
  in the infrastructure layer — the application layer must not be imported
  from below it.
- **The baselines are recomputed in full, not per affected author.** The ADR
  proposed updating only the affected authors' baselines inside the import
  transaction. That needs incremental medians, which is the thing this ADR
  explicitly deferred ("revisit past about 50k posts"). At the current
  corpus size (≤ 6,000 posts) a full recompute in the rebuild task is
  simpler and exact. The *ingest* step still writes each post's derived
  facts immediately, so the columns are never empty; only the outlier waits
  for the rebuild, because it needs the yardsticks.
- **One implementation of the yardsticks.** The analyzer and the read model
  must not drift, so `computeBaselines()` and `outlierOf()` live in
  `lib/domain/patterns.ts` and both sides call them. The rebuild test
  asserts that the materialized pattern library equals the live one.
- **The snapshot is not a cache of "everything the AI saw" — it is the
  aggregate.** The digest text and the winner cards are still computed on
  demand (they are prompt inputs, not page reads); the snapshot holds the
  pattern library, topic spikes, hook stats, hour histogram and geo. The
  Overview's KPIs, day buckets and counts come from the derived columns and
  indexed queries instead.

### What landed

| Piece | Where |
|---|---|
| Migration 010 — derived columns, baselines, snapshot | `lib/db/migrations/010-analytics.ts` |
| Version counter | `lib/data-version.ts` (`app_state.dataVersion`) |
| Snapshot reader (single row, stale-checked) | `lib/analytics-read.ts` |
| Rebuild + debounced scheduling | `lib/application/analytics.ts` |
| Ingest-time derivation | `lib/derive-post.ts` (called from `lib/normalize.ts`) |
| Shared yardsticks | `lib/domain/patterns.ts` (`computeBaselines`, `outlierOf`) |
| Task kind `analytics` | `lib/application/task-handlers.ts` |
| 15-minute refresh | `lib/startup.ts` (scheduler tick) |
| Page-scoped endpoints | `app/api/{overview,posts,best-time,summary,topics,patterns,manual}/route.ts` |
| Read models | `lib/application/{overview,posts,best-time,patterns,topics}.ts` |

`/api/state` is gone (404). The whole corpus no longer leaves the server
unless a page asks for a post by name.

### Verification

- `lib/__tests__/analytics.test.ts` — the derived columns, the outliers
  (against the live analyzer), the baselines, the snapshot lifecycle and the
  pattern-library agreement.
- `lib/__tests__/reads.test.ts` — the Overview buckets, filters and search;
  the Feed page, cursor, sorts and stats; the best-time points.
- Live check (temp `DATA_DIR`, `next start`): the boot rebuild materialized
  the columns, the baselines and the snapshot; every endpoint answered with
  the expected numbers; `/api/state` returned 404.

### Still open

- **Incremental baselines** past about 50k posts (see the consequences
  section).

### Phase 4e (implemented the same day)

The optional last piece of the phase landed too:

- The **nightly backup** is a task (`kind: 'backup'`) that runs `VACUUM INTO`
  — a consistent, compacted copy while the app keeps running — keeps the
  newest seven and reschedules itself for the next 03:00.
- **`GET /api/health`** is open and minimal (the app, the database, the
  uptime) so the Docker `HEALTHCHECK` can use it; **`GET /api/status`** is the
  full picture behind the session.
- **`GET /api/events`** is the live stream: one SSE connection per tab
  carries the activity summary the shell used to poll for.
