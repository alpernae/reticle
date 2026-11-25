# ADR-006: Viral discovery and structure-inspired generation

**Status:** Accepted
**Date:** 2026-11-24
**Accepted:** 2026-11-25
**Deciders:** Maintainer (alpernae)

## Context

Reticle could already tell you which posts *beat their creator's normal*
(`outlier`), which traits lift a platform, and which posts are worth reading.
But it could not answer the question a creator actually asks: **"what is
going viral right now on the platforms I collect from, and can I make one
like that?"**

Three things were missing:

1. **A cross-platform viral ranking.** `outlier` answers "how far above this
   author's normal?" but says nothing about *now*. A 4× from nine months ago
   and a 4× from last week are the same number and very different lessons.
   Absolute engagement cannot be the yardstick either — a 40-like Threads post
   and a 4k-like X post are not comparable, and big accounts would own every
   ranking.
2. **An explanation.** A score alone is not actionable. "3.4×" is a number; "3.4×
   your own usual, posted 09:00 Tuesday — your best slot, 30 shares, 12
   comments" is a lesson.
3. **A path from "that worked" to "here is mine".** The Generate page could
   borrow a winner's structure from `/patterns` via `postRef`, but that path
   ships the source post's **wording** into the prompt, and the corpus is
   other people's content.

## Decision

### 1. Virality is relative, and recency damps it

The ranking reuses the yardstick the app already computes and materializes
([ADR-004](0004-analytics-read-model.md)): `outlier` — weighted engagement
over the author's median, the audience's per-follower rate, or the platform
median, in that order.

On top of it sits a recency weight that halves every 45 days and never falls
below 0.55, so an old hit still teaches but teaches less:

```
viralScore = outlier × (0.55 + 0.45 × 0.5 ^ (ageDays / 45))
```

The floor is deliberate: a decay to zero would quietly delete the corpus's
best lessons, and a decay with no floor would make the ranking volatile —
the same post would move every hour.

Bands come from the **raw lift**, not the damped score, because "viral" is a
statement about the post, not about its age:

| Lift | Verdict |
|---|---|
| ≥ 3× | viral |
| ≥ 2× | breakout |
| ≥ 1× | normal |
| < 1× | under |

### 2. Every card explains itself

`viralReasons()` always states the lift and the yardstick ("3.4× your own
usual engagement"), the hook shape, and the age. It adds the corpus-specific
lifts when they are known — the length lift from the snapshot's pattern
library (`patternRows`), the slot lift from the best-time grid, and the
engagement mix (shares, comments, saves). These come from the same read model
the rest of the app uses, so the page and the prompt never disagree.

### 3. "Make one like this" carries the STRUCTURE, never the wording

A post is reduced to a **structure signature**: opening shape, hook label,
length bucket and word count, line and sentence count, format (text / image /
video / thread / link), hashtag and emoji count, the call to action, and the
posting slot. `describeStructure()` renders it as a short recipe.

The recipe is what crosses into the prompt. The original text is **excluded
twice over**:

- `viralBrief()` builds the prompt-ready brief from the signature and the
  reasons only — the body never enters it.
- The inspired post is **removed from the winner cards** in
  `generateDrafts()`, so its wording cannot reach the model by the back door
  either.

The endpoint that serves the brief strips the body as well, so the promise
holds at the transport boundary and not only in the prompt.

### 4. One ranking, two surfaces

The ranking lives in the domain layer (`lib/domain/viral.ts`) and is applied
in the application layer (`lib/application/viral.ts`). Two surfaces read it:

- **`/viral`** — a dedicated finder: platform chips, an age window, a minimum
  lift, cards with the score, the reasons and the recipe, and one action per
  card ("Make one like this" → `/generate?inspire=<id>`).
- **`/feed?sort=viral`** — the same score as a sort option, so the ranking is
  reachable from the page people already use.

The feed computes the score in SQL from the same constants the domain uses
(`RECENCY_FLOOR`, `HALF_LIFE_DAYS`), and the cursor carries the reference
time it was built with, so the pages of one listing stay in one order.

## Options Considered

### Option A: Rank by absolute engagement
**Pros:** obvious to everyone; no baselines needed.
**Cons:** not comparable across platforms; big accounts own the top of every
list; tells you nothing about *why* a post worked. **Rejected** — this is the
thing the outlier score was built to avoid.

### Option B: Blend relative lift and absolute engagement, with a toggle
**Pros:** lets the user see reach as well as efficiency.
**Cons:** two numbers, one ranking, and a toggle that doubles the testing and
the UI. **Rejected for now** — the corpus is still small enough that the
relative yardstick is the one that generalizes. Revisit if the corpus grows
past the platforms it covers.

### Option C: Store a materialized `viral_score` column
**Pros:** one indexed read; the feed sort is trivial.
**Cons:** the score depends on the clock, so the column goes stale every
minute and needs a rebuild loop to stay honest — a background job to maintain
a number the database can compute on the fly. **Rejected** — the SQL
expression is exact and needs no maintenance.

### Option D: Copy the source post's topic and rewrite it
**Pros:** closer to the original, faster to write.
**Cons:** it is plagiarism with extra steps, and it teaches the model to
paraphrase rather than to transfer a structure. **Rejected** — the creator
chose structural inspiration explicitly.

### Option E: A second, viral-specific generator
**Pros:** a prompt could be tuned for viral posts alone.
**Cons:** a second prompt stack, a second task kind, a second fit/score path,
a second result shape — all of it duplicated for one extra input.
**Rejected** — Generate takes one more input (`inspire`) and keeps its
grounding, its limit fitting, its scoring and its Winners auto-save.

## Trade-off Analysis

The formula is deliberately *relative*. A creator with a small audience is
not punished for having small numbers, and a large account cannot buy the
top of the list with reach alone. The cost is that the score means "better
than usual", not "better than everyone" — which is exactly the question the
creator is asking.

The recency floor trades a little precision for stability: without it, the
ranking would reshuffle on every refresh and the user could never point at
"that post". With it, a 9-month-old hit keeps 55–60% of its pull and still
sits below a fresh one of the same size.

## Consequences

- **Easier:** one place to answer "what is working"; the explanation is on
  every card, not in a separate report; the finding-to-writing path is one
  click and lands on the existing Generate page with the recipe visible.
- **Harder:** the ranking formula now exists in two places (the domain
  function and the feed's SQL), and the constants are shared to keep them
  honest. The feed's cursor had to grow a reference time.
- **Revisit:** if the corpus passes ~50k posts, the `viralCandidateRows()`
  limit of 1,000 rows and the in-memory re-sort in `listViral()` become the
  bottleneck; the ranking would need to be materialized (Option C) or moved
  into a generated column.

## Action Items

1. [x] Domain layer: `recencyWeight`, `viralScore`, `verdictOf`,
   `structureSignature`, `describeStructure`, `viralReasons`.
2. [x] Store reads: `viralCandidateRows()` (SQL-filtered) and
   `viralSourcePost()`.
3. [x] Application read model: `listViral()` and `viralBrief()`.
4. [x] Endpoints: `GET /api/viral` and `GET /api/viral/brief`.
5. [x] `/viral` page + nav entry.
6. [x] Feed sort `viral`.
7. [x] Generate: `inspire` input → structure brief in the prompt, inspiration
   card on the page.

## Implementation Notes (2026-11-25)

What landed, and where:

| Piece | Where |
|---|---|
| Ranking + structure (pure, no I/O) | `lib/domain/viral.ts` |
| Read model: `listViral`, `viralBrief` | `lib/application/viral.ts` |
| Store reads | `lib/db.ts` (`viralCandidateRows`, `viralSourcePost`) |
| Finder endpoint | `app/api/viral/route.ts` |
| Inspiration endpoint (body stripped) | `app/api/viral/brief/route.ts` |
| The page | `app/viral/page.tsx` (+ one `NAV` row in `components/panel.tsx`) |
| Feed sort | `lib/application/posts.ts` (`FeedSort` + `viralSql()`), `app/feed/page.tsx` |
| Prompt wiring | `lib/application/drafts.ts` (`inspire` input, brief block, winner-card exclusion) |
| Page wiring | `app/generate/page.tsx` (`inspire` param, inspiration card, request body) |

Notes on the two deviations from the decision text:

- **The feed's SQL mirrors the domain formula instead of calling it.** The
  domain function is the definition; the feed needs the same expression in
  `SELECT`, `ORDER BY` and the cursor predicate, and SQLite cannot call
  TypeScript. The two shared constants (`RECENCY_FLOOR`, `HALF_LIFE_DAYS`) are
  imported from the domain module and interpolated into the SQL, so they
  cannot drift apart. `lib/__tests__/viral-app.test.ts` pins the behaviour
  (recency flips the order, the score never exceeds the raw lift, the cursor
  neither drops nor repeats a row).
- **The inspired post is dropped from the winner cards.** The ADR said the
  wording must not reach the model; excluding the post from `picked` is what
  actually guarantees it, since the winner cards carry bodies.

### Verification

- `lib/__tests__/viral.test.ts` — the formula, the bands, the structure
  signature, the CTA and format detection, the reasons.
- `lib/__tests__/viral-app.test.ts` — the ranking, the filters, the cursor,
  the brief, and the feed's viral sort.
- `lib/__tests__/viral-generate.test.ts` — the prompt carries the recipe and
  **not** the source wording (a sentinel word in the source body must not
  appear in the captured prompt), and the inspiration travels back in the
  result so the page can show it.
- Live check against the real corpus (1,400+ posts): `/api/viral` ranks the
  threads post at 325× over the audience baseline first, explains it, and
  `/api/viral/brief` returns the recipe without the wording;
  `/api/posts?sort=viral` returns the same order.

### Still open

- **A "same angle, new words" mode** — deliberately not built: the creator
  chose structural inspiration, and a topic-remix mode would put the source's
  subject matter back in front of the model.
- **Ranking past ~50k posts** (see the consequences section).
