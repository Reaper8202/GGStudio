"""Load a rigged GLB, rotate named nodes, and render — pivot verification.

Usage: ... -- MODEL.glb OUT.png VIEW "bone:rx,ry,rz" "bone:rx,ry,rz" ...
Angles are degrees about the node's local axes, matching glTF node rotations.

A glTF (rx, ry, rz) does NOT go straight onto obj.rotation_euler. Two separate
conversions are needed, and both are invisible for a pose that only sets rx —
which is every rig here before the alchemist, and why this went unnoticed.

1. AXES. The importer bakes the Y-up -> Z-up conversion into the hierarchy, so
   a node's local axes are Blender's world axes: local X = glTF X, but local
   Y = glTF -Z and local Z = glTF Y. Confirmed by dumping matrix_local after
   import: armR_upper's offset is glTF (-0.235, 0.41, -0.03) and imports as
   Blender (-0.235, 0.01, 0.41). So glTF ry drives Blender's Z and glTF rz
   drives Blender's Y, negated.

2. ORDER. Three.js — which is what actually plays these poses in game —
   composes its default 'XYZ' Euler as Rx*Ry*Rz, applying Z to the vector
   FIRST. Blender's 'XYZ' is the opposite composition. Applying glTF Z, then
   Y, then X means applying Blender Y, then Z, then X: order 'YZX'.

Together: rotation_mode = 'YZX', rotation_euler = (rx, -rz, ry). Verified by
rendering a single armR_upper rz: it drops the arm to the model's side, where
the unconverted form swung it forward instead.
"""
import sys, math, bpy, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
src, out, view = argv[0], argv[1], argv[2]
poses = argv[3:]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

applied, missing = [], []
for spec in poses:
    name, _, angles = spec.partition(":")
    obj = bpy.data.objects.get(name)
    if obj is None:
        missing.append(name)
        continue
    rx, ry, rz = (math.radians(float(a)) for a in angles.split(","))
    # Compose onto whatever the node already carries from the file. See the
    # module docstring for the axis swap and the 'YZX' order.
    obj.rotation_mode = 'YZX'
    obj.rotation_euler = (
        obj.rotation_euler.x + rx,
        obj.rotation_euler.y - rz,
        obj.rotation_euler.z + ry,
    )
    applied.append(name)

if missing:
    print("POSE_MISSING", ",".join(missing))
print("POSE_APPLIED", ",".join(applied))
print("POSE_NODES", ",".join(sorted(o.name for o in bpy.data.objects)))

VIEWS = {
    "front": ((0, -6, 0), (1.5708, 0, 0)),
    "right": (( 6, 0, 0), (1.5708, 0, 1.5708)),
    "left":  ((-6, 0, 0), (1.5708, 0, -1.5708)),
}
loc, rot = VIEWS[view]

cam_data = bpy.data.cameras.new("Cam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.6
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.collection.objects.link(cam)
cam.location = loc
cam.rotation_euler = rot
bpy.context.scene.camera = cam

world = bpy.data.worlds.new("W")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.35, 0.4, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.6

ld = bpy.data.lights.new("key", type='SUN')
ld.energy = 3.0
lo = bpy.data.objects.new("key", ld)
bpy.context.collection.objects.link(lo)
lo.location = loc
aim = mathutils.Vector((0, 0, 0)) - mathutils.Vector(loc)
lo.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 520
scene.render.resolution_y = 520
scene.render.filepath = out
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print("POSE_OK", out)
