# glb-pipeline

Turns a heavy textured GLB into a blocky pixel-art game asset, in one command.

```sh
npm install
node pipeline.mjs model.glb -o hero.glb
```

**Full guide: [`docs/glb-pipeline.md`](../docs/glb-pipeline.md).**
Run `node pipeline.mjs --help` for the flag list.

| File | Role |
| --- | --- |
| `pipeline.mjs` | The one command — runs all three stages |
| `optimize.mjs` / `blender_remesh.py` | Stage 1: decimate + shrink textures. Stage 3: compress |
| `voxelize.py` / `blender_voxelize.py` | Stage 2: block remesh, one flat colour per voxel |

Each stage also runs standalone (`node optimize.mjs …`, `python3 voxelize.py …`)
if you need one without the other.

Voxelizing comes **last** on purpose — running the optimizer over voxel geometry
smears neighbouring cubes into colour gradients. See
[Why voxelize last](../docs/glb-pipeline.md#why-voxelize-last).
