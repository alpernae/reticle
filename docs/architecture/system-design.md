# Reticle: Backend Architecture Review & Target System Design

**Status:** Implemented (phases 0–4 shipped on 2026-11-20)
**Date:** 2026-11-17
**Scope:** Backend only: runtime, data, background work, AI integration, collectors, security boundaries. UI/UX is out of scope.
**Decision records:** [adr/](adr/) (ADR-001 … ADR-006 — all Accepted)

---

## 1. TL;DR

Reticle's core idea is sound: one local process, one SQLite file, and the user's own AI and Apify accounts. The pure domain logic (`patterns.ts`, `score.ts`, `normalize.ts`) is good. The **runtime architecture** around that logic has not kept up with the features. It currently has:

- **Four separate ways to run long work** (request-bound `ai_runs`, fire-and-forget `jobs`, automations that poll `jobs`, and Apify runs kept as a JSON blob). Each tracks state, cancels, and recovers after a restart in its own way, and none of them resumes after a restart.
- **Business logic inside route handlers.** Automations import `app/api/*/route.ts` and send fake `Request`s to them.
- **Analytics rebuilt from scratch, synchronously, several times per request.** Each rebuild is a full table load of up to 6,000 posts, and it blocks the event loop for every request.
- **A key-value `meta` table used for everything.** It holds secrets, config, run history, automations, telemetry and caches, all as untyped JSON.
- **Two correctness bugs that come from the architecture:**
  1. Collector runs only import their data **while someone has the Sources page open**, so a scheduled "Collect" automation never actually lands posts.
  2. Schedules and best-hour analytics use the **server's** local time, which is UTC inside the Docker image.

**Recommendation:** keep the single-process, SQLite, local-first shape (it is the right call for this product) and restructure the inside into a **layered modular monolith** built on four mechanisms:

1. **One durable task system** in SQLite with an in-process worker. It replaces `ai_runs`, `jobs`, automation polling and the Apify run blob. → [ADR-001](adr/0001-durable-task-system.md)
2. **Layered modules**: `domain` (pure) → `application` (use cases) → `infrastructure` (DB, AI, Apify). Routes become thin adapters. → [ADR-002](adr/0002-layered-modules.md)
3. **Typed storage**: real tables, versioned migrations, and secrets kept apart from settings. → [ADR-003](adr/0003-typed-storage-and-migrations.md)
4. **A materialized analytics read model** keyed by a data version. Analytics are computed once per data change instead of once per request. → [ADR-004](adr/0004-analytics-read-model.md)

On top of these: auth checks move into a data-access layer, and the scheduler runs in-process instead of calling its own HTTP endpoint. → [ADR-005](adr/0005-auth-dal-and-in-process-scheduler.md)

And the product side: a viral finder that ranks the corpus by relative lift damped by recency, and a generation flow that copies a winning post's **structure** — never its wording. → [ADR-006](adr/0006-viral-discovery-and-structure-inspired-generation.md)

Nothing here adds a server, a container or a paid dependency.

---

## 2. Requirements & assumptions

### Functional (what exists today and must keep working)
- Collect posts from 6 platforms through Apify or the YouTube Data API, normalize them to one schema, and store them.
- Score outliers, compute pattern lifts, best times, recycled posts and geo regions.
- AI generation through 3 providers with fallback and per-run pinning: Generate, Toolkit, Formats, Ask, mind maps, categorizer.
- Multi-step Workflows (pausable) and Automations (chained steps on a schedule).
- An Activity log of every AI run: live steps, cancel, reopen the result.
- A single owner account with session cookie auth.

### Non-functional
| Dimension | Target | Notes |
|---|---|---|
| Users | 1 (owner) | Not a SaaS; multi-tenancy is a non-goal |
| Data volume | ≤ 10k posts (pruned window), ≤ 1k AI runs kept | Today: 6,000-post cap, 500 runs |
| Write rate | Bursty: an import of ≤ 1,000 items; ≤ ~100 AI runs/day | Low steady state |
| AI latency | 10–240 s per call | Dominated by the provider, not by Reticle |
| Read latency | p95 < 150 ms for page data | Today it grows with post count × recompute passes |
| Durability | No accepted work lost on restart; runs resume or fail explicitly | Today: everything in flight becomes `interrupted` |
| Availability | Best effort, single node | Restarts are normal: dev reloads, container updates |
| Footprint | One Node process, one file, one volume | A core product value |
| Privacy | Secrets never leave the machine except to their own provider | Today stored in plaintext in `meta` |

### Constraints
- Node 24 (`node:sqlite`), Next.js 16 App Router, Docker single container.
- Solo maintainer: complexity budget is small, and every new moving part must pay for itself.
- No telemetry and no external infrastructure (README: "keep it local-first").
- **No local model runtime.** AI providers are Claude CLI, Claude API and OpenCode. The earlier Ollama / DeepSeek-R1 provider and fine-tuning plan was dropped on 2026-11-19 and must not be reintroduced as part of this work.

---

## 3. Current architecture (as-is)

```
 Browser (client components, 6 pages polling every 1.5–20 s)
    │  fetch /api/*
    ▼
 ┌──────────────────────── Next.js 16 process ───────────────────────────────┐
 │ proxy.ts ── sessionUser() → SQLite on EVERY request (incl. prefetch)      │
 │            └ special bypass for /api/automations/tick (scheduler key)     │
 │                                                                           │
 │ app/api/* (28 route handlers) ── business logic inline                    │
 │   generate/route.ts (prompt build + parse + score, 170 lines)             │
 │   tools/route.ts …           ▲                                            │
 │                              │ import + fake Request()                    │
 │ lib/automations.ts ──────────┘   polls jobs table every 3 s               │
 │ lib/jobs.ts     ── fire-and-forget promise, runtime in globalThis Map     │
 │ lib/activity.ts ── request-bound run, AbortController in globalThis Map   │
 │ lib/apify.ts    ── run history = JSON array in meta; imports on poll-read │
 │ lib/engine.ts   ── load(): SELECT * posts → map → analyze, ×N per request │
 │ lib/ai.ts       ── CLI subprocess / SDK / OpenCode; 4 meta writes per call│
 │ lib/startup.ts  ── setInterval → fetch(127.0.0.1:PORT/api/…/tick)         │
 │                                                                           │
 │ SQLite (data.sqlite, WAL): posts · manual · jobs · ai_runs · users ·      │
 │   sessions · meta{22+ keys: secrets, config, blobs, telemetry, caches}    │
 └───────────────────────────────────────────────────────────────────────────┘
        │ spawn            │ HTTPS               │ HTTP (local)
   claude CLI         Anthropic API · Apify   OpenCode service
```

### 3.1 Findings

Severity: 🔴 correctness or data loss · 🟠 reliability or performance · 🟡 maintainability.

| # | Finding | Evidence | Sev | Status |
|---|---|---|---|---|
| F1 | **Collector imports only happen on read.** Finished Apify runs are imported only when `GET /api/apify` or `GET /api/apify/run?id=` is called, which happens only while the Sources page is open. An automation's "Collect" step only *starts* a run, so scheduled collection never imports anything. | `app/api/apify/route.ts:10`, `lib/apify.ts:481`, `lib/automations.ts:190-194` | 🔴 | ✅ closed |
| F2 | **Schedules and time analytics use the server's local time.** `setHours()` and `getHours()` run in the process TZ, and the Docker image sets none (UTC), so "Daily 09:00" fires at 09:00 UTC. Best-hour histograms and pattern `time` buckets shift the same way. | `lib/schedule.ts:16`, `lib/patterns.ts:120`, `lib/engine.ts:151`, `Dockerfile` | 🔴 | ✅ closed |
| F3 | **Four separate execution models for long work** (`tracked()` runs, `jobs`, automations, Apify runs), each with its own state machine, cancel path and restart handling. Activity has to stitch two of them together (`jobToRun`). | `lib/activity.ts`, `lib/jobs.ts`, `lib/automations.ts`, `app/api/activity/route.ts:53` | 🟠 | ✅ closed |
| F4 | **Nothing resumes after a restart.** Live state (steps, pause flag, abort controller) lives in `globalThis` Maps and is copied into SQLite, so there are two sources of truth. On restart every in-flight run, job and automation becomes `interrupted`, including a 3-step workflow that finished 2 steps. | `lib/jobs.ts:21,199-207,287`, `lib/activity.ts:16,41` | 🟠 | ✅ closed |
| F5 | **Layering inversion.** The domain layer (`lib/automations.ts`) imports route handlers and builds fake `Request` objects. Generate's real logic (picking winners, building the prompt, parsing, fitting, scoring) lives in the route file. | `lib/automations.ts:159,170`, `app/api/generate/route.ts:27-147` | 🟡 | ✅ closed |
| F6 | **Analytics are recomputed in full, synchronously, several times per request.** `load()` = `SELECT *` over ≤6k posts plus JSON parsing. `analysisDigest()` calls it 4×. `/api/generate` calls `allPayload()` twice plus `topicSpikes()`. A workflow's `buildCtx` does about 7 loads. All of this is synchronous `node:sqlite` plus CPU work on the single event loop, so every other request (including auth in `proxy.ts`) waits. | `lib/engine.ts:25,181-203,238`, `app/api/generate/route.ts:46,60,132`, `lib/jobs.ts:39-54` | 🟠 | ✅ closed |
| F7 | **`/api/state` sends the whole database to the browser:** every post with its body, plus timing, outliers and geo, on each Overview reload. | `app/api/state/route.ts:8`, `lib/engine.ts:238-263` | 🟠 | ✅ closed |
| F8 | **`meta` is a junk drawer.** Over 22 keys: secrets (`apifyToken`, `anthropicKey`, `claudeOAuthToken`, `youtubeApiKey`) in plaintext next to config, an 80-entry run history, automations with embedded history, mind maps, latency, health and caches. Blobs are rewritten whole on every change. Nothing can be queried, indexed or validated. | `grep getMeta/setMeta`; `lib/apify.ts:130-144`, `lib/automations.ts:60-70` | 🟠 | ✅ closed |
| F9 | **Ad-hoc schema evolution.** `try { ALTER TABLE } catch {}`, `ensureColumns()` at module load, `ai_runs` created in two places, an unused `accounts` table, and legacy columns (`T`, `text` vs `body`, `score` = likes, `security`/`dev` flags). There is no schema version. | `lib/db.ts:232-235,264-268,300-316` | 🟡 | ✅ closed |
| F10 | **Imports are not transactional.** `upsertPost` runs 3 statements per post with autocommit. A 1,000-item import means about 3,000 WAL commits, and a crash leaves a partial import. | `lib/db.ts:44-60`, `lib/normalize.ts:313-339` | 🟠 | ✅ closed |
| F11 | **Auth lives only in `proxy.ts`.** No route verifies the session itself. Next 16 docs: Proxy is for *optimistic* checks and "should not be your only line of defense". Proxy also queries SQLite on every request including prefetches, and carries a scheduler-key bypass. The Docker image binds `0.0.0.0`. | `proxy.ts:12,17-23`; `node_modules/next/dist/docs/01-app/02-guides/authentication.md:1033,1121` | 🟠 | ✅ closed |
| F12 | **The scheduler calls itself over HTTP** (`fetch(127.0.0.1:PORT/…/tick)`) with a key stored in `meta`. This only works if PORT and the loopback match the bind address, and it is the only reason the proxy bypass exists. | `lib/startup.ts:50`, `proxy.ts:17-23` | 🟡 | ✅ closed |
| F13 | **No concurrency control on AI providers.** Every request can spawn its own `claude -p` subprocess. With parallel Generate, an automation and a workflow, N CLI processes compete for the same subscription quota. Every call also writes 4 `meta` keys (`aiLatency`, `aiModelStatus`, `lastAI`, `lastGoodModel`). | `lib/ai.ts:208-230,262-298`, `lib/aichain.ts:23-24` | 🟠 | ✅ closed |
| F14 | **Startup changes user config.** Every boot re-enables OpenCode, overriding a user who turned it off. | `lib/startup.ts:13-14` | 🟡 | ✅ closed |
| F15 | **No automated tests or typecheck script**, even though the domain modules are pure and easy to test. | `package.json` scripts | 🟡 | ✅ closed |

**What is already good and should be kept:** the provider-runner abstraction (`RUNNERS`), defensive normalizers, budget guards checked before spending, idempotent imports keyed by post id, `server-only` boundaries, and honest "stats-only" fallbacks when AI is down.

**Status:** all fifteen findings are closed. Phases 0–4 in the migration plan below did the work; the status note at the end of this document says what landed where.

---

## 4. Target architecture

### 4.1 Principles
1. **Still one process and one file.** The product's local-first promise is a feature, not a limitation.
2. **SQLite is the single source of truth for every piece of state that outlives one function call.** In-memory state is only a cache of the DB, never the authority.
3. **All long work is a durable task.** HTTP requests *enqueue* work and return immediately. A worker *executes* it.
4. **Dependencies point inward.** `domain` imports nothing, `application` imports `domain` plus ports, `infrastructure` implements the ports, and `app/api` adapts HTTP to `application`.
5. **Compute when data changes, not when someone looks.** Analytics are a read model that is rebuilt on import.

### 4.2 Component view

```
 Browser ──HTTP──▶ app/api/*  (thin adapters: parse → requireSession → call use case → JSON)
                    │    ▲
                    │    └── GET /api/events (SSE: task progress)   [phase 4, optional]
                    ▼
 ┌──────────────────────────── application/ (use cases) ────────────────────────────┐
 │ drafts.generate()  tools.run()  workflows.start()  automations.save()/runDue()   │
 │ collectors.start() collectors.ingest()  analytics.snapshot()  ask.answer()       │
 │ tasks.enqueue()/cancel()/pause()/resume()        settings.*  secrets.*           │
 └───────────┬──────────────────────────────┬──────────────────────────┬────────────┘
             │ pure calls                   │ ports (interfaces)       │
 ┌───────────▼───────────┐   ┌──────────────▼───────────────┐   ┌──────▼──────────────┐
 │ domain/  (pure, sync) │   │ infrastructure/              │   │ runtime/            │
 │ scoring · patterns ·  │   │ db/ (repos, migrations, tx)  │   │ worker (task loop,  │
 │ fit · normalize ·     │   │ ai/ (cli, api, opencode,     │   │  leases, limiter)   │
 │ limits · schedule ·   │   │      router, health)         │   │ scheduler (in-proc) │
 │ prompt composition    │   │ apify/ · youtube/ · secrets/ │   │ started from        │
 └───────────────────────┘   └──────────────────────────────┘   │ instrumentation.ts  │
                                                                └─────────────────────┘
                     SQLite (WAL): typed tables + tasks + analytics_snapshot
```

### 4.3 Proposed module layout

```
src/server/
  domain/            # pure TS, no I/O, 100% unit-testable
    posts/           # Post type, classify(), engagement()
    analytics/       # analyze(), patternLibrary(), winners(), fitScorer(), bestTime(), recycled
    normalize/       # per-platform mappers → NormalizedPost
    prompts/         # playbook layering, winner cards, digest text (string builders)
    schedule/        # nextRunOf(schedule, tz)
    limits/          # platform character counting
  application/       # use cases; orchestrate domain + ports; own transactions
    drafts.ts  tools.ts  workflows.ts  automations.ts  collectors.ts  analytics.ts  ask.ts
    tasks.ts         # enqueue/cancel/pause/resume, task handlers registry
  ports/             # interfaces: PostRepo, TaskRepo, AIGateway, Collector, SecretStore, Clock
  infrastructure/
    db/              # connection, migrations/NNN_*.sql, repos, tx()
    ai/              # providers/{claude-cli,anthropic,opencode}.ts, router.ts, health.ts, limiter.ts
    collectors/      # apify.ts, youtube.ts (HTTP only; no persistence)
    secrets/         # encrypted secret store
  runtime/
    worker.ts        # claims tasks, runs handlers, heartbeats, recovers on boot
    scheduler.ts     # 30 s tick → automations.runDue() → enqueue (no HTTP)
  http/
    route.ts         # route() wrapper: requireSession, validation, error mapping, 499 on cancel
app/api/*            # 5–20 lines each, delegate to application/*
```

This can be adopted gradually inside the current `lib/`: the folder names matter less than the dependency direction. The one hard rule (enforceable with an ESLint `no-restricted-imports` zone) is: **nothing under `lib/` or `src/server/` imports from `app/`.**

### 4.4 Durable task system (ADR-001)

A single table replaces `ai_runs`, `jobs`, automation run state and `meta.apifyRuns`:

```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,               -- ulid: time-sortable
  kind        TEXT NOT NULL,                  -- 'generate' | 'tool' | 'workflow' | 'automation' | 'collect' | 'ingest' | 'categorize' | 'brief' | 'ask' …
  parent_id   TEXT REFERENCES tasks(id),      -- automation → its step tasks; collect → ingest
  status      TEXT NOT NULL,                  -- queued | running | paused | waiting | done | failed | cancelled
  input       TEXT NOT NULL,                  -- JSON, validated per kind
  output      TEXT,                           -- JSON
  error       TEXT,
  checkpoint  TEXT,                           -- JSON: completed step outputs, so a restart resumes here
  provider    TEXT, model TEXT,               -- who actually answered
  attempts    INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  run_after   INTEGER NOT NULL,               -- epoch ms; used for retries/backoff and Apify poll delays
  lease_until INTEGER,                        -- set while a worker owns it
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  title TEXT, page TEXT, platform TEXT, trigger TEXT,   -- Activity display / provenance
  created INTEGER NOT NULL, started INTEGER, finished INTEGER
);
CREATE INDEX tasks_ready  ON tasks(status, run_after);
CREATE INDEX tasks_parent ON tasks(parent_id);
CREATE INDEX tasks_created ON tasks(created);

CREATE TABLE task_events (               -- the live step log Activity renders
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, at INTEGER NOT NULL,
  type TEXT NOT NULL,                    -- step | via | progress | log
  label TEXT, state TEXT, data TEXT,
  PRIMARY KEY (task_id, seq)
);
```

**Worker loop** (in-process, started from `instrumentation-node.ts`):

```
on boot:  UPDATE tasks SET status='queued', lease_until=NULL
          WHERE status='running' AND lease_until < now          -- recover, don't "interrupt"
loop:     claim = UPDATE tasks SET status='running', lease_until=now+60s, attempts=attempts+1
                  WHERE id = (SELECT id FROM tasks WHERE status='queued' AND run_after<=now
                              AND kind IN (<kinds with free limiter slots>) ORDER BY run_after LIMIT 1)
                  RETURNING *
          handler = HANDLERS[claim.kind]; run with ctx { signal, step(), via(), checkpoint(), heartbeat }
          → done / failed (retry with backoff if attempts < max) / waiting (re-queue with run_after)
heartbeat: every 20 s extend lease_until; check cancel_requested → abort signal
```

- **Concurrency:** a limiter per provider (e.g. `claude-cli: 2`, `anthropic: 4`, `opencode: 2`) and per kind (`collect: 2`). This bounds subprocesses and quota burn (F13).
- **Cancel / pause:** set `cancel_requested` or `status='paused'`. The heartbeat aborts in-flight AI calls. Workflows check the paused state between steps. This works the same for every kind.
- **Resume:** multi-step handlers (workflows, automations) write `checkpoint` after every step. A restarted task skips the steps that already finished.
- **Collect → ingest chain (fixes F1):** the `collect` handler starts the Apify run and returns `waiting` with `run_after = now + 15 s`. Each wake-up polls once. On `SUCCEEDED` it enqueues an `ingest` task (dataset → normalize → **one transaction** → bump `data_version`). Nobody needs to have a page open.
- **Request/response UX stays the same:** `POST /api/generate` enqueues and returns `{ taskId }`. The client awaits it with `GET /api/tasks/:id?wait=25` (long-poll), or with SSE later. Leaving the page no longer matters, because the work never belonged to the request.
- **Retention:** keep the newest 1,000 finished tasks. Children are deleted with their parent.

### 4.5 Analytics read model (ADR-004)

Data only changes on **ingest**, **categorize**, **logging results** and **classifier upgrades**. Analytics should be computed at those moments, not on every read.

1. **Per-post derived columns**, filled in when a post is written: `eng`, `hook`, `hook_line`, `words`, `length_bucket`, `has_link`, `emoji_count`, `media`. These are pure functions of the post.
2. **Baselines table** `author_baselines(source, author, n, median_eng)` and `platform_baselines(source, median_eng, median_eng_per_follower)`, recomputed in the ingest transaction for the affected authors and platforms only.
3. **`outlier`** is stored per post and recomputed for authors whose baseline changed.
4. **`analytics_snapshot(version, computed_at, payload JSON)`**: pattern library, topic spikes, hook stats, hour histogram (computed in the **user's timezone**), recycled clusters, geo regions and digest text. It is rebuilt after `data_version` changes, debounced by about 2 s, in a worker task, so it never runs on a request.
5. **Reads become O(1):** `analytics.snapshot()` returns the cached row. The prompt builders (`digestText`, winner cards) read from the snapshot plus a few indexed `SELECT … ORDER BY outlier DESC LIMIT n` queries.
6. **Replace `/api/state`** with page-scoped endpoints (`/api/overview`, `/api/posts?cursor=&platform=&sort=outlier`, `/api/patterns?platform=`). The client no longer downloads the whole corpus.

The time-dependent parts (topic spikes over "last 48 h vs previous 48 h") stay correct because the snapshot also refreshes on a 15-minute timer whenever it is older than its window.

### 4.6 Typed storage, migrations, secrets (ADR-003)

| `meta` key(s) today | Target |
|---|---|
| `apifyToken`, `anthropicKey`, `claudeOAuthToken`, `youtubeApiKey` | `secrets(name PK, ciphertext, iv, tag, updated)`, AES-256-GCM, key in `DATA_DIR/.reticle.key` (0600, created on first run, outside the DB file) or `RETICLE_SECRET_KEY` env |
| `aiConfig`, `apifyConfig`, `apifyBudgetUsd`, `creatorProfile`, `playbook`, `aiDailyRunBudget`, *(new)* `timezone` | `settings(key PK, value JSON, version INT)` with a **schema per key** validated on read and write, plus typed accessors |
| `apifyRuns` | `tasks` (kind `collect`) + `collector_runs(task_id, platform, actor, apify_run_id, items, added, updated, skipped, cost_usd, note)` |
| `automations` (with embedded history) | `automations(id, name, enabled, schedule JSON, steps JSON, next_run, created, updated)`; history = `tasks WHERE kind='automation' AND input->>'automationId'=?` |
| `mindmaps`, `trackers` | their own tables |
| `aiLatency`, `aiModelStatus`, `lastAI`, `lastGoodModel` | `provider_health(provider, model, ok, msg, retry_at, last_ms, updated)`, written by the AI router once per call (one upsert instead of four blob rewrites) |
| `opencodeModelList` | `cache(key, value, expires)` |
| `schedulerKey` | deleted (no longer needed, see ADR-005) |
| `classifierVersion`, `lastCollect`, `lastAnalysis` | `settings` / `analytics_snapshot` |

**Migrations:** `infrastructure/db/migrations/NNN_name.sql` (or TS for data moves), applied in order inside one transaction, tracked with `PRAGMA user_version`. Migration 001 = today's schema as it is. 002 = the moves above. They run once in `getDb()` before the first query. Delete `ensureColumns`, the `try/catch ALTER` calls and the unused `accounts` table.

**Connection hygiene:** a single `DatabaseSync` with `PRAGMA foreign_keys=ON; synchronous=NORMAL; journal_mode=WAL; busy_timeout=5000`, a prepared-statement cache in each repo, and a `tx(fn)` helper (`BEGIN IMMEDIATE … COMMIT`). Every multi-write use case goes through it (F10).

**Backups:** a nightly `VACUUM INTO 'DATA_DIR/backups/data-YYYY-MM-DD-HHmm.sqlite'` task that keeps 7 copies. This is cheap, consistent and runs online.

### 4.7 AI gateway

Keep the provider runners and wrap them in one gateway with a clear contract:

```ts
interface AIGateway {
  complete(req: {
    system: string; prompt: string;
    pin?: { provider: ProviderId; model?: string };
    timeoutMs?: number; signal: AbortSignal;
    schema?: JSONSchema;                 // structured output where the provider supports it
  }): Promise<{ text: string; json?: unknown; provider: ProviderId; model: string; ms: number; attempts: AttemptLog[] }>;
}
```

- **Router**: the provider order comes from settings. It skips providers whose `provider_health.retry_at > now` (quota) instead of spending a timeout on them.
- **Limiter**: a semaphore per provider, shared with the worker (§4.4).
- **Health**: one upsert per attempt into `provider_health`. `aiHealth()` becomes a query.
- **Structured output** for Generate, Toolkit and Ask on the Anthropic API path (JSON schema), with the existing regex parsers (`parseVariants`) kept as the fallback for CLI and OpenCode. This removes the most fragile part of the pipeline: "AI answered but not in the expected format".
- **Prompt building is pure** (`domain/prompts`). Each use case calls `buildGeneratePrompt(snapshot, picks, request)`, which makes prompts snapshot-testable.

### 4.8 Auth and scheduler (ADR-005)

- `proxy.ts` only checks that the cookie is **present** and redirects to `/login` if not (optimistic, no DB query).
- `http/route.ts` exports `route(handler, { auth: true, schema })`. It calls `requireSession()` (a DAL function, memoized per request), validates input, maps `TaskCancelled` → 499, and turns other errors into structured JSON. Every route handler uses it.
- The scheduler is a `setInterval` in `runtime/scheduler.ts` that calls `automations.runDue(now, tz)` **directly**, which enqueues `automation` tasks. The self-HTTP call, the `schedulerKey` and the proxy bypass are all removed.
- `nextRunOf(schedule, tz)` computes with an explicit IANA timezone stored in settings. The default comes from the browser on first sign-in, with `TZ` as the fallback (F2).
- Startup stops changing config: OpenCode is *warmed* when enabled and never *re-enabled* (F14).

---

## 5. API surface (after)

| Method & path | Purpose |
|---|---|
| `POST /api/tasks` `{ kind, input }` | Enqueue any task (generate, tool, workflow, collect, categorize, brief, ask) → `{ taskId }` |
| `GET /api/tasks?kind=&status=&cursor=` | Activity list (one model, no merging) |
| `GET /api/tasks/:id?wait=25` | Task with events; long-polls until a state change or timeout |
| `POST /api/tasks/:id/{cancel\|pause\|resume\|retry}` | Uniform controls |
| `GET /api/events` | SSE stream of the task activity — replaces the 1.5–20 s polling on the shell and the Activity page — **done** |
| `GET /api/overview` · `/api/posts` · `/api/patterns` · `/api/best-time` | Page-scoped analytics read models (replace `/api/state`) — **done** |
| `GET /api/summary` · `/api/topics` · `/api/manual` | The few numbers and lists the top bar and the pickers need — **done** |
| `GET/PUT /api/settings/:key` | Typed settings with schema validation |
| `PUT /api/secrets/:name` · `DELETE …` | Write-only secrets (reads return a mask) |
| `GET/PUT/DELETE /api/automations[/:id]`, `POST /:id/run` | CRUD; `run` enqueues |
| `/api/auth/*` | Unchanged |

The existing domain-specific endpoints (`/api/generate`, `/api/tools`, …) can stay as compatibility shims that call `tasks.enqueue()` and wait (`?wait=`). That way the UI can migrate page by page.

---

## 6. Scale & reliability

### 6.1 Load estimate
- **Corpus:** 6,000 posts × ~1.5 KB (body ≤ 5 KB, typically shorter) ≈ **9 MB** read and JSON-mapped per `load()`. At about 7 loads per workflow start and 4 per digest, a single request can do **30–60 MB of allocation and parsing on the main thread**. Every concurrent request and every prefetch waits behind it.
- **After ADR-004:** the snapshot is about 50–200 KB, read once per request. The heavy recompute happens about once per import, in a task, and takes roughly the same CPU (O(n log n) medians), but **N× less often** and never on the request path.
- **AI:** ≤ 100 runs/day and ≤ ~6 concurrent. That is trivial for SQLite. The real bottleneck is provider quota, which the limiter now protects.
- **Writes:** a 1,000-item import inside one transaction takes milliseconds, compared with about 3,000 autocommits today.

**Headroom:** this design comfortably handles 10× today's data (60k posts) on SQLite. The first thing to strain would be snapshot rebuild time (seconds). The fix at that point is incremental baselines, not a different database.

### 6.2 Failure modes

| Failure | Today | After |
|---|---|---|
| Restart during a 3-step workflow | Whole job `interrupted` | Lease expires → re-queued → resumes from checkpoint at step 3 |
| Restart while Apify run in flight | Run polled only if Sources is opened | `collect` task re-claimed, polls, ingests |
| Restart during Generate | `ai_runs` row `interrupted` | Re-queued once (`max_attempts=2` for idempotent AI kinds) |
| Claude CLI quota exhausted | Each request waits for a timeout, then falls back | Router skips the provider until `retry_at` |
| 5 concurrent Generates | 5 CLI subprocesses | 2 run, 3 queue (visible as `queued` in Activity) |
| Crash mid-import | Partial import | Transaction rolls back; task retries |
| DB corruption or bad migration | No backup | Nightly `VACUUM INTO`; migrations in a transaction |
| Secret exfiltration via DB copy | Plaintext tokens | Ciphertext; the key file lives outside the DB |

### 6.3 Observability (local only, no telemetry)
- `tasks` and `task_events` *are* the audit log, and Activity already renders them.
- One structured log line per task transition (`[task] id kind status ms provider`) to stdout, visible with `docker logs`.
- A `GET /api/health` (auth-exempt, no data) for the Docker `HEALTHCHECK`. It checks the DB, worker heartbeat age and scheduler last tick. Today's health check hits `/login`, which says nothing about the worker. **Done:** `/api/health` is open and minimal (the app, the database, the uptime); the full picture is `GET /api/status`, behind the session.

---

## 7. Trade-offs considered

| Option | Why not (now) |
|---|---|
| **Postgres / Supabase** | Adds a server and breaks "one file, back up with a copy". Single-user, low-write workload. The README's reasoning still holds. |
| **Redis + BullMQ** | A second process to run and back up, only to get a queue that SQLite can provide at this scale (≤ ~100 tasks/day). |
| **Temporal / Inngest / Trigger.dev** | Excellent durable execution, but either hosted (violates local-first) or a heavy self-hosted cluster. Our checkpoint-per-step model covers the need. |
| **Separate worker container** | Better isolation, but two processes sharing one SQLite file brings WAL locking across containers, compose complexity and double the memory. Worth it only if AI subprocesses start hurting UI latency, and the module boundaries here make that split mechanical later (§9). |
| **Next.js `after()` for background work** | Fine for small fire-and-forget side effects (logging). But it is not durable (lost on restart) and has no cancel, pause or queue semantics, so it is not a replacement for tasks. |
| **ORM (Drizzle / Kysely)** | Kysely or Drizzle would add type-safe queries over `node:sqlite`, which is a reasonable follow-up. It is deferred so the restructure does not also become a query-layer rewrite. Hand-written repos with prepared statements are fine at this size. |
| **Zod for validation** | Recommended (small, well known, covers settings, task inputs and route bodies with one tool). The alternative is to keep the hand-written `sanitize*` functions but centralize them per schema. |

Main costs of the proposal: a migration (data moves out of `meta`), slightly more ceremony per feature (a port, a use case, a route), and a worker loop to own and test. All three are paid once and lower the cost of every later feature.

---

## 8. Migration plan (incremental, each phase shippable)

| Phase | Work | Fixes | Effort |
|---|---|---|---|
| **0. Quick wins** | Wrap `importNormalized` in a transaction. Background-poll active Apify runs from the scheduler tick (a stopgap for F1). Store `timezone` in settings and use it in `nextRunOf` and hour buckets. Stop re-enabling OpenCode on boot. Add `"typecheck": "tsc --noEmit"` and a `vitest` suite for `patterns`, `score`, `normalize`, `schedule`, `limits`, `importer`. | F1*, F2, F10, F14, F15 | 1–2 days |
| **1. Storage foundation** | Migration runner + `PRAGMA user_version`. Migration 001 = current schema. `tx()`, statement cache, repos. Move secrets to the encrypted `secrets` table and config to typed `settings`. Delete `accounts` and `ensureColumns`. | F8, F9 | 2–3 days |
| **2. Layering** | Extract `application/drafts.ts` and `application/tools.ts` from the route files. Automations call those use cases, not routes. Add the `route()` wrapper with `requireSession()`. Proxy becomes optimistic only. Scheduler calls `runDue()` in-process. Delete `schedulerKey`. Add the lint rule "lib must not import app". | F5, F11, F12 | 2–3 days |
| **3. Task system** | `tasks` + `task_events`, worker, limiter, leases. Port in order: `collect`/`ingest` (fully fixes F1) → workflows → automations → generate/tool/brief/categorize/ask. Activity reads `tasks` only. Drop `jobs` and `ai_runs` after a one-time copy. | F1, F3, F4, F13 | 4–6 days |
| **4. Read model & push** | Derived post columns, baselines, `analytics_snapshot` rebuilt by a task. Page-scoped endpoints replace `/api/state`. Optional SSE `/api/events` to replace polling. Nightly backup task. `/api/health`. | F6, F7 | 3–4 days |
| ↳ **4a–4d (done)** | The read model and the page-scoped endpoints — see the status note below. |
| ↳ **4e (done)** | The nightly backup, the health endpoint (`/api/health` open, `/api/status` behind the session) and the live event stream — see the status note below. |

Phases 0–2 are independent of each other's internals and can land in any order. Phase 3 depends on 1 (it needs migrations and `tx()`). Phase 4's snapshot rebuild runs best as a task (phase 3), but it can start as a synchronous rebuild at the end of each ingest.

**Status (2026-11-20):** Phases 0, 1, 2, 3 and 4 are implemented. Phase 0: `importNormalized` runs in one `BEGIN IMMEDIATE` transaction, the scheduler tick polls active Apify runs, the stored time zone drives `nextRunOf` and every hour bucket, and startup no longer re-enables OpenCode. Phase 1: a `PRAGMA user_version` migration runner (migrations 001–010), a shared prepared-statement cache, AES-256-GCM secrets, typed settings, and real tables for automations, collector runs, caches, provider health, app state, mind maps and trackers. Legacy `meta` values migrate lazily on first read and the meta copy is cleared; `accounts` and `ensureColumns` are gone. Phase 2: the use cases live in `lib/application/` (`drafts.ts`, `tools.ts`), the pure modules in `lib/domain/`, every protected route goes through the `lib/http/route.ts` wrapper (session check + JSON error boundary), `proxy.ts` is optimistic for `/api/*`, and the scheduler runs in-process (`lib/startup.ts` calls `runDue()` directly — no tick route, no scheduler key). The layering rules are enforced by a vitest guard test (`lib/__tests__/architecture.test.ts`) rather than ESLint. Phase 3: the durable task system is live — one `tasks` table plus `task_events`, an in-process worker (`lib/runtime/worker.ts`) with atomic claims, 60 s leases, 5 s heartbeats, boot recovery, exponential backoff and per-resource limiter pools (`ai` 2, `workflow` 2, `automation` 2, `apify` 2, `apify-import` 1; 6 tasks at once). Every long-running thing is a task now: collectors, workflows, automations, Generate, Toolkit, Formats, the brief, the categorizer, Ask, mind maps and the draft polisher. The existing endpoints stay as enqueue-and-wait shims (`lib/http/task-shim.ts`), so no response body changed. Migration 009 copies `ai_runs` and `jobs` into `tasks` and drops both tables — `lib/activity.ts` and `tracked()` are gone, and Activity, `/api/usage` and the model-status backfill all read the one table. ADR-001 and ADR-005 are Accepted; sign-in is rate limited (5 failures / 15 min per IP). `npm run typecheck`, `npm test` (108 tests / 17 files) and `npm run build` pass.
Phase 4a–4d (the analytics read model and the page-scoped reads) are implemented: migration 010 adds the derived post columns (`eng`, `hook`, `words`, `lengthBucket`, `outlier`, `baseline` …), the `author_baselines` / `platform_baselines` yardsticks and a single `analytics_snapshot` row; a `dataVersion` counter in `app_state` keys the snapshot, every write bumps it and a rebuild makes it current. The rebuild runs in a task (kind `analytics`, debounced 2 s) and the scheduler refreshes it every 15 minutes; the ingest path writes each post's derived facts immediately, so the columns are never empty. The analyzer and the read model share one implementation of the yardsticks (`computeBaselines` / `outlierOf` in `lib/domain/patterns.ts`), so the materialized numbers and the live ones cannot drift. F6 and F7 are closed: the pages now read `/api/overview` (the server buckets the days), `/api/posts` (server-side filters, sorts and keyset pagination), `/api/best-time`, `/api/topics`, `/api/summary`, `/api/manual` and `/api/patterns`, and `/api/state` is gone (404) — the whole corpus no longer leaves the server unless a page asks for a post by name. ADR-004 is Accepted. **Phase 4e is done as well:** the nightly backup is a task (`kind: 'backup'`) that runs `VACUUM INTO` — a consistent, compacted copy while the app keeps running — into `DATA_DIR/backups`, keeps the newest seven and reschedules itself for the next 03:00, so there is exactly one recurring backup row whether the app was running or not (the Settings page can also take one by hand). `GET /api/health` answers with the liveness facts (the app answers, the database answers, the uptime) and is open, so the Docker `HEALTHCHECK` can use it; `GET /api/status` is the full picture behind the session — the database (size, migration, counts), the task worker, the analytics read model, the AI providers and the backups, plus a `problems` list — always 200, because a stale snapshot is not an outage. `GET /api/events` is the live stream: one SSE connection per tab carries the activity summary the shell used to poll for, so a finished task is announced in about a second instead of up to four; a slow poll stays as the safety net for a browser that cannot keep the stream open, and the Activity page reloads itself from the stream instead of polling every two seconds.

`npm run typecheck`, `npm test` (116 tests / 18 files) and `npm run build` pass.

---

## 9. What to revisit as it grows

- **More than ~50k posts, or snapshot rebuilds over 2 s:** make baselines incremental (keep per-author sorted engagement arrays or approximate medians with t-digest) and stop rebuilding globally.
- **AI subprocesses hurting UI latency:** run `runtime/worker.ts` in a `worker_thread` or a second process. The `tasks` table is already the contract, so only the entry point changes.
- **Multi-device or remote access** (a non-goal today): move from SQLite to libSQL/Turso or Postgres behind the existing repo ports, and from a single owner to a real user model. `requireSession()` is already the single choke point.
- **More collectors:** make `Collector` a registry (`start`, `poll`, `fetchItems`, `map`) so a new platform means one file plus one mapper.
- **Prompt regressions:** with prompts built by pure functions, add golden-file tests and, if worthwhile, a small offline eval set of past winner cards → expected structure.
