# glb-rigger

Splits a static GLB into rigid body-part chunks on an animatable node hierarchy,
so a character can be animated in code without skinning. No Blender needed.

```sh
npm install
node rig.mjs model.glb --config model.rig.json
```

**Full guide: [`docs/glb-rigging.md`](../docs/glb-rigging.md)** — rig config
format, tuning, rotation convention, and how to verify a rig.
Run `node rig.mjs --help` for the flag list.

Run [`glb-pipeline`](../docs/glb-pipeline.md) *before* rigging, never after.
