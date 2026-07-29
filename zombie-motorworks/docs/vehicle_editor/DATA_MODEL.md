# Vehicle editor data model

`src/core/types.ts` is the source of truth for the serializable vehicle model. The current blueprint schema is **v4**.

## Core records

| Type | Purpose |
| --- | --- |
| `PartDefinition` | Immutable catalog entry: identity, category, occupied/clearance cells, sockets, mass, health, cost, reinforcement, optional upgrade/unlock metadata, and optional wheel/engine/weapon/armour/resource payloads. |
| `PlacedPart` | Blueprint instance: `{ id, defId, pos, orient, config }`. `pos` is integer cells and `orient` is an index from 0 through 23. |
| `VehicleBlueprint` | `{ schemaVersion, id, name, parts }`; contains only serializable data, never Three.js or Rapier objects. |
| `StructuralConnection` | Derived, not serialized, face-to-face connection with max force/torque and runtime health. |
| `ValidationReport` / `VehicleAnalysisReport` | Derived editor feedback. Validation errors block play; warnings do not. |

## `PartConfig` and upgrades

```ts
interface PartConfig {
  level?: number;             // omitted = catalog level 1
  driven?: boolean;
  steering?: boolean;
  steerInverted?: boolean;
  braking?: boolean;
  suspensionPreset?: 'light' | 'standard' | 'heavy-duty' | 'off-road';
  paint?: 'scrap' | 'red' | 'blue' | 'green' | 'yellow' | 'purple';
}
```

`level` is a positive integer and cannot exceed the catalog entry's `upgrade.maxLevel`. Upgrade metadata is `{ maxLevel, basePrice, priceGrowth }`. The effective definition is derived from the catalog and `config.level`; level 1 returns the base definition. Health rises 8% per extra level, with category payloads scaling as follows:

- engines: torque curve and max power +10% per step;
- wheels: longitudinal and lateral grip +6% per step;
- weapons: damage +12% and fire rate +8% per step;
- armour: protection +15% per step.

The value is validated during deserialization and used by editor analysis, runtime assembly, and weapon creation.

## Weapon and armour metadata

`WeaponDefinition` includes `mountType`, `aimMode`, arc, damage, fire rate, ammunition/power use, recoil, projectile speed, and range. `aimMode` is either `'auto'` or `'manual'`: an auto weapon acquires its own targets in range, a manual one only follows the player's aim input. Independently of `aimMode`, while the player holds fire every weapon abandons its acquired target and converges on the cursor point (`VehicleControls.manualAim`).

- `turret` is a self-acquiring, 360° turret.
- `cannon-heavy` is a self-acquiring, 360° heavy cannon with a splash payload. It is the one multi-cell gun: a 2x2 horizontal barbette (`cells` = the pad, a `ny` hardpoint and a cell of clearance over each of the four cells). Multi-cell weapons mount and fire from the middle of their footprint (`footprintCentreM`), not from the anchor cell.

`armour-plate` is a regular one-cell protection part in the current catalog (`cells: [{x:0,y:0,z:0}]`), not the older face-mounted-panel design. It has armour protection metadata and a high reinforcement multiplier. The runtime supports face-mounted definitions generically, but no current catalog part uses `armour.faceMounted: true`.

## Grid and orientation conventions

- Axes: `+X` vehicle right, `+Y` up, `+Z` forward.
- `CELL_SIZE = 0.5` metres.
- Bounds are inclusive: `GRID_MIN = { x: -6, y: 0, z: -8 }` and `GRID_MAX = { x: 6, y: 8, z: 8 }`, a 13 × 9 × 17-cell build volume.
- The grid exposes 24 proper axis-aligned cube rotations. `orient: 0` is identity; transformations are integer-grid operations, including X-axis mirroring.

## Serialization and migration

`serializeBlueprint` validates then emits JSON. `deserializeBlueprint` parses, migrates, and validates JSON; malformed data throws `BlueprintFormatError`.

| Step | Behavior |
| --- | --- |
| v1 → v2 | Renames legacy `type` to `defId` and converts `rotation.{rx,ry,rz}` to the canonical orientation index. |
| v2 → v3 | Maps retired mount/resource IDs, maps `engine-big`/`gun-fixed`, expands `beam-long`, and drops retired `armour-panel`/`shell-panel`. |
| v3 → v4 | Advances the version; absent `config.level` remains valid and resolves as level 1. |

Blueprint slots are stored in `localStorage['scraprig.blueprints.v1']`; the selected slot name is held by the persistent player profile.
