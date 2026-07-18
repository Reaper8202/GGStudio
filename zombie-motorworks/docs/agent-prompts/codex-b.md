You are Codex Agent B on the Scrap Rig project (3D modular vehicle builder, web, strict TypeScript).

READ FIRST (contracts — use verbatim, MUST NOT edit):
- src/core/types.ts
- src/core/grid.ts
- docs/vehicle_editor/DATA_MODEL.md
- docs/vehicle_editor/ARCHITECTURE.md

YOU OWN EXCLUSIVELY (create these; touch nothing else):
- src/core/structural.ts
- src/core/placement.ts
- unit/structural.test.ts
- unit/placement.test.ts

IMPORTANT: another agent is writing src/core/parts.ts (catalog) CONCURRENTLY. Do NOT import it. Your tests must define local fixture PartDefinitions inside the test files (a root cube, plain frame cube, a wheel-mount cube with 'wheel-mount' sockets on px/nx, a wheel with a 'wheel-mount' socket on px + clearanceCells [(0,-1,0)] and requiresMount 'wheel-mount', a face-mounted armour def with cells: [] and one 'armour' socket on pz, a unique part, a multi-cell beam). Your library code takes the catalog as a parameter: every function accepts `getDef: (defId: string) => PartDefinition`.

TASK 1 — src/core/structural.ts:
- `export const SOCKET_COMPAT: readonly [SocketType, SocketType][]` = [['frame','frame'], ['frame','armour'], ['wheel-mount','wheel-mount'], ['engine-mount','engine-mount'], ['hardpoint','hardpoint']] and `socketsCompatible(a,b)` (unordered).
- `export const CONNECTION_STRENGTH: Record<string, {maxForce:number; maxTorque:number}>` keyed 'frame-frame' etc: frame-frame 30000/8000, frame-armour 9000/2000, wheel-mount-wheel-mount 24000/6000, engine-mount-engine-mount 26000/7000, hardpoint-hardpoint 20000/5000.
- `deriveConnections(bp: VehicleBlueprint, getDef): StructuralConnection[]` — for each placed part, each socket: world cell = pos + rotateVec(orient, socket.cell); world face = rotateFace(orient, socket.face). Connection when part A's socket at cell c/face f meets part B's socket at cell c + faceVector(f) with face oppositeFace(f) and compatible type, deduped (one connection per socket pair; order aId<bId). For face-mounted armour (empty cells), its socket world cell is its pos and it connects OUTWARD-to-INWARD: armour socket face F means the armour covers host face F: the HOST is the part occupying pos itself with a compatible ('frame') socket on face F. Handle that special case: armour connects to the part whose footprint contains pos... WAIT no: armour pos IS the host cell; the armour connects to the host part occupying pos via the host's socket on face = rotateFace(orient, 'pz'-declared face). Implement exactly that: for armour parts (def.cells.length===0), connect to occupant of pos if it has a compatible socket on that face.
- Strength: base from CONNECTION_STRENGTH × min(reinforcement of both defs). health 1.
- `buildAdjacency(connections): Map<string, StructuralConnection[]>` by part id.
- `reachableFromRoot(bp, connections, getDef): Set<string>` — BFS from the placed part whose def isRoot (empty set if none).
- `computeIslands(partIds: string[], connections): string[][]` — connected components via union-find (parts with no connections are singleton islands).
- `disconnectedParts(bp, connections, getDef): string[]` — placed parts not reachable from root.

TASK 2 — src/core/placement.ts: centralized validation. All results are `PlacementResult { ok, issues: ValidationIssue[] }` with stable machine codes, human messages, affected cells/partIds, and a `suggestion` where obvious.
- `canPlacePart(bp, getDef, defId, pos, orient, config?): PlacementResult` validating IN ORDER (collect ALL issues, ok = no 'error' severity): ORIENTATION_NOT_ALLOWED (def.allowedOrientations), OUT_OF_BOUNDS (any world cell; for empty-cells armour check pos in bounds), OVERLAP (occupancy from buildOccupancy-like scan — implement locally, do not import blueprint.ts (concurrent agent owns it): build cellKey→partId from bp parts via getDef+worldCells), UNIQUE_VIOLATION, ROOT_DUPLICATE (isRoot when a root exists), ARMOUR_NO_HOST (armour pos cell empty), ARMOUR_FACE_OCCUPIED (another armour already on that host face), ARMOUR_FACE_BLOCKED (a solid part occupies the cell the armour faces outward into — the cell at pos+faceVector(worldFace)) as WARNING severity, CLEARANCE_BLOCKED (this part's world clearance cells occupied by parts — error), CLEARANCE_VIOLATION (this part's cells sit inside an existing part's clearance volume — error), NO_CONNECTION (part would form zero structural connections via deriveConnections logic on the hypothetical blueprint — error; exception: def.isRoot on an empty blueprint is fine), MISSING_MOUNT (def.requiresMount set but none of the part's formed connections uses a socket pair of that type — error).
- `canRemovePart(bp, getDef, partId): PlacementResult` — error REMOVE_ROOT if isRoot; otherwise ok (orphaning others is allowed; validateBlueprint reports it).
- `validateBlueprint(bp, getDef): ValidationReport` — HARD ERRORS only (warnings belong to the analyzer, not here): INVALID_DEF (unknown defId), OUT_OF_BOUNDS, OVERLAP, NO_ROOT, NO_CONTROL (no def.providesControl part), NO_PROPULSION (no def.engine part), NO_WHEELS-as-error NO (that's a warning — do NOT include), DISCONNECTED (parts unreachable from root — list them), MISSING_MOUNT (any placed part whose requiresMount is unsatisfied). Return {errors, warnings: [], infos: []} (warnings/infos are populated by the analyzer module, not here).

TASK 3 — tests: unit/structural.test.ts — two adjacent frame cubes connect (1 connection, correct strength incl. reinforcement min), rotated multi-cell beam connects through the correct touching cell, incompatible faces don't connect, armour connects to its host, islands: removing the middle connection of a 3-chain yields [root-side..][far side], singleton islands, reachableFromRoot excludes floating part. unit/placement.test.ts — every code above gets at least one positive and one negative test, including: wheel placed against wheel-mount px socket OK; wheel floating in air = NO_CONNECTION; wheel on plain frame face = MISSING_MOUNT; wheel whose clearance cell (below) is occupied = CLEARANCE_BLOCKED; placing a frame INTO an existing wheel's clearance cell = CLEARANCE_VIOLATION; armour on empty cell = ARMOUR_NO_HOST; two armour on same face = ARMOUR_FACE_OCCUPIED; duplicate unique part; second root; out of bounds; overlap; validateBlueprint catches NO_ROOT / NO_CONTROL / NO_PROPULSION / DISCONNECTED.

RULES: strict tsconfig must pass (`npm run typecheck` scoped to repo), `npx vitest run unit/structural.test.ts unit/placement.test.ts` must pass. No new dependencies. No edits outside your four files. Do not run playwright. Report exactly: Done / Files changed / Tests run / Assumptions / Issues / Next recommended task.
