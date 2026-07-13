# BUILD SPEC — Zombie Vehicle Survival, Level 1 (canonical)

Top-down 3D zombie vehicle survival prototype for browser / future YouTube
Playables. TypeScript + Vite + Three.js + Rapier (`@dimforge/rapier3d-compat`)
+ HTML/CSS HUD. Primitive low-poly geometry only. No backend, no React, no
external assets. `npm install` / `npm run dev` / `npm run build`; the build is
a fully static app (`base: "./"`).

Shared contracts live in `src/types/index.ts` and `src/types/collision.ts`
(frozen). Event bus implementation: `src/core/EventBus.ts` (frozen).

## Game flow

- Loads directly into the construction site (no menu/tutorial/garage).
- Phases: `Countdown` (3 s, HUD countdown) → `WaveActive` → on wave clear
  `Upgrade` (panel, multiple purchases, explicit **Start Next Wave** button —
  never auto-start) → `Countdown` → … Vehicle destroyed ⇒ `GameOver` (final
  wave/kills/total money + **Restart Run**, clean in-place restart, no reload).
- During `Upgrade`/`GameOver`, dangerous gameplay is paused (no zombie attacks
  or movement, no vehicle damage).

## World — construction site

Compact map (zombies must regularly reach the player) built from primitives:
dirt+concrete ground, partial building structures, concrete barriers, pipes,
containers, pallets, construction fencing, traffic cones, debris, ≥1 drivable
ramp, open driving areas AND narrow choke points where a swarm can trap the
vehicle. Large objects: stable static colliders. Small props (cones, pallets,
debris): dynamic/movable. Perimeter keeps the vehicle in bounds. Provides
`WorldApi` (bounds + spawn points away from player view).

## Vehicle

- Instantiated by a reusable factory from `VehicleBlueprint` data (see types).
  Starter blueprint: 1 chassis, 4 visible wheels, front bumper, central engine
  block, roof turret mount. Systems must NOT assume exactly 4 wheels or one
  chassis shape.
- Arcade physics on a Rapier dynamic body: input is a desired world-space
  direction; vehicle rotates toward it, accelerates by input magnitude,
  reverses when target direction is sufficiently behind (> ~120°), coasts to a
  stop, no instant sideways movement. Forward/reverse accel, lower reverse top
  speed, momentum, braking, rolling resistance, mild lateral slip,
  speed-dependent + reduced high-speed steering, strong upright stability,
  auto-recovery when overturned/stuck (plus HUD reset button).
- All handling values in `VehicleTuning` (`src/config/vehicleTuning.ts`);
  never mutated at runtime — temporary multipliers only.
- Health: damage from timed zombie attacks and high-speed environment
  collisions (with configurable resistance + brief contact cooldown so damage
  is frame-rate independent). Health 0 ⇒ driving disabled, `GameOver`.

## Input

One virtual joystick (bottom-left, touch + mouse drag, touch-friendly size,
no page scroll/selection) + WASD/arrows on desktop. Output: one normalized
world-space direction vector + magnitude. No keyboard dependency overall.

## Camera

World-aligned angled top-down follow: smooth follow, slight look-ahead, modest
speed-based zoom-out, stable under physics jitter, small shake on
`impact:major`, clamped so the player stays visible near map edges, correct
resize on desktop/mobile.

## Zombies

Pooled low-poly zombies; stats: health, speed, attackDamage, attackInterval,
reward. States: Spawning → Chasing → Attacking / KnockedBack → Dead. Spawn at
map-edge spawn points away from the vehicle, never inside geometry, only while
active count < wave cap. Chase via direct steering with lightweight obstacle
correction (no navmesh). Attack when adjacent (timed damage). Vehicle impacts
deal speed-based damage + knockback. Kills award money (`zombie:killed`) and
return to pool after brief death feedback.

## Swarm slowdown

Each zombie touching/attacking the vehicle adds a configurable drag penalty
(`zombieDragPerContact`), capped at `maximumZombieDrag`, reducing
acceleration, max speed, and steering response via temporary multipliers.
1–2 zombies: minor; a group: noticeable; a large swarm: near-immobilizing; a
fast vehicle breaks through small groups. HUD shows **SWARMED** above a
configurable threshold. Contact tracking must be stable (sensor/distance
based — no physics explosions).

## Turret

Roof-mounted, fully automatic (player only drives): targets closest zombie in
range, visibly rotates toward it (`targetRotationSpeed`), fires at `fireRate`
using pooled projectiles, stops with no target, muzzle flash + impact
feedback. Stats: `WeaponStats` in `src/config/weaponConfig.ts`, scaled live by
`state.modifiers`.

## Waves (endless)

Configurable defaults (in `src/config/waveConfig.ts`):

```
zombieCount          = 8 + wave * 3
maximumActiveZombies = min(8 + wave, 30)
healthMultiplier     = 1 + (wave - 1) * 0.12
speedMultiplier      = 1 + min((wave - 1) * 0.025, 0.5)
waveReward           = 100 + wave * 25
```

Wave complete when all assigned zombies spawned and killed ⇒ stop spawning,
award reward, enter Upgrade. No final wave.

## Economy & upgrades

`startingMoney = 200`; money from kills + wave rewards; run-scoped only.
Upgrades (all in `src/config/upgradeDefs.ts`, `UpgradeDefinition`):
Weapon Damage, Fire Rate, Weapon Range, Vehicle Armor (raises max HP and
restores the added capacity), Engine Power, Reinforced Chassis (reduces
incoming damage), Anti-Swarm (reduces per-contact penalty). Panel shows
current level, current effect, next effect, price, disabled state when
unaffordable. Prices grow per level; effects apply immediately via
`state.modifiers` (systems read modifiers live).

## HUD

Wave, zombies remaining, health bar + number, money, total kills, countdown,
SWARMED warning, joystick, contextual reset-vehicle button, mute button.

## Performance

One WebGL canvas; pooled zombies/projectiles; simple colliders; limited
lighting; no post-processing; avoid per-frame allocations; clamp large dt;
pause when hidden; cap devicePixelRatio (≤2); smooth with ~30 active zombies.
Feedback: tire dust, zombie impact/death effects, muzzle flash, damage flash,
wave start/complete messages, purchase confirmation, small impact shake.
Audio: lightweight generated placeholders behind the `audio:play` event; no
sound before first user interaction; mute toggle.

## Definition of done

Loads into site → countdown → keyboard+joystick driving with stable arcade
physics → blueprint-built vehicle → zombies spawn/chase/attack/take impact
damage/die → turret auto-fires → swarm visibly slows vehicle → waves complete
and scale endlessly → money + upgrades work and persist for the run → game
over + clean restart → usable mobile layout → `npm run build` passes with no
TS errors → no recurring console errors → no TODO-stubbed core systems.
