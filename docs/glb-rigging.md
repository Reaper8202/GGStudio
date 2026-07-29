# GLB Rigging & Animation

Splits a static `.glb` into rigid body-part chunks parented into an animatable
node hierarchy, so a character can be animated in code without any skinning.

Runs *after* [the voxelize/optimize pipeline](glb-pipeline.md). Left as its own
tool: no Blender, no Python, just Node.

```sh
cd glb-rigger && npm install
node rig.mjs model.glb --config model.rig.json
```

The default output is `model.rigged.glb` beside the input. Run
`node rig.mjs --help` for the full flag list.

## Why rigid chunks

Conventional skinning wants a T-pose or A-pose bind pose. Models straight out of
Meshy usually are not in one — the Necromancer stands in a casting stance — so
skin weights bake bad shoulder and elbow deformation, and auto-riggers like
Mixamo tend to choke.

Rotating a rigid chunk about its joint works from *any* starting pose, and
hard-edged voxel art hides the absence of vertex blending. It is the same reason
Minecraft-style characters get away with rigid limbs.

## Rig definition

Each joint has a model-space position, a parent, and a `tip`. The bone is the
segment `pos -> tip`; every triangle is assigned to whichever bone segment its
centroid is nearest.

```json
{
  "joints": [
    { "name": "hips",  "parent": null,   "pos": [0.02, 0.02, -0.22], "tip": [0, 0.16, -0.24], "radius": 0.95 },
    { "name": "torso", "parent": "hips", "pos": [0, 0.16, -0.24], "tip": [-0.02, 0.7, -0.15], "radius": 1.55 }
  ]
}
```

`radius` divides the measured distance, so a bigger radius makes a bone greedier
for contested mass. `tip` may be omitted when a joint has exactly one child, in
which case the child's position is used. A joint that branches must state its
own tip.

### Overrides

Some props defeat distance alone. An override box forces every triangle whose
centroid falls inside it onto one bone, after all other assignment:

```json
"overrides": [
  { "bone": "armL_fore", "min": [0.19, -0.16, 0.04], "max": [0.56, 0.36, 0.52] }
]
```

## Tuning a config

Lessons that cost iterations:

- **The torso must be greedy** (`radius: 1.55`) and its bone must run all the way
  down to the waist. The coat is geometrically nearer the thighs than the spine,
  so a short or slim torso lets `legL_thigh` claim the whole coat — which then
  swings with one leg.
- **Don't over-slim the arms.** Dropping `armX_fore` to 0.78 to move the seam to
  the elbow *introduced* a tear: at the default 0.95 the sleeve is a single part
  whose only seam is buried in the shoulder, and splitting it opens a seam across
  the visible sleeve. Leave it at 0.95.
- **The head loses to the torso** if the torso bone reaches the jaw. End the
  torso at the collar and give the head `radius: 1.3`, or the head bone owns only
  the hair and rotating it swivels hair off the face.
- **Overrides are the escape hatch.** The tome hangs nearer the coat than the
  hand carrying it, so distance alone splits it. A box in `overrides` forces it
  onto `armL_fore`.

Rig configs are **not** interchangeable between models. The depth-7 voxel
Necromancer is 1.90 tall rather than 2.00, narrower, and has lost the tome —
reusing the textured joint positions on it misplaces every limb. That is why
`necromancer.rig.json` and `necromancer-voxel.rig.json` both exist. Bone *names*
are identical across them, so one set of pose curves drives either.

## Shell snapping

Voxel meshes arrive as hundreds of disconnected shells — the Necromancer is 292
of them, because UV seams split every voxel cluster. Assigning purely per
triangle can tear a single cluster across two parts.

So shells of `--snap-max` triangles or fewer (default 32) are snapped whole to
whichever bone won the most of their triangles. Larger shells keep per-triangle
assignment, because a big shell usually spans a joint.

**`--snap-max` is size-gated for a reason.** Snapping everything collapsed
`legR_shin` to 41 triangles while `footR` inflated to 136. `--no-snap` disables
it entirely.

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

`--list` prints per-bone triangle counts and warns about bones that got no
geometry, which usually means a joint is buried inside another part. Expect two
or three iterations on joint positions.

## Output

- One glTF node per bone, named after the joint, in the configured hierarchy.
- Geometry stored in joint-local space, with the node carrying the offset from
  its parent joint, so setting `node.rotation` spins the part about its joint.
- All parts share the source material — so it stays one material, though N parts
  do cost N draw calls.
- `POSITION`, `NORMAL`, `TEXCOORD_0`, and `COLOR_0` are all carried through.
  Vertex colours matter for pipeline output, which bakes its colour into
  `COLOR_0` and has no texture at all — drop the attribute and the model comes
  out flat grey. `--debug-colors` deliberately strips `COLOR_0`, because glTF
  multiplies it into the base colour and it would tint the debug palette.
  Values are carried through byte for byte, which includes the colour-space
  defect described in
  [glb-pipeline.md](glb-pipeline.md#color_0-holds-srgb-values-but-gltf-says-it-is-linear):
  a rigged pipeline model still needs its `COLOR_0` decoded from sRGB on load,
  or it renders pale and washed out.
- **Uncompressed**, by design. See the note in [glb-pipeline.md](glb-pipeline.md).

## Animating the result

`zombie-motorworks/src/tools/necromancerPose.ts` and `gunslingerPose.ts` hold
pure `walkPose(t)` / `castPose(progress)` functions returning per-bone Euler
angles plus a `rootLift`. The preview page loads a rigged GLB and drives it:

```sh
cd zombie-motorworks && npm run dev   # then open /necromancer.html
```

The page has buttons for both rigs and both clips, a speed slider, and a "color
parts" toggle that swaps in flat per-part colours so you can inspect the
segmentation live. State deep-links: `?model=voxel&clip=cast&speed=0.5`.

Like `portrait.html`, the preview is a dev-server tool and is not part of the
production build.

## Known non-issues

- **Fragmented slabs in the coat and shoulders are in the source**, not the rig.
  They come from the optimizer's decimation at `--budget 6000`. Render the
  pre-rig GLB at the same zoom to confirm before chasing it. Raise the budget to
  ~12,000 if it matters.
- **Rigid parts seam at joints.** Inherent — no vertex blending. Fine for voxel
  and hard-surface art, wrong for organic characters.
- **N parts means N draw calls** (13 here). Good for a boss, expensive for a
  crowd.

## Limitations

- Input must be a single material. The pipeline joins primitives, so run it
  first.
- Animations and skins on the input are not carried over.

## Checks

```sh
cd glb-rigger && npm test          # 24
```
