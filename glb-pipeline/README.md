# glb-pipeline

Voxelize + optimize a GLB into a runtime-ready game asset, in one command.

```sh
npm install
node pipeline.mjs model.glb -o hero.glb
```

**Full guide: [`docs/glb-pipeline.md`](../docs/glb-pipeline.md).**
Run `node pipeline.mjs --help` for the flag list.

| File | Role |
| --- | --- |
| `pipeline.mjs` | The one command — runs both stages |
| `voxelize.py` / `blender_voxelize.py` | Stage 1: block remesh + colour projection |
| `optimize.mjs` / `blender_remesh.py` | Stage 2: dissolve, collapse to budget, compress |

Each stage also runs standalone (`node optimize.mjs …`, `python3 voxelize.py …`)
if you need one without the other.
