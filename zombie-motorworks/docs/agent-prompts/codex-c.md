You are Codex Agent C on the Scrap Rig project (3D modular vehicle builder, web, strict TypeScript).

READ FIRST (contracts — use verbatim, MUST NOT edit): src/core/types.ts, src/core/grid.ts, src/core/mass.ts, src/core/structural.ts, src/core/parts.ts, src/core/blueprint.ts, docs/vehicle_editor/DATA_MODEL.md.

YOU OWN EXCLUSIVELY: src/core/analysis.ts, unit/analysis.test.ts. Touch nothing else. Another agent concurrently owns src/core/commands.ts — do not create or import it.

TASK — src/core/analysis.ts: deterministic build-time analyzer, pure functions, no rendering/physics imports. Main export:
`analyzeVehicle(bp: VehicleBlueprint, getDef: (id:string)=>PartDefinition): VehicleAnalysisReport`
(derive connections internally via structural.deriveConnections when needed).

MANDATORY: use `placedCellMasses` from src/core/mass.ts for ALL mass positioning (shared rule with the runtime assembler — do not reimplement). For face-mounted armour (def.cells.length===0) pass the covered face's world vector as faceMountOffset (covered face = rotateFace(orient, def.sockets[0].face)).

Computations (all in vehicle-local metres via mass.ts / CELL_SIZE):
- totalMassKg, centreOfMass (mass-weighted mean of cell masses), totalCost, fuelCapacityL (sums).
- Wheel contact estimates: for each wheel part (def.wheel): anchor = cellCentreM(pos); suspDirWorld = rotateVec(orient, wheel.suspensionDir); contact point = anchor + suspDirWorld*(suspension.restLength + radius). grounded = (suspDirWorld.y === -1) AND contact.y <= (lowest contact y among down-pointing wheels) + 0.06. Wheels with suspDirWorld.y !== -1 are never grounded.
- Static wheel loads: axle grouping by contact z (tolerance 1e-6). Axle load fraction ∝ max(0, 1 - |z_axle - comZ| / max(wheelbase, 0.1)), normalized to sum 1 over grounded axles; within an axle, split left/right by CoM x lever between the outermost wheels (single wheel gets all). load N = fraction * totalMass * 9.81. Document this as an approximation in a comment.
- frontMassFraction = clamp((comZ - rearmostContactZ) / (frontmostContactZ - rearmostContactZ), 0, 1); 0.5 when <2 axles. leftMassFraction analogous on x (left = -x side: leftMassFraction = 1 - clamp((comX - leftmostX)/(rightmostX - leftmostX)) — i.e. fraction of load on the LEFT side; symmetric vehicle = 0.5).
- supportPolygon: 2D convex hull (monotone chain) of grounded contact XZ points.
- stabilityMarginM: hull with >=3 points: min distance from (comX, comZ) to hull edges, NEGATIVE if outside (point-in-polygon). 1-2 points: -0.5. 0 points: -1.
- rolloverRisk via static stability factor ssf = (trackWidth/2) / max(comHeight above lowest contact, 0.05): low >1.1, medium 0.85–1.1, high 0.6–0.85, extreme <0.6 (or no grounded wheels).
- trackWidthM / wheelbaseM: extents of grounded contacts (0 if <2).
- groundClearanceM: (lowest non-wheel cell bottom y in metres) - (lowest grounded contact y); 0 if no grounded wheels.
- powerToWeightKwPerT: Σ engine.maxPowerKw / (mass/1000).
- drivenWheelLoadFraction: Σ grounded driven wheel loads / total weight.
- estimatedMaxSlopeDeg: min of traction limit atan(0.9 * drivenWheelLoadFraction) and torque limit asin(clamp(F/(m*9.81),0,1)) with F = Σ over engines of (peak curve torque * 3.6 * 3.9 * 0.85) / (mean driven wheel radius), in degrees; 0 if no driven wheels or engines.
- warnings: ValidationIssue[] with severity 'warning' (or 'info' where noted), codes exactly: NO_WHEELS, WHEELS_NOT_GROUNDED (list the parts), WHEEL_AXLE_ORIENTATION (wheels whose rotateVec(orient, axleAxis).y !== 0 OR suspDir not -Y — axle vertical/suspension sideways), NO_DRIVEN_WHEELS, NO_STEERING_WHEELS, NARROW_TRACK (track < 1.1 * comHeight*2 AND grounded wheels >= 2)… use: track < 2.2*comHeight, SHORT_WHEELBASE (<0.9 m with >=2 axles), HIGH_COM (ssf < 0.85), COM_OUTSIDE_SUPPORT (stabilityMarginM < 0.05 with grounded wheels), LATERAL_IMBALANCE (leftMassFraction outside 0.38–0.62), LONGITUDINAL_IMBALANCE (frontMassFraction outside 0.25–0.75), SUSPENSION_OVERLOAD (static load > suspension.maxLoad scaled by SUSPENSION_PRESET_MULTIPLIERS[config.suspensionPreset ?? 'standard'].maxLoad, or > wheel maxLoad), LOW_POWER (powerToWeight < 25 kW/t, only if an engine exists), LOW_TRACTION (drivenWheelLoadFraction < 0.25 and driven wheels exist), LOW_CLEARANCE (< 0.12 m), EXPOSED_FUEL (fuel-tank or ammo part with >=1 exposed face: face not adjacent to another part cell and not covered by a face-mounted armour part — severity 'info'), RECOIL_RISK ((Σ weapon recoilImpulse) * comHeight / max(mass*trackWidth, 1) > 0.12 with weapons present). Every warning: human message, partIds, cells, suggestion.
- Helper exports welcome: `convexHull2D`, `pointToPolygonSignedDistance` (exported for editor overlay reuse).

TESTS — unit/analysis.test.ts using the real catalog (src/core/parts.ts): build fixtures with blueprint helpers. Cover: hand-computed total mass + CoM for an asymmetric 3-part rig; 4-wheel symmetric rig → loads equal ±1%, left/front fractions 0.5, hull has 4 vertices, margin > 0; CoM shifted forward (engine at front) → front fraction > 0.5; wheel pointing sideways (orient rotating suspension off -Y) → WHEEL_AXLE_ORIENTATION + not grounded; floating wheel higher than others → WHEELS_NOT_GROUNDED; no driven config → NO_DRIVEN_WHEELS; tall narrow stack (armour tower on 2-wide track) → HIGH_COM or rollover high/extreme; overload: many heavy parts on light preset → SUSPENSION_OVERLOAD; convexHull2D unit tests (square + collinear); stability margin sign (CoM outside hull → negative).

RULES: `npm run typecheck` and `npx vitest run` must pass. No new dependencies. No edits outside your two files. Report exactly: Done / Files changed / Tests run / Assumptions / Issues / Next recommended task.
