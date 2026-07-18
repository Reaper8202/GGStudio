You are Codex Agent A on the Scrap Rig project (3D modular vehicle builder, web, strict TypeScript).

READ FIRST (contracts — you must use them verbatim and MUST NOT edit them):
- src/core/types.ts  (all shared interfaces; single source of truth)
- src/core/grid.ts   (orientation/footprint math — reuse, do not duplicate)
- docs/vehicle_editor/DATA_MODEL.md
- docs/vehicle_editor/ARCHITECTURE.md

YOU OWN EXCLUSIVELY (create these; touch nothing else except package.json NEVER):
- src/core/parts.ts
- src/core/blueprint.ts
- src/core/serialize.ts
- unit/parts.test.ts
- unit/serialize.test.ts

TASK 1 — src/core/parts.ts: the part catalog. Export `PART_CATALOG: Record<string, PartDefinition>` and `getPartDef(id): PartDefinition` (throws on unknown). All parts use 1×1×1 cells unless stated. Faces at orientation 0. Conventions: every structural part declares a 'frame' socket on every exposed face of every cell unless stated. Include:

STRUCTURAL:
- chassis-core: isRoot, unique, 60 kg, health 400, reinforcement 1.5, cost 0, frame sockets all faces.
- frame-box: 25 kg, health 150, cost 10.
- frame-light: 12 kg, health 70, reinforcement 0.6, cost 8.
- frame-reinforced: 45 kg, health 320, reinforcement 2.0, cost 25.
- beam-long: cells (0,0,0),(0,0,1),(0,0,2); 55 kg, health 220, cost 22.
- wheel-mount: 18 kg, health 140, cost 15. Frame sockets on all faces EXCEPT px and nx, which are 'wheel-mount' sockets (id them 'wm-px','wm-nx').
- engine-mount: 20 kg, health 160, cost 15. Frame sockets all faces except py which is an 'engine-mount' socket.
- hardpoint: 15 kg, health 120, cost 20. Frame sockets all faces except py which is a 'hardpoint' socket.

FUNCTIONAL:
- driver-seat: unique, providesControl, 30 kg (incl. driver), health 80, cost 0. Frame sockets all faces.
- engine-small: requiresMount 'engine-mount', 120 kg, health 120, cost 60. Socket: single 'engine-mount' socket on ny face + frame sockets on remaining faces. engine: torqueCurve [[800,140],[2500,210],[4500,190],[6000,120]], maxRpm 6000, idleRpm 800, maxPowerKw 95, fuelPerSecondAtFull 0.03.
- engine-big: requiresMount 'engine-mount', 300 kg, health 200, cost 140. torqueCurve [[800,320],[2200,480],[4200,430],[5500,260]], maxRpm 5500, idleRpm 800, maxPowerKw 210, fuelPerSecondAtFull 0.07.
- fuel-tank: 15 kg empty (use 55 kg as placed mass incl. fuel), health 60, cost 20, fuelCapacity 40. Frame sockets all faces.
- battery: 40 kg, health 70, cost 25, batteryCapacity 500.
- ammo-box: 50 kg, health 60, cost 30, ammoCapacity 200.
- cargo-crate: 20 kg, health 90, cost 12, cargoCapacity 150.

MOVEMENT (wheels; suspension is integrated via presets at runtime):
- wheel-standard: requiresMount 'wheel-mount', 28 kg, health 90, cost 18. cells [(0,0,0)]. Single socket: type 'wheel-mount', face px (the wheel attaches inward via its +X side at orientation 0; axle along X). clearanceCells [(0,-1,0)] (travel volume below). allowedOrientations: only orientations that keep the axle on the world X axis and suspension downward — compute at module init by filtering all 24 with grid.rotateVec: keep o where rotateVec(o,{x:1,y:0,z:0}).y===0 && rotateVec(o,{x:1,y:0,z:0}).z===0 && rotateVec(o,{x:0,y:-1,z:0}).y===-1. wheel: radius 0.3, width 0.22, axleAxis {x:1,y:0,z:0}, suspensionDir {x:0,y:-1,z:0}, maxSteerAngleDeg 32, driveTorqueLimit 900, brakeTorque 1400, frictionLong 1.0, frictionLat 0.95, maxLoad 9000, suspension {restLength 0.35, travel 0.22, stiffness 42000, damping 3200, maxLoad 8000}.
- wheel-offroad: same shape/socket/clearance/orientation rule, 44 kg, health 130, cost 32. wheel: radius 0.42, width 0.3, same axleAxis/suspensionDir, maxSteerAngleDeg 28, driveTorqueLimit 1400, brakeTorque 1800, frictionLong 1.15, frictionLat 1.0, maxLoad 14000, suspension {restLength 0.45, travel 0.3, stiffness 56000, damping 4300, maxLoad 12500}.
NOTE: do NOT restrict wheels to "suspension downward" in a way that produces zero allowed orientations for wrong-mounting experiments — ALSO include the orientations where the axle points along Z or Y (any suspensionDir) in allowedOrientations, because the design brief requires players to be able to mount wheels WRONG and see physical consequences. So: allowedOrientations = all 24 (leave undefined). Instead export helper `wheelAxleWorld(orient): Vec3i` and `wheelSuspensionWorld(orient): Vec3i` (just rotateVec wrappers) for the runtime/analysis to use. Keep the filtering code OUT.

PROTECTION (face-mounted; cells: [] — they occupy a host face, not a cell):
- armour-panel: 22 kg, health 180, cost 14, armour {faceMounted:true, protection:25, cosmetic:false}. Single socket type 'armour', cell (0,0,0), face pz (orientation rotates which host face it covers; placed pos = host cell).
- shell-panel: 6 kg, health 25, cost 5, armour {faceMounted:true, protection:2, cosmetic:true}. Same socket shape.

WEAPONS:
- gun-fixed: requiresMount 'hardpoint', 45 kg, health 100, cost 45. Socket 'hardpoint' on ny face. weapon: mountType 'fixed', arcDeg 20, damage 12, fireRate 5, ammoPerShot 1, powerPerShot 0, recoilImpulse 90, projectileSpeed 120, rangeM 60.
- turret: requiresMount 'hardpoint', 85 kg, health 140, cost 90. Socket 'hardpoint' on ny face. clearanceCells [(0,1,0)]. weapon: mountType 'turret', arcDeg 360, damage 9, fireRate 8, ammoPerShot 1, powerPerShot 2, recoilImpulse 60, projectileSpeed 140, rangeM 70.

TASK 2 — src/core/blueprint.ts: pure helpers. `createEmptyBlueprint(name): VehicleBlueprint` (schemaVersion from types, id from a counter+timestamp string), `nextPartId(bp): string` (monotonic 'p1','p2'... never reuses: scan existing max), `withPartAdded/withPartRemoved/withPartUpdated` (immutable copies), `getPart(bp,id)`, `buildOccupancy(bp): Map<string,string>` cellKey→partId using worldCells+getPartDef (parts with empty cells contribute nothing), `buildArmourFaces(bp): Map<string,string>` "cellKey|face"→partId for face-mounted armour parts (host cell = pos, face = rotateFace(orient, socket.face)), `findRoot(bp)`, `hasControl(bp)`, `hasEngine(bp)`.

TASK 3 — src/core/serialize.ts per DATA_MODEL.md: `serializeBlueprint`, `deserializeBlueprint` (throws `BlueprintFormatError` with reason on: invalid JSON, missing fields, unknown defId, orient outside 0..23, duplicate part ids, non-integer positions), `MIGRATIONS` map with a real v1→v2 migration (v1 used field `rotation: {rx,ry,rz}` quarter-turn steps instead of `orient`, and `type` instead of `defId` — migrate using grid.orientationFromSteps), `CURRENT_SCHEMA_VERSION` re-export.

TASK 4 — tests. unit/parts.test.ts: catalog integrity — every socket sits on an occupied cell (or cells empty for face-mounted armour), socket faces valid, exactly one isRoot def, wheels have wheel defs with axleAxis/suspensionDir being one of the 6 unit axis vectors and full suspension params, engines have torque curves ascending in rpm, all masses>0, ids match record keys. Blueprint helpers: add/remove immutability, occupancy map correctness for a rotated beam-long, armour face map. unit/serialize.test.ts: round trip deep-equal; each corrupt case throws BlueprintFormatError; v1 fixture migrates to v2 with correct orient values.

RULES: strict tsconfig must pass (`npm run typecheck`), `npm run test:unit` must pass. No new dependencies. No changes outside your files. Do not run playwright. Report exactly: Done / Files changed / Tests run / Assumptions / Issues / Next recommended task.
