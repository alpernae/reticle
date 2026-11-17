# ADR-004: Materialized analytics read model, keyed by a data version

**Status:** Proposed
**Date:** 2026-11-17
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
1. [ ] Phase-0 stopgap: memoize `load()` / `analyze()` by a `data_version` counter.
2. [ ] Migration: derived columns + baselines tables + `analytics_snapshot`.
3. [ ] Derive at ingest, inside the import transaction; bump `data_version`.
4. [ ] `analytics.rebuild` task (debounced) + 15-minute refresh; pass `tz` into hour bucketing.
5. [ ] Page-scoped read endpoints; retire `/api/state`.
