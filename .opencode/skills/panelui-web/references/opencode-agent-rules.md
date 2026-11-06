# OpenCode agent rules — PanelUI web components

Workspace policy for generating PanelUI web components in this project. The library rules in
`SKILL.md`, `components.md`, `theming.md` and `components/*.md` are the source of truth for how
the components work; this file only adds how **you** (the agent) must work when writing them here.

## 1. Context window management (read this first)

- Load the skill with the `skill` tool (`panelui-web`). It is index-level by design.
- Read `components.md` to match the request to a component name. Then open **only** the matched
  `components/<name>.md`. Never read or list the whole `components/` folder — 44 files do not fit
  in a context window and should not.
- If the request genuinely spans 2+ components (e.g. a KPI row inside a Frame), read each matched
  doc **once**, and build sequentially: finish one component's code before opening the next doc.
- Never re-print component source you just wrote back into the conversation; summarize parts used.
- Paths inside the skill are relative to the skill directory (`.opencode/skills/panelui-web/`).

## 2. TypeScript (strict)

- The project runs `tsc --strict`. No `any`, no `as any`, no `@ts-ignore`, no non-null `!`
  assertions on props you could narrow instead.
- Named type imports: `import type { Post } from '@/lib/engine'`.
- Derive prop types from real data (`type RowIdx = number`), don't fake generics.
- Components keep their exported part API exactly as documented in the component's md file. When
  composing or wrapping, pass through props instead of narrowing them away.
- New files must compile clean under `npx tsc --noEmit`. Fix what *your* file broke; list errors
  that predate your change instead of refactoring unrelated code.

## 3. Colour: roles and tokens only

- Colour is a **role** passed to a `color` prop: `primary | info | success | warning |
  destructive`. Choose by meaning (theming.md): progress/healthy → `success`; attention-wanted →
  `warning`; failure/limit-passed → `destructive`; neutral emphasis → `info`; default → omit.
- Never write palette utilities (`text-indigo-500`, `bg-emerald-100/10`, arbitrary hex) inside a
  PanelUI component. Surfaces stay on tokens: `bg-card`, `bg-muted`, `text-muted-foreground`,
  `border-border`, `ring-ring`.
- A state change changes the role, not a class: `<Kpi.Progress color={over ? "destructive" : "success"} …/>`.
- Light/dark both derive from `app/globals.css` tokens. Never branch on `.dark` in JSX.
- If a needed token is missing from `app/globals.css`, add the *token* (both `:root` and `.dark`),
  not a one-off literal.

## 4. Accessibility checklist (every component, every time)

- Screen-reader names: pass `label`/`valueText` (or the part's documented SR props — check the md)
  anywhere meaning is carried by shape or colour. A sparkline gets an `aria-label` describing what
  the shape shows ("posts by hour, last 24h"), not "chart".
- Headings: only one `h1` per page (page title outside the component); widget titles `h2`/`h3`;
  row titles use the part's `as="p"` convention from the docs.
- Interactive rows: `Frame.Row` with `href` announces as link, with `onClick` as button — don't
  build your own div-with-onClick next to it.
- Icons that carry meaning get text alternatives; decorative icons get `aria-hidden`.
- No `title`-only discovery: if it matters visibly or to SRs, it's in text or a labelled control.
- Contrast comes from tokens; if you must invent a colour pairing, check ≥ 4.5:1 or don't ship it.
- Composition keys: every mapped child needs a stable `key` that survives reordering.

## 5. Server/Client correctness

- PanelUI web components are Server Components with no 'use client'. Keep them that way: no state,
  no effects, no event handlers outside the documented `href`/`onClick` row props.
- Compound parts may only be imported as **name imports**
  (`import { Kpi } from '@/components/panelui/kpi'`), never default imports.
- If a parent must be a client component (state, polling), render PanelUI parts as bound children
  passed from the server side or accept the bundle cost knowingly and say so in the summary.

## 6. Zero runtime errors & this project's data rules

- **Next 16 with `cacheComponents: true`**: any page reading `lib/engine` (which reads
  `data.json` on disk) must call `await io()` from `next/cache` *inside* a `<Suspense>`-wrapped
  async Server Component, so the read stays out of the static shell. Never add
  `export const runtime` / segment configs — they are rejected in this app.
- Do not import engine functions into client components. Pass shaped data down instead.
- Guard empty state: `data.json` can be empty on first run. Render a quiet empty row rather than a
  crash (`Math.max()` over an empty array is `-Infinity` — mute it with a fallback like `|| 1`).
- Validation sequence before you claim done:
  1. `npx tsc --noEmit` → zero new errors.
  2. `GET` the page (or `curl http://localhost:3000/<route>`) → HTTP 200, no error overlay text in
     the dev-server output.
  3. Toggle light/dark mentally: tokens must resolve in both (no class-based colour branching).

## 7. Local file layout

- Installed PanelUI parts live in `components/panelui/<name>.tsx` — import from there. Never
  vendor-in from npm paths in new code.
- Usage/demo implementations live under `app/<route>/page.tsx` unless the user names a location.
- Do not edit the shipped `components/panelui/*` sources when restyling: restyle via `className`
  on the instance. If a genuine bug requires editing the library file, say so explicitly.
