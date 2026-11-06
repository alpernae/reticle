---
description: Generate a PanelUI web component (skill rules, strict typing, a11y, token matching, tsc-verified)
---
Use the `panelui-web` skill to build the component or screen described below:

$ARGUMENTS

Follow this exact workflow:

1. **Load the skill.** Call the `skill` tool with id `panelui-web`.
2. **Match, don't guess.** Read `components.md` (from the skill folder) and pick the ONE component
   doc under `components/` that matches the request; read only that file. If the request spans two
   named parts, read both docs, then build one at a time. Never read all component docs.
3. **Apply workspace rules.** Read `references/opencode-agent-rules.md` inside the skill folder and
   follow every section: TypeScript strict, colour roles only, a11y checklist, Server Component
   rules, `await io()` + `<Suspense>` for any `data.json` read.
4. **Install if missing.** If the component is not yet in `components/panelui/`, add it with
   `npx shadcn@latest add @panelui/<name>` (the @panelui registry is configured in
   `components.json`). Never hand-vendor the source.
5. **Write the code.** Local compositions go to `components/panelui/<name>.tsx`; user-facing
   implementations go to the page/route the user named (default `app/<route>/page.tsx`).
6. **Verify.** Run `npx tsc --noEmit` and fix every error your file introduced until clean. If the
   implementation touches a route, also fetch it and confirm HTTP 200 with no runtime error.
7. **Report.** Summarize: parts used, colour roles chosen and why, SR announcement behaviour, and
   where the code lives. List any pre-existing tsc errors separately instead of fixing them.
