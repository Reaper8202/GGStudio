# Opus Implementation Prompt: Progression, Difficulty, and Quality of Life

You are Claude Opus acting as the lead engineer and game-design orchestrator for **Zombie Motorworks**, a Three.js + Rapier vehicle builder and zombie-wave survival game. Work in the repository root and implement the work end to end. Do not stop after producing a plan.

## Repository and current state

- Repository: `/Users/derek/Desktop/crazygames/zombie-motorworks/zombie-motorworks`
- Current branch when this prompt was written: `feat/turret-modules-and-minesweeper`
- Relevant entry points:
  - `src/app/App.ts`: application lifecycle, profiles, run transitions, saves
  - `src/core/economy.ts`, `profile.ts`, `parts.ts`, `upgrades.ts`, `turretModules.ts`, `tutorial.ts`
  - `src/editor/EditorMode.ts`, `src/editor/ui.ts`
  - `src/survival/SurvivalMode.ts`, `WaveManager.ts`, `zombies/`
  - `src/runtime/vehicle.ts`, `weapons.ts`
- Preserve unrelated worktree changes. At prompt creation, `../zombie-car/package-lock.json` was staged as deleted; do not modify, restore, or include it.
- Read `README.md`, architecture docs, the files above, and the relevant tests before editing.

## Product intent

Make the run loop understandable, internally consistent, difficult for the right reasons, and efficient to operate. Target players include children aged 12+, but the builder should retain depth for experienced players.

The intended loop is:

`build -> test -> fight -> understand damage/reward -> repair or improve -> fight again`

The current implementation violates that loop in several ways:

- Garage entry fully heals surviving parts because HP is not carried through the editor.
- Dying restores the older blueprint, including parts lost since the last garage visit.
- Kill rewards are permanently credited before the wave is cleared, making farm-and-die profitable.
- `Next Wave`, garage, reset, save/quit, and game over apply different checkpoint rules.
- The tutorial ends before combat, rewards, damage, and upgrades.
- The first three waves contain only walkers, while later difficulty compounds count, health, speed, damage, and spawn pressure.
- Store purchases require separate unlock, buy, inventory, and placement interactions.
- Important consequences and progression gates are poorly explained.

## Explicit non-goals

- Do **not** add audio or audio infrastructure.
- Do not add bosses, new enemy types, new part classes, global technology trees, monetization, or multiple garage slots.
- Do not broadly rewrite physics, rendering, vehicle assembly, zombie AI, or the visual theme.
- Do not introduce hidden dynamic difficulty adjustment.
- Do not change prices, speed scaling, attack-damage scaling, spawn caps, or base rewards except where explicitly specified below.
- Do not silently retune constants beyond this specification. If testing disproves a value, document the evidence and make the smallest defensible adjustment.

## Research-backed design constraints

Use these as decision constraints, not as cargo-cult rules:

1. Internal rules and feedback must be consistent and non-exploitable. Hunicke's DDA paper specifically warns that systems players can game and unintended feedback consequences damage balance: <https://doi.org/10.1145/1178477.1178573>.
2. Constant pressure is fatiguing; readable peaks, valleys, and structured threat variation improve pacing. Valve's Left 4 Dead director talk is the reference, but this pass should not build a full AI director: <https://steamcdn-a.akamaihd.net/apps/valve/2009/GDC2009_ReplayableCooperativeGameDesign_Left4Dead.pdf>.
3. Teach mechanics through play, in small units, and observe whether players internalize them. References: <https://gdcvault.com/play/1015541/How-I-Got-My-Mom>, <https://gdcvault.com/play/1021120/Prime-Teach-Observe-Tutorializing-Innovative>, and <https://www.gdcvault.com/play/1023231/The-Gamer-s-Brain-Part>.
4. Economy and balance values must be represented as cost/utility curves and measurable milestones, then playtested. References: <https://www.gdcvault.com/play/1023564/Math-for-Game-Programmers-Balancing>, <https://www.gdcvault.com/play/1029078/Free-to-Play-Summit-Playtesting>, and <https://www.gdcvault.com/play/1023865/Balancing-Your-Game-A-Formula>.
5. A short session needs immediate, frequent, meaningful reward feedback. The Sproggiwood postmortem is a useful first-hand example: <https://www.gamedeveloper.com/design/design-postmortem-story-driven-roguelike-sproggiwood>.
6. Destructive actions need explicit prevention or confirmation, and advanced controls should appear at the point of need. References: <https://media.nngroup.com/media/articles/attachments/Heuristic_5_compressed.pdf> and <https://media.nngroup.com/media/reports/free/Application_Design_Showcase_2nd_edition.pdf>.

The research supports the direction, but it does **not** prove that a universal per-wave percentage is correct. Treat the constants below as project-specific baselines with automated checks and playtest gates.

## Orchestration protocol

Use subagents if the environment supports them, but retain one integration owner for shared lifecycle files.

Suggested bounded workstreams:

1. **Run-state owner:** checkpoint, HP persistence, provisional rewards, repair, save migration. This owner may edit `App.ts` and `SurvivalMode.ts`.
2. **Balance owner:** pure wave/economy helpers and unit tests. Avoid shared UI and lifecycle files.
3. **Tutorial/UI owner:** tutorial state machine, store flow, dialogs, garage/victory presentation.
4. **Adversarial reviewer:** inspect incentives, migrations, exploit paths, and missing browser tests. Prefer review and tests over parallel edits to shared files.

Before implementation, produce a dependency map. Land work as vertical slices, keeping the application runnable after each slice. The lead agent owns final integration, conflict resolution, visual QA, and full test execution.

## Slice 1: Define one checkpoint, damage, and reward contract

Implement and test this exact behavioral contract:

1. A **wave-start checkpoint** contains the blueprint, surviving part IDs, per-part HP, current wave, cumulative kills, and already banked run earnings.
2. Kill rewards earned during an active wave are **pending**, not permanent. The HUD must label them as pending.
3. Clearing a wave atomically banks its kill rewards plus clear bonus exactly once.
4. At clear, commit the vehicle's surviving-part blueprint and HP as the next checkpoint before either intermission action is processed. Losses from cleared waves therefore remain real.
5. `Continue Now` starts the next wave in the existing survival scene with the current HP and destroyed parts still absent.
6. `Garage / Repair` opens the editor with the exact same surviving parts and HP. Merely entering or leaving the garage must not heal anything.
7. Failing a wave restores the checkpoint from the **start of that failed wave**, discards that wave's pending rewards, and ends the run. It must not restore parts lost in earlier cleared waves. Run-end recovery restores the checkpoint's surviving parts to full HP before returning to the ordinary garage; the next `Fight Zombies` action starts a new run at wave 1.
8. `Reset Wave` uses the same checkpoint and rollback behavior as failure.
9. `Save & Quit` stores the wave-start checkpoint and already banked run earnings. Because the wave restarts on resume, current-wave damage, kills, and pending rewards must not be retained. Update the UI copy to state this plainly.
10. Existing run saves must either migrate safely or fail closed to a valid garage state. Bump the saved-run schema if needed and keep a decoder for valid schema-1 data.

Do not store transient HP in the persistent blueprint format. Keep it in explicit active-run/checkpoint state so ordinary garage saves remain compatible. Full HP at run-end recovery is deliberate; the cost of failure is losing current-wave pending earnings and resetting wave progress, while part losses committed by earlier clears remain permanent.

### Repair policy

- Add per-part repair and `Repair All` during an active run's garage phase.
- Cost per part:

```text
ceil(basePartCost * missingHpFraction * 0.50)
```

- Use catalog base cost, not upgrade/module investment. Zero-cost root/control parts repair for free.
- A repair restores that part to its current effective maximum HP.
- A newly placed part starts at full HP.
- Removing or selling a part removes its HP entry.
- Upgrading a damaged part preserves its HP percentage against the new maximum; it must not produce a free full heal.
- Destroyed parts require replacement; repair cannot resurrect them.
- Show current integrity and total repair cost in the run banner.

The 0.50 repair rate is an internal-economy baseline, not an external fact. It matches the existing 50% resale rule. The starter rig has about $442 of non-root base part cost, so 20% uniform damage costs about $45 and 50% damage about $111. That is meaningful relative to wave rewards without consuming several waves of income.

## Slice 2: Make early progression varied without changing every axis

Change only these wave values in the first balance pass:

```ts
healthMultiplier = Math.min(1 + 0.06 * (wave - 1), 2.2)

throwers = wave >= 3
  ? Math.min(1 + Math.floor((wave - 3) / 2), 10)
  : 0
```

Keep the current walker, worker, and Phone Addict formulas. Keep speed multiplier, attack-damage multiplier, horde interval, maximum active count, base stats, kill rewards, and clear rewards unchanged.

Expected checkpoints, using `walkers/throwers/workers/phone-addicts`:

| Wave | Proposed composition | Effective total enemy HP | Total possible reward |
|---:|---:|---:|---:|
| 1 | 13/0/0/0 | 520 | $89 |
| 2 | 16/0/0/0 | 678 | $108 |
| 3 | 19/1/0/0 | 923 | $135 |
| 4 | 22/1/0/0 | 1,114 | $154 |
| 7 | 31/3/1/0 | 2,018 | $239 |
| 10 | 40/4/2/1 | 3,092 | $326 |
| 15 | 55/7/3/2 | 5,336 | $467 |

Important invariants:

- Wave 1 is numerically unchanged.
- Wave 3 introduces one Thrower without a major total-HP spike.
- Proposed cumulative rewards through wave 4 remain exactly $486, the same as the current curve; rewards are redistributed by +/-$8 between waves 3 and 4.
- Wave 10 effective enemy HP is about 21% below the current curve, while speed, damage, count pressure, and specialist behavior remain unchanged.
- A level-1 turret deals 21 DPS. A wave-10 walker should take about 2.93 seconds of continuous fire instead of about 3.62 seconds. This is intended to reduce sponginess, not remove pressure.

Add a pure balance-report helper used by unit tests and the debug seam. It should expose composition, multipliers, effective total HP, and total possible reward for a requested wave. Do not make production behavior depend on the debug seam.

### Counter progression

- EMP becomes available after clearing wave 9, before the first normal Phone Addict on wave 10.
- Keep the alternative unlock after killing one Phone Addict for migrated or debug states.
- On the wave-9 victory screen, warn that shielded enemies arrive next and recommend visiting the garage for EMP.
- Keep Workers first appearing on wave 7 and mines visible through wave 7.
- Clarify Mine Sweeper copy: while locked, show `Unlock early $220` and `Free after Wave 7`. Reaching the milestone still unlocks it for free.

## Slice 3: Preserve economy values while removing transaction friction

Do not implement the earlier idea that an unlock automatically discounts or includes a free part; that changes effective prices by roughly 10% to 45% depending on the item and is not yet validated.

Instead:

- A locked store item offers one atomic action: `Unlock & Buy $TOTAL`, where `TOTAL = unlockCost + partCost`.
- The transaction either deducts the total, records the unlock, and adds one copy, or changes nothing. Never leave a paid unlock without the requested part because a later step failed.
- An unlocked item uses `Buy & Place $COST`.
- After either purchase, arm the purchased part immediately while retaining normal inventory semantics.
- Show the unlock and part-price split in secondary text.
- Keep every existing catalog price and sell refund unchanged.

### Upgrade readability

Before purchase, show the selected part's concrete before/after values and affected whole-vehicle metrics. Examples:

- `DPS 21.0 -> 25.4`
- `Integrity 140 -> 151`
- `Top Speed 55 -> 61 km/h`

Calculate previews through the same pure upgrade and analysis functions used by gameplay. Do not duplicate upgrade formulas in the DOM layer. Preserve the current upgrade curve in this pass.

Move wheel `Driven`, `Steering`, and `Braking` checkboxes into a collapsed `Advanced wheel setup` disclosure. Keep automatic wheel defaults and preserve explicit player overrides.

## Slice 4: Replace the destructive build-only tutorial with a loop tutorial

The tutorial must teach `build -> test -> fight -> reward -> upgrade` and must never liquidate the player's current rig.

Required behavior:

1. Launch the build tutorial in isolated sandbox state. Snapshot the current blueprint, profile money, inventory, unlocks, active-run context, and editor view before entering.
2. Keep the useful existing guided build steps, using a temporary tutorial inventory. Tutorial placement, deletion, sales, and purchases must not affect the real profile.
3. Teach Test Drive after the vehicle validates.
4. Return to the tutorial flow and run a Practice Wave containing exactly six walkers, no specialists, `0.75x` health and `0.50x` attack damage. Practice does not modify normal highest-wave, unlock, run-save, or reward state.
5. On the first successful completion only, restore the original real garage, grant a one-time $90 tutorial bonus, highlight the starter turret, and guide the player through its level-2 upgrade. The bonus equals the existing first turret-upgrade price.
6. Replaying or abandoning the tutorial restores the exact pre-tutorial state and cannot generate money or inventory.
7. Persist tutorial completion robustly enough that refresh/re-entry cannot repeat the $90 grant.

If cross-mode tutorial state cannot be kept cleanly inside `EditorMode`, introduce a small application-level tutorial session model. Do not hide this lifecycle inside DOM code or ad hoc localStorage flags.

## Slice 5: Make consequences and next actions legible

### Victory and failure summaries

Extend the victory screen with:

- current vehicle integrity
- damaged-part count
- destroyed/detached part names and their replacement base value
- banked reward versus pending reward
- exact next-wave composition
- a prominent warning when the next wave introduces Throwers, Workers/mines, or Phone Addicts/shields
- buttons renamed to `Continue Now` and `Garage / Repair`

Extend the game-over/garage summary with:

- failed wave
- banked run money retained
- failed-wave pending money discarded
- failed-wave checkpoint restored, then surviving checkpoint parts recovered to full HP because the run ended
- destroyed parts committed by previously cleared waves

The active-run garage banner should answer: which wave is next, current integrity, repair-all cost, and whether a new threat or unlock is imminent.

### Destructive action protection

`New Garage` must open a confirmation dialog before changing state. Show:

- installed non-root part count
- total paid investment, including upgrades/modules
- exact resale refund
- exact value forfeited

Provide explicit `Cancel` and `Sell Parts and Start New` actions. Keep undo behavior if it remains valid, but do not rely on undo as the warning.

### Garage focus

- Keep Store and Inventory, but let the atomic `Buy & Place` flow bridge them.
- When no part is selected, show a compact contextual next action rather than an empty inspector.
- Keep detailed part stats and modules contextual to selection.
- Do not remove vehicle metrics, paint, manual wheel overrides, or expert functionality; disclose secondary controls at the point of need.

## Testing and acceptance gates

Use test-first work for run-state and economy rules. At minimum, add coverage for:

1. Garage round-trip preserves exact surviving part HP.
2. Continue and garage begin the next wave from equivalent HP when no repair occurs.
3. Clear commits destroyed-part loss; failure cannot resurrect losses from an earlier cleared wave.
4. Failure, reset, and save/quit discard current-wave pending rewards.
5. A reward is banked exactly once on clear.
6. Game over restores the failed wave's start-checkpoint blueprint, keeps earlier cleared-wave losses committed, performs explicit run-end recovery, and starts the next run at wave 1.
7. Repair costs, `Repair All`, zero-cost parts, new parts, selling, and damaged-part upgrades follow the specified rules.
8. Schema-1 run saves decode or migrate safely.
9. Wave composition, multiplier, effective-HP, reward checkpoints, and the $486 wave-1-to-4 cumulative invariant match the table.
10. EMP unlocks after wave 9; Mine Sweeper early/free copy is accurate.
11. Locked purchase is atomic, charges the existing total price, grants one item, and arms it.
12. Upgrade previews use effective gameplay values.
13. Tutorial cancel/replay is non-destructive and its $90 completion bonus cannot be farmed.
14. New Garage cannot execute without explicit confirmation.
15. Victory and failure summaries report the correct committed/pending values.

Run and pass:

```sh
npm run test:unit
npm run lint
npm run build
npm test
```

Also run a deterministic debug balance report for waves 1-15 and include it in the final report. Use Playwright to visually verify the garage, repair state, upgrade preview, tutorial, victory, game-over summary, and milestone warnings at desktop and narrow/mobile viewports. Check for text overflow, control overlap, disabled-action ambiguity, duplicate HUD roots, and stale state after repeated mode transitions.

Update `README.md` and relevant architecture/integration docs so their run-damage and reward descriptions match the implementation.

## Required final report

Write `docs/agent-reports/game-feel-implementation.md` containing:

- implemented behavior by slice
- files changed
- migrations and compatibility decisions
- before/after wave table for waves 1-15
- repair-economy examples
- tests and visual checks run
- any numerical deviation from this prompt, with evidence
- remaining playtest questions, especially wave-clear rate, average integrity, repair spend, purchase timing, and first failure wave

Your final response must lead with completed behavior and test results. Do not claim the numerical tuning is proven fun; call it a measured baseline pending human playtests.
