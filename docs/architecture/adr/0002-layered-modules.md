# ADR-002: Layered modules: domain → application → infrastructure, with thin routes

**Status:** Proposed
**Date:** 2026-11-17
**Deciders:** Maintainer (alpernae)

## Context

`lib/` is a flat set of about 37 modules that mix pure logic, persistence, HTTP calls and orchestration. Some important use cases live **inside route handlers**: `app/api/generate/route.ts` does winner selection, prompt building, AI calls, output parsing, limit fitting and scoring in about 170 lines. Because of that, `lib/automations.ts` reuses Generate and Toolkit by importing `@/app/api/generate/route` and `@/app/api/tools/route` and sending them fake `Request` objects (`lib/automations.ts:159,170`). Dependencies point outward (domain → HTTP adapter), the logic cannot be tested without HTTP, and every new caller (automations, Ask, the command menu) copies or re-routes logic.

Meanwhile the purest modules (`patterns.ts`, `score.ts`, `normalize.ts`, `limits.ts`, `schedule.ts`) have no tests, even though they are the product's core IP.

## Decision

Organize server code into four layers with one-way dependencies:

```
app/api/*  ──▶  application/  ──▶  domain/
                     │
                     └──▶ ports/ ◀── infrastructure/   (DB, AI providers, Apify, YouTube, secrets)
```

- **domain/**: pure, synchronous TypeScript (scoring, patterns, fit, normalize mappers, prompt composition, schedules, limits). No `getStore()`, no `fetch`, no `Date.now()` (a clock is passed in).
- **application/**: one module per use case (`drafts.generate`, `tools.run`, `workflows.start`, `automations.runDue`, `collectors.ingest`, `analytics.snapshot`, `ask.answer`). It owns transactions and task enqueueing and depends on *ports*, not on concrete adapters.
- **infrastructure/**: implementations of the ports (`SqlitePostRepo`, `ClaudeCliProvider`, `ApifyCollector`, …).
- **app/api/**: adapters only: parse and validate, call `requireSession()`, call one use case, serialize. Target ≤ 30 lines per handler.

Enforce it with ESLint `no-restricted-imports` zones: `lib/**` / `src/server/**` must not import `app/**`, and `domain/**` must not import `infrastructure/**` or `node:*`.

## Options Considered

### Option A: Layered modular monolith (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low–Medium: mostly moving code and adding interfaces |
| Cost | A few days of refactoring; no runtime cost |
| Scalability | Makes a later worker or process split mechanical |
| Team familiarity | High: plain TS modules |

**Pros:** use cases are reusable by routes, automations, tasks and Ask without HTTP; the domain becomes unit-testable; an obvious home for new code.
**Cons:** more files; a little ceremony per feature.

### Option B: Next.js Server Functions (`'use server'`) as the application layer
**Pros:** idiomatic Next, less fetch boilerplate on the client.
**Cons:** ties use cases to the React and Next runtime; the worker and scheduler cannot call them cleanly; it is still a transport, not a layer. They can be used *on top of* Option A later.

### Option C: Feature folders (vertical slices: `features/generate/{route,service,repo}.ts`)
**Pros:** high cohesion per feature.
**Cons:** the shared domain (patterns, scoring, normalize) is used by almost every feature, so slices would import each other heavily. A hybrid is fine: `application/` files *are* the slices, and `domain/` is shared.

## Trade-off Analysis

The codebase is small enough that a big-bang rewrite is unnecessary and large enough that the current coupling already costs real hacks (fake `Request`s). Layering by dependency direction fixes the coupling with the least churn and directly enables ADR-001 (task handlers call use cases) and testing.

## Consequences

- **Easier:** reuse (automations, Ask, command menu, and future CLI or MCP entry points), unit tests for the domain, swapping an AI provider or collector, a future worker split.
- **Harder:** new contributors need to learn the layer rules (keep a short `docs/architecture/README` and the lint rule).
- **Revisit:** if `application/` grows past about 20 modules, group them by bounded context (`recon/`, `writing/`, `automation/`).

## Action Items
1. [ ] Extract `application/drafts.ts` (from `app/api/generate/route.ts`) and `application/tools.ts` (from `app/api/tools/route.ts`); routes delegate to them.
2. [ ] Change `lib/automations.ts` to call those use cases; delete the route imports and the fake `Request` helper.
3. [ ] Move pure modules to `domain/` and inject `now`/`tz` instead of reading the server clock.
4. [ ] Add ESLint import-zone rules; add the `typecheck` and `test` scripts.
5. [ ] Add vitest suites for `patterns`, `score`, `normalize` (fixture datasets per actor), `importer`, `schedule`, `limits`.
