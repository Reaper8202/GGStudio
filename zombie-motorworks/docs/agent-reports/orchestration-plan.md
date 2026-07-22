# Game-Feel Overhaul — Orchestration Plan & Dependency Map

Lead: Claude (architecture, decomposition, integration, verification gate, commits).
Implementation: Codex CLI (pure/testable slices), Claude owns shared lifecycle files.

Baseline at start: 257 unit tests green, build clean, branch `feat/turret-modules-and-minesweeper`.

## Dependency map (files → owner)

| Concern | Key files | Owner | Slice |
|---|---|---|---|
| Wave balance (formulas, report helper) | `survival/WaveManager.ts`, new `survival/waveBalance.ts`, `core/turretModules.ts` (EMP wave) | Codex A | 2 |
| Run-save schema v2 + migration | `core/runSave.ts` | Codex B | 1 |
| Repair economy (pure helpers) | `core/economy.ts` (+ `core/upgrades.ts` read-only) | Codex B | 1 |
| Checkpoint / pending rewards / repair phase / failure rollback | `app/App.ts`, `survival/SurvivalMode.ts` | **Claude (integration)** | 1,5 |
| Store atomic Unlock&Buy, upgrade previews, wheel disclosure | `editor/ui.ts`, `editor/EditorMode.ts` | Codex C (serial) | 3 |
| Loop tutorial + practice wave + one-time bonus | `core/tutorial.ts`, new app tutorial session, `editor/EditorMode.ts`, `survival/SurvivalMode.ts` | Codex D (serial) | 4 |
| Victory/failure summaries, New-Garage confirm, garage banner | `survival/SurvivalMode.ts`, `editor/ui.ts`, `app/App.ts` | Claude + Codex E | 5 |

## Verified balance oracle (Slice 2)

- Effective per-kind HP = `BASE_ZOMBIE_STATS.health(40)` × `healthMultiplierForWave(wave)` × kind mult
  (walker 1, thrower 1.6, worker 1.3, phone-addict 1.2).
- Flat kill reward: walker 3, thrower 8, worker 12, phone-addict 10.
- Clear bonus = `waveRewardForWave(wave)` = 40 + wave·10.
- New formulas: `healthMultiplier = min(1 + 0.06·(wave-1), 2.2)`; `thrower = wave>=3 ? min(1+floor((wave-3)/2),10) : 0`.
- Reproduces the prompt table exactly (waves 1/2/3/4/7/10/15 = HP 520/678/923/1114/2018/3092/5336; reward 89/108/135/154/239/326/467). Cumulative w1–4 = $486.

## Execution order (vertical slices, app runnable after each)

1. **A ∥ B** (parallel, disjoint pure/testable). Verify + commit each.
2. **Slice 1/5 integration** (Claude, App+SurvivalMode) on top of A+B helpers. Verify + commit.
3. **C** Slice 3 store/upgrade UI. Verify + commit.
4. **D** Slice 4 tutorial loop. Verify + commit.
5. **E** Slice 5 remaining summaries/confirm/banner polish. Verify + commit.
6. Playwright visual QA (desktop + narrow), balance report seam, docs + final report `docs/agent-reports/game-feel-implementation.md`.

Gate after every task: `npm run typecheck && npm run lint && npm run test:unit && npm run build` + browser exercise for UI slices.

## Progress log

- ✅ Slice 2 balance — `a6452c4` (266 unit)
- ✅ Slice 1a pending rewards — `19aae1e` (272 unit)
- ✅ Slice 1b checkpoint + failure recovery + save v2 — `e4b16b9` (280 unit)
- ✅ Slice 1 repair economy + garage UI — `89dfbad` (287 unit)
- ⏳ Slice 3 store/upgrade UI, Slice 4 tutorial, Slice 5 summaries/confirm, final QA + docs

## KNOWN ISSUE — stale e2e suite (pre-existing, not from this work)

`npm test` (Playwright) shows 13/43 failing on a CLEAN base (commit `e7f2ebc`, before any overhaul work).
Root cause: the "radically simple editor" rewrite (`526a5ba`) replaced the old `.palette` editor UI with
`.garage-dock`, and renamed title buttons (e.g. `New` → `New Game`), but the e2e specs were never updated.
Failing specs assert `locator('.palette')` / `getByRole('button', {name:'New', exact:true})` etc. The 30
passing specs are survival/debug-seam-driven (where this overhaul's changes live) and all pass.
Action: repair the stale selectors (`.palette`→`.garage-dock`, title button names) + add fresh Playwright
checks for the new garage/repair/victory/tutorial UI during final QA. Do NOT treat these as overhaul regressions.
