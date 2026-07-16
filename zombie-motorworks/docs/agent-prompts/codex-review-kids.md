You are a senior game designer + engineer reviewing Scrap Rig (3D vehicle builder, Three.js + Rapier, strict TS) at the repo root. REVIEW ONLY — write your findings to docs/agent-reports/kids-simplification-review.md and change NOTHING else.

PLAYER FEEDBACK (verbatim from the owner, target audience is kids 12+):
- "the kids version should be the whole thing i don't want the editor to be complicated at all. So eliminate any complicated building mechanics."
- "it is very hard to edit the car, i cant place blocks on top of each other, i also can't delete blocks."
- "The physics is also off, when i test the default car and drive it off a ramp it breaks, which should not happen. The physics really only applies if the car is constructed wrong, but the tutorial car should be fully functional."
- "this editor should be about as simple as the bad piggies editing screen but in 3 dimensions instead. The materials and customization should be very intuitive to any kid 12+."

READ: src/core/parts.ts, src/core/placement.ts, src/core/structural.ts, src/core/tutorial.ts, src/editor/EditorMode.ts (esp. updateGhost/selectAt/onPointerUp), src/editor/ui.ts, src/editor/meshes.ts, src/runtime/damage.ts, src/runtime/assembler.ts (connection strengths come from structural.ts CONNECTION_STRENGTH; contact thresholds in assembler colliders), src/chamber/ChamberMode.ts, docs/vehicle_editor/EDITOR_UX.md.

ORCHESTRATOR'S BUG HYPOTHESES (verify against code, confirm or correct, cite file:line):
1. Stacking bug: EditorMode.updateGhost raycasts partsGroup recursively; part meshes contain edge LineSegments; THREE.Raycaster params.Line.threshold defaults to 1.0 so edge lines intercept rays without a face -> ghost falls back to the ground plane. Fix candidates: raycaster.params.Line.threshold = 0, or filter intersections to Mesh-with-face.
2. Delete bug: with a ghost armed every left click places; kids never find Esc -> select -> Del. Fix candidates: right-click deletes part under cursor at all times; an Eraser palette tool; keep Del.

PRODUCE A SPEC with these sections (be concrete — exact numbers, exact part ids, exact UI elements; this spec goes straight to two implementation agents):
A. PART CATALOG: which parts to remove from the game entirely and which to keep, so mount mechanics disappear (proposal to evaluate: wheels/engines/turrets connect to ANY block face via the ordinary frame socket pairing — delete wheel-mount/engine-mount/hardpoint parts and the requiresMount rules; keep clearance rules; is anything lost that matters for the physics-failure fantasy? Bad Piggies attaches wheels directly to boxes). Recommend the final palette list (~8 parts) with the existing kid names.
B. EDITOR UI: exactly which top-bar/bottom-bar/inspector elements to remove or merge for a Bad-Piggies-grade screen (keep: save/load/new, undo/redo, symmetry?, view keys, layer slider, TEST DRIVE, tutorial, help; evaluate removing: palette mode toggle [must go — single simple mode only], X-ray/Structure/Hide armour/Hide shell buttons, Links/Arcs overlay toggles, ortho view buttons?, the 14-row analysis panel -> propose a kid version [e.g. Weight, Stability emoji, top 1-2 tips], wheel config checkboxes [wheels should always auto-configure: all driven+brakes, front half steer]).
C. EDITING FEEL: confirm the two bug fixes; plus any other friction you find in the pointer/keyboard flow (e.g. should placing continue after each click? should selecting a placed part show a floating mini-toolbar rotate/delete instead of the side inspector?).
D. PHYSICS ROBUSTNESS: exact retune so a correctly-built car NEVER breaks from ramps/jumps/drops but still breaks when rammed into walls at high speed or built badly. Current numbers: damage.ts IMPACT_DAMAGE_SCALE=1/900 hp per N, CONNECTION_DAMAGE_SCALE=1/55000 with x30000/maxForce factor; assembler contactForceEventThreshold=2500 N; structural.ts CONNECTION_STRENGTH frame-frame 30000/8000 etc; part healths in parts.ts. Estimate landing forces for the ~700 kg starter (drop scenario ~3 m) vs a 60 km/h wall hit, and give concrete new constants (threshold, scales, strengths) with the reasoning. Also check: does resolveStructure kill parts too eagerly at current health values?
E. TUTORIAL: new step list after mounts are gone (should shrink to ~5-6 steps).
F. RISKS: what existing tests break (unit + playwright reference wheel-mount/engine-mount/hardpoint layouts extensively — list the files needing updates).

Keep it under ~150 lines, prioritized, no fluff. Then: Done / Files changed / Assumptions / Issues.
