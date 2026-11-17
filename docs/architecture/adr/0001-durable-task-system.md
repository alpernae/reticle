# ADR-001: One durable task system on SQLite with an in-process worker

**Status:** Proposed
**Date:** 2026-11-17
**Deciders:** Maintainer (alpernae)

## Context

Reticle runs long work (AI calls of 10–240 s, multi-step workflows, chained automations, Apify collector runs) through four separate mechanisms:

| Mechanism | State | Cancel | After restart |
|---|---|---|---|
| `tracked()` runs (`lib/activity.ts`) | `ai_runs` table + `globalThis` Map | AbortController in memory | `interrupted` |
| Workflow jobs (`lib/jobs.ts`) | `jobs` table + `globalThis` Map (two sources of truth) | Separate stop/pause API | `interrupted` |
| Automations (`lib/automations.ts`) | JSON blob in `meta` + `globalThis` Set; polls `jobs` every 3 s | Through the `tracked()` signal | `interrupted` |
| Apify runs (`lib/apify.ts`) | JSON array in `meta.apifyRuns` | n/a | Only progressed when the Sources page polls |

As a result: imports from scheduled "Collect" steps never land unless the UI is open; no work survives a restart, even a workflow that was two-thirds done; nothing limits concurrent CLI subprocesses; and Activity has to stitch two tables together.

## Decision

Introduce a single `tasks` table (plus `task_events` for step logs) as the only record of long-running work, and a worker loop started from `instrumentation-node.ts` that claims tasks with a lease, runs the handler for the task's `kind`, checkpoints multi-step progress, and recovers expired leases on boot. HTTP routes enqueue tasks and return a `taskId`. Clients wait with a long-poll (`?wait=`) or, later, SSE.

Collector runs become a `collect` task that re-schedules itself (`status=waiting`, `run_after=now+15s`) until Apify finishes, then enqueues an `ingest` task.

## Options Considered

### Option A: SQLite `tasks` table + in-process worker (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium: about 300 lines for the worker, leases and limiter |
| Cost | None, no new infrastructure |
| Scalability | Hundreds of tasks/day easily; ample for a single user |
| Team familiarity | High: same SQLite and TS as the rest of the app |

**Pros:** durable, one model for Activity, resumable, bounded concurrency, testable with an in-memory DB, keeps local-first.
**Cons:** we own the queue semantics (leases, retries); the worker shares the event loop with HTTP.

### Option B: Redis + BullMQ
| Dimension | Assessment |
|---|---|
| Complexity | Medium: mature library, but a second service |
| Cost | An extra container and memory; a second thing to back up |
| Scalability | Far beyond need |
| Team familiarity | Medium |

**Pros:** battle-tested retries, rate limits and UI tooling.
**Cons:** breaks "one process, one file"; overkill for ≤ 100 tasks/day.

### Option C: Durable-execution platform (Temporal, Inngest, Trigger.dev)
**Pros:** best-in-class workflows, replay, versioning.
**Cons:** hosted (violates local-first) or a heavy self-hosted cluster. Rejected.

### Option D: Keep request-bound work and patch each mechanism
**Pros:** no migration.
**Cons:** keeps four state machines and fixes symptoms one by one. Rejected.

## Trade-off Analysis

The workload is small and bursty, so the strong guarantees of B and C are not needed. What *is* needed is durability across restarts, which are common (dev reloads, container updates), and one consistent model for cancel, pause and resume. A lease-based SQLite queue delivers exactly that at zero operational cost. Sharing the event loop is acceptable because the expensive part of AI work is waiting on I/O (subprocess, HTTP). CPU-heavy analytics are moved off the request path separately ([ADR-004](0004-analytics-read-model.md)).

## Consequences

- **Easier:** Activity, cancel, pause, retry and history become one query each. Scheduled collection works headless. Restarts resume work. Concurrency against provider quotas is explicit (`claude-cli: 2`, …).
- **Harder:** handlers must be written to be resumable (checkpoint after each step) and idempotent where `max_attempts > 1`. Long-poll or SSE replaces synchronous responses for Generate and Toolkit.
- **Revisit:** move the worker to a `worker_thread` or a second process if AI subprocess handling ever affects UI latency. The `tasks` table is already the contract.

## Action Items
1. [ ] Migration: `tasks`, `task_events`, indexes ([ADR-003](0003-typed-storage-and-migrations.md) runner).
2. [ ] `runtime/worker.ts`: claim via `UPDATE … RETURNING`, lease and heartbeat, boot recovery, limiter, backoff.
3. [ ] Handlers registry + `TaskCtx { signal, step, via, checkpoint }` (a superset of today's `RunCtx`).
4. [ ] Port `collect` and `ingest` first (fixes headless collection), then workflows, automations, generate, tool, brief, categorize, ask.
5. [ ] `GET /api/tasks/:id?wait=` long-poll; keep `/api/generate` and the other existing endpoints as enqueue-and-wait shims during migration.
6. [ ] One-time copy of `ai_runs` and `jobs` into `tasks`; drop the old tables and `globalThis` registries.
