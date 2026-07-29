# GLB Character Pipeline

Raw AI-generated GLB → voxelized → optimized → rigged → animated.

Three tools, each a standalone CLI, each with its own `README.md` and tests:

| Tool | Does | Needs Blender |
| --- | --- | --- |
| `glb-voxelizer/` | Block-remeshes a textured GLB into voxel style | yes |
| `glb-optimizer/` | Remeshes + compresses down to a triangle budget | optional |
| `glb-rigger/` | Splits into rigid parts on an animatable node hierarchy | no |

Animation lives in `zombie-motorworks/src/tools/necromancerPose.ts` (pure math)
and is previewed by `zombie-motorworks/necromancer.html`.

## Setup

```sh
cd glb-optimizer && npm install
cd ../glb-rigger  && npm install
```

Blender 3.6+ must be on `PATH`, in `$BLENDER`, or passed via `--blender`.
`glb-voxelizer` is plain Python and needs no install.

## The pipeline

Worked example, from the raw Meshy export to a rigged, animated asset. Paths are
the real ones used for the Necromancer.

### 1. Voxelize (optional — only for the blocky look)

```sh
cd glb-voxelizer
python3 voxelize.py ../zombie-motorworks/scripts/meshy_ai/Meshy_AI_Voxel_Necromancer_0727154733_texture.glb \
  -o ../zombie-motorworks/scripts/meshy_ai/necromancer.voxel7.glb \
  --depth 7 --keep-largest
```

**Skip this step if the source is already voxel art.** The Necromancer already
was, so re-voxelizing resamples it onto a second, coarser grid: at `--depth 6`
the tome vanished entirely and the navy pinstripe suit washed out to flat grey,
because the colour projector averages the texture across each voxel face.
Depth 7 holds proportions but still loses the tome and the floating magic
(`--keep-largest` drops the disconnected bits).

Voxelizer output has **no texture**. Colour is baked into `COLOR_0` vertex
colours and UVs are discarded. This matters downstream.

### 2. Optimize

```sh
cd glb-optimizer
node optimize.mjs INPUT.glb -o OUTPUT.glb --budget 6000
```

Real numbers for both branches:

| Input | Tris | Size | After | Size |
| --- | --- | --- | --- | --- |
| Raw Meshy export | 270,158 | 18.24 MB | 5,999 | 0.46 MB |
| `necromancer.voxel7.glb` | 31,264 | 2.29 MB | 6,608 | 0.08 MB |

On already-voxelized input the planar dissolve alone is near-lossless — 31,264
to 6,608 with no visible change, because voxel meshes tessellate large flat
faces into many redundant triangles. It never even reached the budget.

`COLOR_0` survives this step, so the voxel branch keeps its colour.

**Always optimize before rigging, never after.** `meshopt` and `quantize` write
dequantization transforms onto glTF nodes, which would fight the animated bone
transforms. The rigger therefore writes uncompressed output by design.

### 3. Rig

```sh
cd glb-rigger
node rig.mjs INPUT.glb -c necromancer.rig.json -o OUTPUT.rigged.glb --list
```

```sh
# textured branch
node rig.mjs ../zombie-motorworks/scripts/meshy_ai/necromancer.6k.glb \
  -c necromancer.rig.json \
  -o ../zombie-motorworks/public/assets/zombies/necromancer.rigged.glb

# voxel branch — different config, see below
node rig.mjs ../zombie-motorworks/scripts/meshy_ai/necromancer.voxel7.opt.glb \
  -c necromancer-voxel.rig.json \
  -o ../zombie-motorworks/public/assets/zombies/necromancer-voxel.rigged.glb
```

**The two rig configs are not interchangeable.** The depth-7 voxel model is 1.90
tall instead of 2.00, narrower, and missing the tome — reusing the textured
joint positions on it misplaces every limb.

### 4. Animate

Bone names are identical across both rigs, so one set of pose curves drives
either. `necromancerPose.ts` exports `walkPose(t)` and `castPose(progress)`,
returning per-bone Euler angles plus a `rootLift`.

```sh
cd zombie-motorworks && npm run dev   # open /necromancer.html
```

Preview supports `?model=voxel&clip=cast&speed=0.5`, plus a "color parts" toggle
that swaps in flat per-part colours to inspect segmentation live.

## Rotation convention

**Verified numerically, not by eye — an eyeball reading of this got it backwards
once.** The model faces **+Z**, so:

- **Negative** rotation about a bone's local X swings it **forward**.
- Positive swings it **back**.
- The character's right hand is on **-X**.

Blender's glTF importer preserves local transforms on all non-root nodes, so a
Blender local-X rotation equals the glTF one and signs transfer to three.js
unchanged. The root node (`hips`) is the exception — it absorbs the Y-up→Z-up
conversion, so don't reason about its rotation from a Blender render.

To re-derive: rotate a bone in Blender, convert world position back to glTF
(`x=x, y=z, z=-y`), and compare against `Rx(θ)` applied to the child's local
offset. They matched exactly.

## Tuning the rig config

Each joint is a segment `pos -> tip`; triangles go to the nearest segment, with
distance divided by `radius`. Bigger radius = greedier.

Lessons that cost iterations:

- **The torso must be greedy** (`radius: 1.55`) and its bone must run all the
  way down to the waist. The coat is geometrically nearer the thighs than the
  spine, so a short or slim torso lets `legL_thigh` claim the whole coat — which
  then swings with one leg.
- **Don't over-slim the arms.** Dropping `armX_fore` to 0.78 to move the seam to
  the elbow *introduced* a tear: at the default 0.95 the sleeve is a single part
  whose only seam is buried in the shoulder, and splitting it opens a seam
  across the visible sleeve. Leave it at 0.95.
- **The head loses to the torso** if the torso bone reaches the jaw. End the
  torso at the collar and give the head `radius: 1.3`, or the head bone owns
  only the hair and rotating it swivels hair off the face.
- **`--snap-max` is size-gated for a reason.** Small shells snap whole to one
  bone so a voxel cluster is never torn in half; large shells must not, because
  a big shell usually spans a joint. Snapping everything collapsed `legR_shin`
  to 41 triangles while `footR` inflated to 136.
- **Overrides are the escape hatch.** The tome hangs nearer the coat than the
  hand carrying it, so distance alone splits it. A box in `overrides` forces it
  onto `armL_fore`, after all other assignment.

## Verifying

Never trust the triangle counts alone — render it. Scripts live in
`glb-rigger/verify/`.

```sh
cd glb-rigger

# Segmentation: each part flat-shaded a distinct colour.
node rig.mjs IN.glb -c CONFIG.json -o /tmp/out.glb --debug-colors /tmp/dbg.glb --list
blender --background --factory-startup --python verify/render_ortho.py -- \
  /tmp/dbg.glb /tmp/dbg.png front 2.2

# Pivots: pose named bones and check nothing detaches or swings wrong.
blender --background --factory-startup --python verify/render_pose.py -- \
  /tmp/out.glb /tmp/pose.png right $(node verify/emit_pose.ts walk 0.22)
```

`render_ortho.py` frames the model so the image spans exactly ±SPAN/2 in model
units centred on the origin — joint coordinates can be read straight off the
pixels. That is how both rig configs were authored. Views are `front`, `back`,
`left`, `right` in glTF space.

Note zsh does **not** word-split a plain `$var`, so inline the
`$(node verify/emit_pose.ts …)` rather than assigning it first.

Expect two or three iterations on joint positions. The debug render is by far
the fastest way to see what the segmentation actually did.

## Known non-issues

- **Fragmented slabs in the coat and shoulders are in the source**, not the rig.
  They come from the optimizer's decimation at `--budget 6000`. Render the
  pre-rig GLB at the same zoom to confirm before chasing it. Raise the budget to
  ~12,000 if it matters.
- **Rigid parts seam at joints.** That is inherent — no vertex blending. Fine
  for voxel and hard-surface art, wrong for organic characters.
- **N parts means N draw calls** (13 here). Good for a boss, expensive for a
  crowd.

## Checks

```sh
cd glb-optimizer && npm test          # 11
cd ../glb-rigger  && npm test          # 24
cd ../zombie-motorworks && npm run lint && npm run test:unit
```

`zombie-motorworks` has pre-existing failures unrelated to this pipeline — 15
tests and 7 typecheck errors about `empLevel`/`piercingLevel` missing from
`PartConfig`. Confirm any failure you see is one of those before chasing it.

Per the repo `AGENTS.md`: do not run Playwright/browser tests. Hand visual
verification back to the owner with a short "open this, press that" list.
