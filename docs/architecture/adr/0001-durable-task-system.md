# ADR-001: One durable task system on SQLite with an in-process worker

**Status:** Accepted
**Date:** 2026-11-17
**Accepted:** 2026-11-20
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
1. [x] Migration: `tasks`, `task_events`, indexes ([ADR-003](0003-typed-storage-and-migrations.md) runner) — migration 008.
2. [x] `runtime/worker.ts`: claim via `UPDATE … RETURNING`, lease and heartbeat, boot recovery, limiter, backoff.
3. [x] Handlers registry + `TaskCtx { signal, step, via, checkpoint }` (a superset of today's `RunCtx`).
4. [x] Port `collect` and `ingest` first (fixes headless collection), then workflows, automations, generate, tool, brief, categorize, ask.
5. [x] `GET /api/tasks/:id?wait=` long-poll; keep `/api/generate` and the other existing endpoints as enqueue-and-wait shims during migration.
6. [x] One-time copy of `ai_runs` and `jobs` into `tasks`; drop the old tables and `globalThis` registries — migration 009.

## Implementation notes (2026-11-20)

The decision was implemented in phases 3a–3h of `docs/architecture/system-design.md`.

**Tables.** Migration 008 creates `tasks` and `task_events` exactly as specified above (plus `cancel_requested`, `title`/`page`/`platform`/`trigger` for the Activity display, and the `tasks_ready`/`tasks_parent`/`tasks_created` indexes). Migration 009 (`lib/db/migrations/009-unify-tasks.ts`) copies every `ai_runs` row and every `jobs` row into `tasks` — steps become `task_events`, provider/model and timestamps are preserved, and a row that was still `running` when the app stopped becomes `failed` with the note "interrupted — the server was restarted" — then drops both old tables.

**Worker.** `lib/runtime/worker.ts` claims a task with a single atomic `UPDATE … RETURNING` statement (`claimNextTaskRow`), takes a 60 s lease, heartbeats every 5 s, and checks `cancel_requested` on each heartbeat so an in-flight AI call is aborted. On boot, `recoverTasks()` re-queues tasks whose lease expired. A failed task is retried with exponential backoff (5 s, 10 s, 20 s … capped at 2 min) while it has attempts left; `status='waiting'` tasks are re-claimed without spending an attempt (this is how `collect` waits for Apify). The worker runs at most 6 tasks at once.

**Limiter pools.** Each handler declares a `resource` and a `limit`, and the worker only claims a kind whose pool has a free slot: `ai` (2 — generate, tool, formats, brief, categorize, ask, mind map, refine), `workflow` (2), `automation` (2), `apify` (2 — collect), `apify-import` (1 — ingest). A task that queues a child never waits on its own pool.

**One model for Activity.** `lib/activity.ts` and the `tracked()` helper are gone. Every run — Generate, Toolkit, Formats, the brief, the categorizer, Ask, mind maps, workflows, automations, collectors — is a task, and `lib/application/activity.ts` maps tasks to the rows the Activity page renders. `/api/usage` and the model-status backfill read the same table. `/api/jobs` remains as a task-backed facade so the Studio workflows page keeps working.

**HTTP shape.** `lib/http/task-shim.ts` (`runTaskAndReply`) enqueues a task, waits for it and answers with the use case's `{ status, body }` — so the existing `/api/generate`, `/api/tools`, `/api/formats`, `/api/analyze`, `/api/categorize`, `/api/ask`, `/api/mindmaps` and `/api/polish` bodies are unchanged. `GET /api/tasks/:id?wait=` long-polls for the general case, and `GET /api/tasks` lists them.

**Resumability.** Workflow handlers write a checkpoint after every step, so a restarted workflow skips the steps that already finished. A use case may answer with a fallback (a template draft, a stats summary) while the task is still marked `failed` — the caller gets the fallback body, and Activity shows what really happened.

**Status:** Accepted. Revisit only if AI subprocess handling ever affects UI latency (move the worker to a `worker_thread` or a second process — the `tasks` table is already the contract).
