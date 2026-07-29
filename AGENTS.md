# GGStudio Agent Rules

This worktree holds several games (`zombie-motorworks`, `zombie-car`,
`comfy-zoo`, …) plus shared asset tools (`glb-pipeline`, `glb-rigger`). Each has
its own `AGENTS.md`; read the one for the directory you are working in.
Repo-wide guides live in `docs/`. The rules below apply everywhere.

## Verification

- Run unit tests, lint, typecheck, and build.
- **Never run end-to-end / browser tests (Playwright: `npm test`,
  `npx playwright test`), and never write throwaway spec files to drive a
  browser.** They are slow and flaky here, and the owner verifies visual and
  gameplay behaviour by playing the game.
- Finish a change with a short "verify this" list instead: which mode or screen
  to open, which key to press, and what should look or behave differently.
