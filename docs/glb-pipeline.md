# GLB Pipeline

Turns a heavy, textured `.glb` — a Meshy or photogrammetry export in particular
— into a blocky, runtime-ready game asset. **One command, two stages.**

```sh
cd glb-pipeline && npm install
node pipeline.mjs model.glb -o hero.glb
```

That voxelizes the model, then optimizes it. The default output is
`model.pipeline.glb` beside the input.

| Stage | Tool | Does | Blender |
| --- | --- | --- | --- |
| 1. Voxelize | `voxelize.py` → `blender_voxelize.py` | Block-remeshes onto a voxel grid, baking texture colour into `COLOR_0` | required |
| 2. Optimize | `optimize.mjs` → `blender_remesh.py` | Dissolves redundant faces, collapses to a triangle budget, compresses | optional |

Rigging and animation are a separate tool — see [glb-rigging.md](glb-rigging.md).

## Requirements

- Node.js 20.19+ (`npm install` in `glb-pipeline/`)
- Python 3.9+
- Blender 3.6+ on `PATH`, in `$BLENDER`, or passed via `--blender`

Stage 2 runs without Blender (it falls back to meshoptimizer simplification),
but stage 1 requires it.

## Worked example

The real numbers, from the raw Meshy export in `saved/models/`:

```sh
cd glb-pipeline
node pipeline.mjs ../saved/models/gunslinger-source.glb \
  -o ../zombie-motorworks/public/assets/zombies/gunslinger.glb \
  --depth 7 --budget 6000 --keep-largest
```

| | Triangles | File size |
| --- | --- | --- |
| Source | 12,436 | 24.33 MB |
| After stage 1 (voxelize) | 11,624 | 0.85 MB |
| After stage 2 (optimize) | 4,262 | 0.06 MB |

Almost all of that 24 MB was texture. Stage 1 replaces it with `COLOR_0` vertex
colours, which is where the 96% size drop comes from — the triangle count barely
moves, because this source was already fairly low-poly.

Stage 2 is close to lossless on voxel input: voxel meshes tessellate large flat
faces into many redundant triangles, so the planar dissolve alone removed 63% of
them and never reached the collapse budget.

A heavier source shows stage 1 doing real geometric work — the 270,158-triangle
necromancer export voxelizes to 31,264 at `--depth 7`, then optimizes to the
full `--budget 6000` (2.29 MB → 0.09 MB).

## Flags

Run `node pipeline.mjs --help` for the full list. The ones that matter:

### `--depth` — voxel resolution (default 6)

Blender's Blocks Remesh octree depth. Each step up creates substantially more
geometry.

| Depth | Result | Typical use |
| --- | --- | --- |
| 4 | Large blocks, very low detail | Props, strong pixel style |
| 5 | Medium blocks | Good default for props |
| 6 | Small blocks | Characters (pipeline default) |
| 7 | Fine blocks, heavier mesh | Close-up and hero assets |

### `--budget` — triangle target (default 6000)

`0` disables the collapse pass, leaving only the near-lossless planar cleanup.

| Budget | Typical use |
| --- | --- |
| 5,000 | Background props, crowds, distant LODs |
| 20,000 | Standard game props |
| 40,000 | Hero characters |
| 0 | Cleanup only, no lossy reduction |

### Skipping a stage

```sh
node pipeline.mjs already-voxel.glb --skip-voxelize   # optimize only
node pipeline.mjs model.glb --skip-optimize           # voxelize only
```

**Skip stage 1 if the source is already voxel art.** Re-voxelizing resamples it
onto a second, coarser grid. On the Necromancer at `--depth 6` the tome vanished
entirely and the navy pinstripe suit washed out to flat grey, because the colour
projector averages the texture across each voxel face. Depth 7 held the
proportions but still lost the tome.

### Other

- `--keep-largest` — drop small disconnected pieces while remeshing. Also drops
  floating props, so check the result.
- `--color-samples 1|5` (default 5) — texture samples per voxel face. 5 samples
  the centre and four inset corners and averages them, which is stable near
  texture boundaries; 1 is faster and gives a harder pixel look.
- `--keep-intermediate` — keep the stage 1 `.voxel.glb` next to the output for
  inspection.
- `--dry-run` — print the plan without running anything.

Anything after a lone `--` is forwarded verbatim to stage 2:

```sh
node pipeline.mjs hero.glb --depth 7 -- --compress draco --texture-size 512
```

## Colour, textures, and compression

Stage 1 output has **no texture and no UVs**. Colour is baked into `COLOR_0`
vertex colours; the tool emits one material with a `VoxelColor` face-corner
colour attribute, so no atlas or external image is needed. Stage 2 detects the
missing UVs and prunes the now-dead texture slots rather than re-encoding images
that could only ever sample (0,0).

This matters downstream: anything consuming the output must read `COLOR_0`, or
the model renders flat grey.

When you skip stage 1 and keep the textured look, stage 2's texture flags apply
instead — `--texture-size` (default 1024) is the biggest single lever, and
normal maps get their own higher-quality pass because they band badly under the
quality used for colour maps. `--drop normal,mr` removes whole map types.

Buffer compression defaults to `meshopt` (`EXT_meshopt_compression`), which
needs a decoder registered at runtime. In three.js:

```js
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
loader.setMeshoptDecoder(MeshoptDecoder);
```

Use `--compress quantize` for smaller buffers with no decoder dependency, or
`--compress none` to keep the output plainly readable.

**Always optimize before rigging, never after.** `meshopt` and `quantize` write
dequantization transforms onto glTF nodes, which would fight animated bone
transforms. The rigger writes uncompressed output by design.

## Limitations

- Output is a single static mesh. Armatures, morph targets, and animations are
  not retained through stage 1. Stage 2 skips its Blender remesh automatically
  on models with animations or skins and falls back to simplification, which
  does preserve them.
- The source should be closed or mostly closed. Very thin, open, or non-manifold
  surfaces may disappear — raise `--depth` or repair the source.
- All input meshes are joined before remeshing so they share one voxel grid.
- Procedural Blender-only shaders cannot be evaluated exactly. Standard glTF PBR
  materials and textures are supported.
- Tangents are dropped; three.js derives them from normals and UVs.

## Checks

```sh
cd glb-pipeline && npm test        # 11 node + 6 python
```

Per the repo `AGENTS.md`: do not run Playwright/browser tests. Hand visual
verification back to the owner with a short "open this, press that" list.
