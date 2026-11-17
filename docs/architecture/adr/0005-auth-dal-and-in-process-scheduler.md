# ADR-005: Session checks in a data-access layer, an optimistic proxy, and an in-process scheduler

**Status:** Proposed
**Date:** 2026-11-17
**Deciders:** Maintainer (alpernae)

## Context

- **Auth exists only in `proxy.ts`.** No route handler verifies the session. Proxy queries SQLite (`sessionUser()`) on every matched request, including prefetches. The Next.js 16 docs in this repo say Proxy should do *optimistic* checks only, should "avoid database checks to prevent performance issues", and "should not be your only line of defense"; they recommend a Data Access Layer with `verifySession()` (`node_modules/next/dist/docs/01-app/02-guides/authentication.md:1033,1121,1131`). The Docker image binds `0.0.0.0`, so a proxy matcher mistake would expose the API on the network.
- **The scheduler calls itself over HTTP:** `lib/startup.ts:50` runs `fetch('http://127.0.0.1:${PORT}/api/automations/tick')` with a key stored in `meta.schedulerKey`, and `proxy.ts:17-23` has a special-case bypass for it. This depends on PORT and the loopback matching how the server is bound, and it adds an auth bypass path that exists only to work around the transport.
- **Schedules run in server-local time** (`lib/schedule.ts:16`, `setHours`). The container is UTC, so "Daily 09:00" fires at the wrong hour for most users.

## Decision

1. **Proxy = optimistic.** It only checks for the presence of the `sf_ses` cookie: redirect pages to `/login`, return 401 for `/api/*`. No DB access and no special cases.
2. **DAL check in every handler.** `http/route.ts` exports `route(handler, { auth = true, schema })`, which:
   - calls `requireSession()` (looks up the session in SQLite, memoized per request),
   - validates the body or query against `schema`,
   - maps `TaskCancelled` → 499 and validation errors → 400, and logs anything else as 500 with a stable `{ error }` shape.
   All `app/api/*` handlers are wrapped. `auth: false` only for `/api/auth/*` and `/api/health`.
3. **In-process scheduler.** `runtime/scheduler.ts` starts one `setInterval(30 s)` (guarded against dev hot-reload duplicates) that calls `automations.runDue(now, tz)` directly. `runDue` enqueues `automation` tasks ([ADR-001](0001-durable-task-system.md)). The tick endpoint, `schedulerKey` and the proxy bypass are deleted. A manual "run now" is a normal authenticated `POST /api/automations/:id/run`.
4. **Explicit timezone.** `settings.timezone` (IANA name) is captured from the browser on first sign-in and editable in Settings, with `process.env.TZ` and then `UTC` as fallbacks. `nextRunOf(schedule, from, tz)` and every hour or weekday bucket compute wall-clock time with `Intl.DateTimeFormat({ timeZone })`, handling DST through the formatter rather than with `setHours`.
5. **Rate-limit sign-in.** A small in-memory counter (for example 5 failures per 15 min per IP) on `POST /api/auth`, because the app may be reachable on a LAN.

## Options Considered

### Option A: Optimistic proxy + DAL wrapper + in-process scheduler (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low: one wrapper, one interval |
| Cost | None |
| Scalability | N/A (single user) |
| Team familiarity | High; matches the official Next 16 guidance |

**Pros:** defense in depth; no DB hit on prefetches; removes an auth bypass; the scheduler works regardless of port or bind address.
**Cons:** every handler must use the wrapper (enforce with a lint rule or a one-line test that imports all routes).

### Option B: Keep auth in proxy only, harden the matcher
**Pros:** no changes to handlers.
**Cons:** goes against the framework guidance; one matcher regression exposes every endpoint; DB check on every prefetch remains.

### Option C: Signed stateless session (JWT or iron-session) checked in proxy without DB
**Pros:** proxy stays authoritative without DB cost.
**Cons:** loses instant server-side revocation (currently a feature: "once you sign out, that session is dead everywhere") unless a denylist is added, which brings back the DB lookup. Not worth it for one user.

### Option D: OS-level scheduler (cron calling the HTTP endpoint)
**Pros:** survives app crashes.
**Cons:** an extra setup step on every OS and in Docker; still needs an auth bypass. Rejected for a local-first single binary.

## Trade-off Analysis

Single-user apps often skip defense in depth, but here the cost is one wrapper function, while the failure mode (an unauthenticated API with saved API tokens and spend-capable Apify access) is severe. Moving the scheduler in-process is strictly simpler than the current design and removes the only reason for the proxy bypass.

## Consequences

- **Easier:** reasoning about auth (one place per handler, enforced); consistent error shapes; scheduler correctness in any deployment; schedules that match the user's clock.
- **Harder:** adding a route without the wrapper must be caught by tooling.
- **Revisit:** if multi-user ever becomes a goal, `requireSession()` is the single choke point to extend with roles.

## Action Items
1. [ ] `http/route.ts` wrapper + `requireSession()` (React `cache()`-style per-request memo).
2. [ ] Wrap all 28 handlers; add a test asserting every exported handler is wrapped.
3. [ ] Make `proxy.ts` check cookie presence only; remove the tick bypass.
4. [ ] `runtime/scheduler.ts` calling `runDue()` directly; delete `/api/automations/tick` and `schedulerKey`.
5. [ ] `settings.timezone`; make `nextRunOf` and hour bucketing timezone-aware; tests across DST boundaries.
6. [ ] Sign-in rate limit.
