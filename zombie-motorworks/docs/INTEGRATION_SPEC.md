# Zombie Motorworks — Integration Design Contract

All paths relative to `zombie-motorworks/` (the merged game, formerly Scrap Rig at repo root).
Zombie-car reference code lives at `../zombie-car/` (read-only reference; never import from it).

## Non-negotiables
- `src/core` stays pure (no Three, no Rapier, no DOM, no localStorage). `src/runtime` stays Three-free (Rapier only).
- All blueprint edits go through `src/core/commands.ts` command objects (undoable).
- Keep Three 0.178 / Rapier 0.14 / TS 5.8 / Vite 7 — downport any zombie-car code (its Rapier usage is basic: capsules, lockRotations, setLinvel; its Three loaders OBJ/MTL/FBX exist in 0.178 examples/jsm).
- Every phase must end with: `npm run build` green, `npm run test:unit` green, and (run by orchestrator, not Codex) Playwright + screenshot check.
- No merge markers, no dead code, no `any` unless unavoidable.

## Mode architecture
`App` (src/app/App.ts) gains a third mode alongside EditorMode/ChamberMode:

```ts
// src/survival/SurvivalMode.ts — mirrors ChamberMode's shape
class SurvivalMode {
  constructor(
    root: HTMLElement,
    renderer: THREE.WebGLRenderer,
    bp: VehicleBlueprint,            // deep-cloned inside; editor copy never mutated
    run: RunState,                    // current wave only
    callbacks: {
      profileMoney(): number;
      runEarnings(): number;               // summary telemetry, not spendable state
      onReward(amount: number): void;       // credits the shared profile live
      onBuildPhase(run: RunState, survivingPartIds: readonly string[]): void;
      onGameOver(run: RunState): void;     // vehicle dead → App returns to editor
      onExit(run: RunState): void;         // abandoning a run also checkpoints rewards
    },
  )
  update(dtMs: number): void;         // fixed 1/60 accumulator inside, like ChamberMode
  dispose(): void;
}
```

`App` additions:
- `startRun(bp)` — autosaves blueprint slot, creates fresh `RunState{wave:1}`, resets the non-persistent run-earnings summary, enters SurvivalMode.
- `resumeRun(bp, run)` — from BuildPhase "Start Wave N+1" button (validation-gated like test drive).
- Editor receives optional `runContext` — when present, shows the cleared-wave banner and relabels "Fight Zombies" to "Start Wave N+1" (test drive stays available).
- `App` owns one loaded `PlayerProfile`, restores `currentBlueprintName` on later boots, and passes the same profile reference to every editor/runtime mode.

## RunState & persistence
```ts
// src/core/economy.ts (pure)
interface RunState { wave: number; }          // money lives in the profile, not RunState

// src/core/profile.ts (pure codec) + src/app/profileStore.ts (localStorage IO)
interface PlayerProfile {
  schemaVersion: 1;
  money: number;
  unlockedDefIds: string[];
  currentBlueprintName?: string;
}
```
- localStorage key `scraprig.profile.v1`. Corrupt/missing → default profile (starter unlocks, starting money 200). Never throw to caller.
- Persisted balances must be finite safe integers; malformed fractional/unsafe balances fall back to the default profile.
- Starter unlocks: chassis-core, frame-box, wheel-standard, driver-seat, engine-small, fuel-tank, turret.
- Money flows: zombie kill reward + wave reward → profile.money (persisted at wave end / game over). Buying a part deducts catalog `cost` (or `unlockCost` first time for locked defs). Selling (removing) a placed part refunds `floor(0.5 × invested)` where invested = cost + upgrade spend. Upgrading costs `round(basePrice × growth^(level-1))` per level (model from zombie-car items).
- Blueprint commands carry a `moneyDelta`. Execute/undo/redo apply the command and exact inverse delta atomically; undoing placement refunds its full purchase price, while undoing a sale re-charges that sale's exact refund. Successful editor transactions silently autosave the current blueprint alongside the persistent wallet.
- New-build and tutorial resets are whole-blueprint commands: non-root inventory receives the normal sale refund, and undo restores the prior build while re-charging that exact amount.
- The profile names one canonical active blueprint slot. Renaming moves that slot instead of copying it, and inactive legacy slots cannot be swapped in, preventing saved-blueprint copies from duplicating sellable inventory.

## Schema v4 (src/core/types.ts, serialize.ts)
- `PartConfig` gains `level?: number` (default 1).
- New catalog parts: `armour-plate` (armour payload {protection}, face-mount slab — assembler already supports), `cannon-heavy` (weapon, aimMode manual, slow high-damage).
- `WeaponDefinition` gains `aimMode: 'auto' | 'manual'` (turret = auto).
- Migration v3→v4: pass-through + defaults. Unit tests for round-trip + v1/v2/v3 fixtures still migrating.

## Upgrade scaling (src/core/upgrades.ts, pure)
`effectivePartDef(base: PartDefinition, level: number): PartDefinition` — returns scaled copy:
- engine: torque/power ×(1+0.10(level−1)); wheel: friction ×(1+0.06(level−1)); weapon: damage ×(1+0.12(level−1)), fireRate ×(1+0.08(level−1)); armour: protection +flat/level; all parts: health ×(1+0.08(level−1)). maxLevel 5 default.
Used by analysis, assembler, and editor stat UI so numbers always agree. Levels ≤1 or missing → base def unchanged.

`getEffectiveDef` is consumed by analysis, runtime assembly/weapon creation, and the editor part panel.

## Survival systems (src/survival/, ported & adapted from ../zombie-car/src)
- `world/`: VoxelAssetLoader (OBJ/MTL+FBX, template cache), Graveyard (halfSize 35, instanced ground, perimeter wall colliders in GROUP_TERRAIN, spawnPoints, lighting). Assets copied to `public/assets/graveyard/**`, `public/assets/zombies/**`.
- `zombies/`: pooled Zombie (dynamic capsule, lockRotations, GROUP_ZOMBIE, memberships collide with terrain+vehicle+zombie), state machine, setLinvel steering + separation + stuck watchdog, voxel visuals with capsule fallback while loading. Zombie attack (within 2.4u, 1s interval) → `vehicle.applyDirectDamage(nearestPartId, dmg)`. Ram: vehicle speed ≥5 → damage speed×3.5 + knockback impulse to zombie.
- `waves/WaveManager.ts`: count 8+3w, maxActive min(8+w,30), hp ×(1+0.12(w−1)), speed ×(1+min(0.025(w−1),0.5)), hordes 3-8 every 3s from ≥18u, waveReward 100+25w.
- `TurretAimController`: per auto-weapon, acquire nearest live zombie within range/arc, slew, fire when |aimErr| ≤ 0.09 rad. Manual weapons read mouse aimYawWorld + fire key. RuntimeVehicle controls extension: `perWeaponAim?: Map<partId,{aimYawWorld:number, fire:boolean}>` overriding global for auto weapons.
- HUD (`ui/`): part-HP-derived vehicle integrity bar, wave, shared profile wallet, zombies left, and countdown overlay. Plain DOM like chamber HUD; direct per-frame polling from SurvivalMode (no event bus — scrap-rig has none; do not port zombie-car's EventBus). Game over returns to the editor, where the run summary is shown.
- FollowCamera + minimal effects (muzzle tracer already exists in chamber renderer; impact puffs optional).
- Death rule: root part (chassis-core) destroyed OR no live providesControl part → game over. Wave end: surviving parts repaired to full; destroyed/detached parts removed from blueprint permanently (money already spent — refund nothing).
- Wave completion is queued until the current fixed step finishes. The wave-clear bonus is paid only after that outcome is selected, so simultaneous vehicle destruction wins without counting or rewarding the uncleared wave. `App` then prunes directly to the reported survivor IDs and clears history, preventing pre-wave undo entries from resurrecting lost parts or changing money. Game over does not prune, so the irreplaceable root remains recoverable for a fresh run.

## Input
Keyboard: W/S throttle/brake, A/D steer, Space handbrake, mouse aim + click/F fire (manual weapons). Port VirtualJoystick for touch → emits throttle/steer from stick Y/X.

## Testing
- Seam (`?debug=1`, tests/seam.ts): `enterSurvival()`, `survivalTelemetry()` (wave, profile money, cumulative run money, zombiesAlive, partHp map, phase), `profile()`, `grantMoney(n)`, `buyUpgrade(partId)`, `sellPart(partId)`, `unlockPart(defId)`, `runState()`, and `forceWaveComplete()`.
- Deterministic physics seam: `setSimPaused(true)` makes Chamber/Survival rAF updates render only; `stepSim(n)` synchronously advances exactly `n` fixed 1/60 ticks and performs one visual sync at the end. The heavy-ramp regression uses 120 settle + 480 driven + 90 comparison ticks.
- Playwright: full loop; wheel-move reflected in runtime wheel positions; add/remove gun; buy/sell/upgrade; unlock gating; reload persistence; corrupted profile fallback.
- Fixtures (tests/fixtures/): balanced.json, tall-unstable.json, bad-wheels.json, heavy-armour.json, multi-gun.json, minimal.json.
