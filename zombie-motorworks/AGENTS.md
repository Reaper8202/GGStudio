# Agent Entry Point

This directory is the Zombie Motorworks application root. The Git worktree is
one directory above and also contains sibling games. Keep changes scoped to
`zombie-motorworks/` unless the user explicitly requests otherwise.

## Read Order

1. Read [`CONTEXT.md`](CONTEXT.md). It is the short domain map and task router.
2. Follow only the links in its task-routing row for the requested change.
3. Use [`docs/generated/module-map.md`](docs/generated/module-map.md) when you
   need exports, imports, file size, or directly importing tests. Search it; do
   not read it end to end by default.
4. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for runtime design and
   [`docs/INTEGRATION_SPEC.md`](docs/INTEGRATION_SPEC.md) for cross-Module
   contracts only when the task crosses a Seam.

`docs/agent-prompts/` and `docs/agent-reports/` are historical snapshots. They
may explain intent, but they are not current sources of truth.

## Working Rules

- Inspect `git status` before editing. Preserve changes you did not make.
- Prefer `rg` and targeted ranges over reading an entire large file.
- Treat `src/app/App.ts`, `src/editor/EditorMode.ts`, and
  `src/survival/SurvivalMode.ts` as integration owners. Search for the method
  named in `CONTEXT.md` before opening a range.
- Keep `src/core/` engine-independent. It must not import Three.js, Rapier, DOM,
  or browser storage.
- Put persistent codecs in `src/core/` and browser storage Adapters in
  `src/app/` or the owning browser Module.
- Reuse pure gameplay helpers from UI and runtime code. Do not duplicate
  economy, upgrade, wave, placement, or analysis formulas in a DOM layer.
- When parallel agent work is explicitly requested, give each agent exclusive
  file ownership. Keep one integration owner for `App.ts`, `EditorMode.ts`, and
  `SurvivalMode.ts`.

## Verification

Run from this directory:

```sh
npm run test:unit
npm run lint
npm run build
```

**Do not run the Playwright suite (`npm test`, `npx playwright test`), and do
not write throwaway spec files to drive the browser.** E2E here is slow and
flaky — waves have to path across the map before anything is observable — and
the owner verifies visual and gameplay behaviour by playing the game. Finish
instead with a short "verify this" list: which mode to enter, which key to
press, and what should look or behave differently.

`npm test` and the browser test Seam (`window.__scrapRig` under `?debug=1`,
Adapter in `tests/seam.ts`) remain for the owner and CI to run.

## Documentation Maintenance

- Update `CONTEXT.md` only when domain vocabulary, Module responsibility,
  lifecycle, persistence, an invariant, or task ownership changes.
- Update `docs/INTEGRATION_SPEC.md` when a cross-Module Interface or callback
  contract changes.
- Update `docs/ARCHITECTURE.md` when dependency direction, ownership, runtime
  composition, or a major Implementation choice changes.
- Do not update those files for local bug fixes, CSS-only work, or numerical
  tuning that already has a single code source of truth.
- After adding/removing/renaming TypeScript files, imports, exports, or tests,
  run `npm run context:generate` and commit the generated map.
- Run `npm run context:check` before finishing documentation or structural work.

