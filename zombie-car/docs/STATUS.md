# STATUS

## File ownership (no agent edits outside its rows; frozen files need orchestrator approval)

| Owner | Files |
| --- | --- |
| Orchestrator (frozen) | `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/types/**`, `src/core/EventBus.ts`, `docs/**` |
| Agent A — Foundation/world | `src/main.ts`, `src/core/**` (except EventBus.ts), `src/world/**`, `src/config/gameConfig.ts` |
| Agent B — Vehicle | `src/vehicle/**`, `src/input/**`, `src/camera/**`, `src/config/vehicleTuning.ts`, `src/config/blueprints.ts` |
| Agent C — Combat | `src/zombies/**`, `src/waves/**`, `src/weapons/**`, `src/effects/**`, `src/config/zombieConfig.ts`, `src/config/waveConfig.ts`, `src/config/weaponConfig.ts` |
| Agent D — UI/progression | `src/ui/**`, `src/economy/**`, `src/config/upgradeDefs.ts`, `src/config/economyConfig.ts` |

## Integration contract

- `src/main.ts` (A) builds `GameContext`, instantiates systems, registers them
  with the loop in order: input → vehicle → zombies → waves → weapons →
  effects → camera → economy → ui. The core `GameDirector` (A) owns phase
  transitions: boot ⇒ Countdown(3s) ⇒ WaveActive; `wave:completed` ⇒ Upgrade;
  `ui:startNextWave` ⇒ Countdown; `vehicle:destroyed` ⇒ GameOver;
  `ui:restartRun` ⇒ reset all systems ⇒ emit `game:restarted` ⇒ Countdown.
- Cross-system communication only via `GameContext` (`state`, `events`) and
  the interfaces in `src/types/index.ts` (`VehicleApi`, `ZombieQuery`,
  `WorldApi`, `GameSystem`).
- Collision groups: use presets from `src/types/collision.ts`.

## Progress

- [x] Scaffold: Vite/TS config, deps installed (three 0.185, rapier3d-compat 0.19, vite 8, ts 7), index.html, shared types, event bus, BUILD_SPEC
- [x] Agent A: core loop, Rapier init, director/phases, open voxel graveyard,
      moon/ambient/lantern/player-focus lighting, sparse collision
- [x] Agent B: vehicle blueprint/factory, arcade controller, input, camera
      (fix pass done: one-shot applyImpulse + post-impulse speed clamp replaced
      persistent addForce; boot healthChanged emits; component HP total 200 —
      runtime-verified: HUD 200/200 at boot, no speed runaway, no console errors)
- [x] Agent C: zombies, waves, swarm slowdown, turret, effects
      (`createCombatSystems(ctx, world, vehicle)` from `src/zombies/index.ts`;
      fix pass: zombies stuck against the low SE barrier stalled waves — probe
      ray lowered to knee height, capsule friction 0, canSleep(false), plus a
      4s no-progress teleport-respawn watchdog guaranteeing wave completion)
- [x] Agent D: HUD, economy, upgrades, overlays (HUD verified on desktop +
      375×667 mobile viewport)
- [x] Integration + tuning (combat wired into main.ts; vehicle friction fix:
      collider friction 0.9 → 0 — solver contact friction was cancelling ~7 of
      the 9 m/s² engine accel; now 0→14 m/s in ~1.5s with hard cap at 14)
- [x] Verification: tsc clean, `npm run build` clean, production build smoke-
      tested via `vite preview` + headless Chrome. Full-loop runtime test
      passed: countdown → wave 1 (11 zombies) → turret kills → wave complete
      (+$110 kills, +$125 wave) → upgrade purchase applies → Start Next Wave →
      wave 2 (14 zombies) → forced destruction → game-over stats → in-place
      restart resets money/hp/upgrades/wave. Swarm pipeline verified (contacts
      → capped slowdown → swarm:changed → HUD indicator); SWARMED needs ~5
      simultaneous contacts by design (threshold 0.45 of max drag). Mute
      toggle verified. Wave 5 (23 zombies, 1.48x HP) completes under load.
- [x] Fresh-context verifier audit vs BUILD_SPEC: no BLOCKER/MAJOR findings.
      All actionable findings fixed and runtime-re-verified: restart now
      resets `state.modifiers` BEFORE system resets (no stale max-health
      flash); `setDrivingEnabled` wired in main.ts (controls locked during
      Upgrade/GameOver); tire dust added to EffectsSystem; turret no longer
      swallows shots when the projectile pool is exhausted. Accepted as-is:
      duplicate (harmless) resize listeners; spawn-ring points validated
      manually rather than in code. Final `npm run build` clean.

## Decisions

- Rapier via `@dimforge/rapier3d-compat` (`await RAPIER.init()`), wasm inlined — static-host friendly.
- Upgrades mutate only `state.modifiers` / `state.money` / `state.upgradeLevels`; systems read modifiers live each frame (Vehicle Armor: vehicle watches `maxHealthBonus` growth and restores the delta).
- Swarm slowdown from combat-side contact tracking: Agent C counts touching zombies and calls `vehicle.setSwarmContacts(n)`; Agent B converts contacts → capped temporary multipliers and emits `swarm:changed`.
- Fixed-step physics (60 Hz) with clamped accumulator; render-rate updates separate.
