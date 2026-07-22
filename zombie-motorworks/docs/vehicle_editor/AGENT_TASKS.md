# Agent Task Decomposition

> Historical implementation plan for the original editor foundation. Do not use
> this file to assign current work. Start with [`AGENTS.md`](../../AGENTS.md) and
> use the task router in [`CONTEXT.md`](../../CONTEXT.md).

Orchestrator (Claude) owns: architecture, foundation (`types.ts`, `grid.ts`), all `runtime/` and `editor/` code (browser verification required — Codex sandbox cannot run Chromium), integration, and the verification gate after every merge.

Codex 5.5 Medium agents own scoped **pure-logic** modules in `src/core/` + their Vitest tests. Two accounts run disjoint tasks in parallel (lab, personal). Sonnet 5 reviews architecture (before coding) and UX (after the loop closes).

| Agent | Owns (exclusive) | Depends on |
|---|---|---|
| A (lab) | `src/core/parts.ts`, `src/core/blueprint.ts`, `src/core/serialize.ts`, `unit/parts.test.ts`, `unit/serialize.test.ts` | types, grid |
| B (personal) | `src/core/structural.ts`, `src/core/placement.ts`, `unit/structural.test.ts`, `unit/placement.test.ts` | types, grid (fixture defs local to tests, not catalog) |
| C (lab) | `src/core/analysis.ts`, `unit/analysis.test.ts` | A+B merged |
| D (personal) | `src/core/commands.ts`, `unit/commands.test.ts` | A+B merged |

Rules given to every agent: exact file ownership; use `src/core/types.ts` + `src/core/grid.ts` interfaces verbatim (read-only — **never edit them**); no unrelated refactoring; no new dependencies; strict TS must pass; report Done / Files changed / Tests run / Assumptions / Risks / Next recommended task.

Integration gate after each merge: `typecheck + lint + test:unit + build`, then browser gate once UI exists.
