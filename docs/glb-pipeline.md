# GLB Pipeline

Turns a heavy, textured `.glb` — a Meshy or photogrammetry export in particular
— into a blocky, pixel-art game asset. **One command, three stages.**

```sh
cd glb-pipeline && npm install
node pipeline.mjs model.glb -o hero.glb
```

The default output is `model.pipeline.glb` beside the input.

| Stage | Tool | Does | Blender |
| --- | --- | --- | --- |
| 1. Optimize | `optimize.mjs` → `blender_remesh.py` | Decimates the textured source to a budget, shrinks textures | optional |
| 2. Voxelize | `voxelize.py` → `blender_voxelize.py` | Block-remeshes onto a voxel grid, one flat colour per voxel | required |
| 3. Compress | `optimize.mjs --no-remesh` | Buffer compression only, geometry untouched | no |

Rigging and animation are a separate tool — see [glb-rigging.md](glb-rigging.md).

## Why voxelize last

**The order matters, and getting it backwards silently ruins the art.**

The optimizer's planar dissolve merges coplanar faces into n-gons and
re-triangulates. It is delimited by UV, seam, sharp, and material borders — but
voxelizer output has *no UVs and a single material*, so nothing delimits it. It
happily welds neighbouring cubes of different colours together and interpolates
their vertex colours into gradients. Run that way, a crisp voxel model comes out
smoothed and smeared, and the `--budget` collapse pass on top of it rounds the
cubes off entirely.

Voxelizing last makes the blocky output the final geometry. Stage 3 is
compression only (`--no-remesh`), which is why it reports a 0.0% triangle
change: it re-encodes buffers and touches nothing else.

Verified on the gunslinger: every voxel in the final file carries exactly one
flat colour (0 of 5,771 voxels have more than one).

## Requirements

- Node.js 20.19+ (`npm install` in `glb-pipeline/`)
- Python 3.9+
- Blender 3.6+ on `PATH`, in `$BLENDER`, or passed via `--blender`

Stage 1 runs without Blender (falling back to meshoptimizer simplification), but
stage 2 requires it.

## Worked example

```sh
cd glb-pipeline
node pipeline.mjs ../saved/models/gunslinger-source.glb \
  -o ../zombie-motorworks/public/assets/zombies/gunslinger.glb \
  --depth 7 --keep-largest
```

Measured, ~4 seconds end to end:

| | Triangles | File size |
| --- | --- | --- |
| Source | 12,436 | 23.20 MB |
| After stage 1 (optimize) | 11,201 | 0.72 MB |
| After stage 2 (voxelize) | 19,752 | 1.44 MB |
| After stage 3 (compress) | 19,752 | 0.23 MB |

Almost all of that 23 MB was texture — stage 1 alone cuts 97% by shrinking and
re-encoding it. Triangles *rise* at stage 2 because the depth-7 grid resolves
more cubes than the decimated source had faces; the final count is set by
`--depth`, not by `--budget`.

## Flags

Run `node pipeline.mjs --help` for the full list. The ones that matter:

### `--depth` — voxel resolution (default 6)

Blender's Blocks Remesh octree depth, and the main quality knob. Each step up
creates substantially more geometry.

| Depth | Result | Typical use |
| --- | --- | --- |
| 4 | Large blocks, very low detail | Props, strong pixel style |
| 5 | Medium blocks | Good default for props |
| 6 | Small blocks | Characters (pipeline default) |
| 7 | Fine blocks, heavier mesh | Close-up and hero assets |

### `--keep-largest` and `--min-part` (default 0.05)

`--keep-largest` removes disconnected pieces. `--min-part` is the smallest piece
it will keep, as a ratio of the largest.

**Do not set `--min-part 1.0`.** That keeps *only* the single largest component,
which amputates any body part the voxel grid left disconnected. The gunslinger
has a severed midsection, so its legs are a separate component — at 1.0 the
pipeline silently deleted the torso and both legs (9,896 → 5,812 faces). At the
0.05 default the same model keeps its whole body and drops only 24 speck faces.

### Colour

Every voxel gets **one flat colour** across all six faces, which is what gives
the pixel-art look. Colours are chosen by taking the *modal* sample rather than
the mean — averaging is what washes voxel art out, since a cube straddling a
skin/blood boundary averages to pink mud.

`--per-face-color` restores the old behaviour, colouring each cube face
independently. Softer and better lit, but no longer pixel art.

`--color-samples 1|5` (default 5) sets texture samples per face. 5 samples the
centre and four inset corners, which is stable near texture boundaries; 1 is
faster and harder-edged.

### `--budget` — stage 1 triangle target (default 40000)

Applies to the **textured source**, before voxelizing. It does not set the final
triangle count. `0` disables the collapse pass, leaving only the near-lossless
planar cleanup.

### Skipping stages

```sh
node pipeline.mjs model.glb --skip-voxelize    # keep the textured look
node pipeline.mjs model.glb --skip-optimize    # voxelize the source as-is
node pipeline.mjs model.glb --skip-compress    # leave output uncompressed
```

**Skip stage 2 if the source is already voxel art.** Re-voxelizing resamples it
onto a second, coarser grid. On the Necromancer at `--depth 6` the tome vanished
entirely and the navy pinstripe suit washed out to flat grey.

Note that `--skip-voxelize` puts you back on the path described in
[Why voxelize last](#why-voxelize-last): the optimizer will dissolve across
colour boundaries. That is harmless on textured models, which is the only case
`--skip-voxelize` is meant for.

### Other

- `--keep-intermediate` — keep each stage's GLB next to the output.
- `--dry-run` — print the plan without running anything.

Anything after a lone `--` is forwarded verbatim to the stage 1 optimizer:

```sh
node pipeline.mjs hero.glb --depth 7 -- --texture-size 2048 --drop normal
```

## Colour and compression

Stage 2 output has **no texture and no UVs**. Colour is baked into `COLOR_0`
vertex colours, emitted as one material with a `VoxelColor` face-corner
attribute, so no atlas or external image is needed.

This matters downstream: anything consuming the output must read `COLOR_0`, or
the model renders flat grey.

Buffer compression is `meshopt` (`EXT_meshopt_compression`), which needs a
decoder registered at runtime. In three.js:

```js
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
loader.setMeshoptDecoder(MeshoptDecoder);
```

**Always run this pipeline before rigging, never after.** `meshopt` writes
dequantization transforms onto glTF nodes, which would fight animated bone
transforms. The rigger writes uncompressed output by design — so if you intend
to rig, pass `--skip-compress`.

## Verifying the output

Do not judge voxel colour from a lit Blender render — `glb-rigger/verify/render_ortho.py`
blows the palette out to near-white and made a correctly-coloured model look
broken. Read `COLOR_0` directly, or rasterize it unlit, before concluding
anything about colour.

## Limitations

- Output is a single static mesh. Armatures, morph targets, and animations are
  not retained through stage 2.
- The source should be closed or mostly closed. Very thin, open, or non-manifold
  surfaces may disappear — raise `--depth` or repair the source.
- All input meshes are joined before remeshing so they share one voxel grid.
- Procedural Blender-only shaders cannot be evaluated exactly. Standard glTF PBR
  materials and textures are supported.

## Checks

```sh
cd glb-pipeline && npm test        # 11 node + 6 python
```

Per the repo `AGENTS.md`: do not run Playwright/browser tests. Hand visual
verification back to the owner with a short "open this, press that" list.
