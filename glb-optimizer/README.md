# GLB Optimizer

Turns heavy `.glb` models — Meshy/photogrammetry exports in particular — into
runtime-ready game assets. It remeshes the geometry down to a triangle budget,
shrinks and re-encodes the textures, and compresses the buffers.

Companion to `../glb-voxelizer`, which converts models to a blocky pixel style.
This tool instead keeps the original look and makes it cheap to render.

## Requirements

- Node.js 20.19+ (`npm install` in this directory)
- Blender 3.6+ for the remesh stage — optional, see [Two stages](#two-stages)

Blender must be on `PATH`, supplied with `--blender`, or set in the `BLENDER`
environment variable.

## Usage

```sh
cd glb-optimizer
npm install
node optimize.mjs model.glb
```

The default output is `model.opt.glb` beside the input.

```sh
node optimize.mjs model.glb -o build/hero.glb --budget 20000
node optimize.mjs models/*.glb --output-dir build/opt
```

Run `node optimize.mjs --help` for the full flag list.

## Two stages

**Stage 1 — remesh (Blender).** Merges duplicate vertices, dissolves coplanar
faces into n-gons, re-triangulates, then quadric-collapses down to `--budget`
if anything is left over. Planar dissolve is delimited by UV, seam, sharp, and
material borders, so texture islands stay intact.

**Stage 2 — optimize (glTF-Transform).** Dedupes and joins meshes, welds
vertices, prunes unused data, resizes/re-encodes textures, and applies buffer
compression.

Without Blender the tool still runs: stage 1 is skipped and stage 2 uses
meshoptimizer simplification to hit the budget instead. `--simplify` forces
that path explicitly. It is faster, but Blender's planar dissolve removes
redundant geometry with no shape loss, so it gives better results per triangle
on hard-surface and voxel models.

## Results on a Meshy character

`Meshy_AI_Voxel_Necromancer_0727154733_texture.glb`, defaults, ~4 seconds:

| Metric | Before | After | |
| --- | --- | --- | --- |
| Triangles | 270,158 | 39,999 | -85.2% |
| Vertices | 145,480 | 25,017 | -82.8% |
| Textures | 8.49 MB | 0.40 MB | -95.3% |
| File size | 18.24 MB | 0.67 MB | -96.3% |

On already-voxelized input the planar pass alone is near-lossless: a 31,264
triangle voxel model drops to 6,608 triangles with no visible change, because
voxel meshes tessellate large flat faces into many redundant triangles.

## Triangle budget

`--budget` (default 40000) is the target triangle count. 0 disables the
collapse pass, leaving only the near-lossless planar cleanup.

| Budget | Typical use |
| --- | --- |
| 5,000 | Background props, crowds, distant LODs |
| 20,000 | Standard game props |
| 40,000 | Hero characters (default) |
| 0 | Cleanup only, no lossy reduction |

## Texture handling

Textures usually dominate file size, and `--texture-size` (default 1024) is the
biggest single lever. Normal maps are re-encoded in a separate pass at
`--normal-quality` (default 95) because they carry directional data and band
badly under the quality used for color maps (`--texture-quality`, default 82).

`--drop` removes whole map types for a further win where the art does not need
them:

```sh
node optimize.mjs model.glb --drop normal,mr --texture-size 512
```

Accepts `normal`, `mr`, `emissive`, `occlusion`.

## Compression

`--compress` defaults to `meshopt` (`EXT_meshopt_compression`). Both meshopt and
`draco` need a matching decoder registered at runtime. In three.js:

```js
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
loader.setMeshoptDecoder(MeshoptDecoder);
```

Use `--compress quantize` for smaller buffers with no decoder dependency, or
`--compress none` to keep the output plainly readable.

Output also uses `EXT_texture_webp`, which three.js reads natively.

## Limitations

- The remesh stage does not preserve animations or morph targets. Models with
  animations or skins skip it automatically and fall back to simplification,
  which does preserve them.
- Tangents are dropped; three.js derives them from normals and UVs. Pass
  geometry through `computeTangents()` if a shader needs them explicitly.
- `--remesh voxel` discards UVs entirely. It is meant for collision proxies and
  distant LODs, not for textured hero assets.
- Very thin or non-manifold geometry can degrade under aggressive budgets.
  Raise `--budget` or use `--remesh planar` to stay near-lossless.
