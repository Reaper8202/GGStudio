"""Load a rigged GLB, rotate named nodes, and render — pivot verification.

Usage: ... -- MODEL.glb OUT.png VIEW "bone:rx,ry,rz" "bone:rx,ry,rz" ...
Angles are degrees about the node's local axes, matching glTF node rotations.
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
    # Compose onto whatever the node already carries from the file.
    obj.rotation_mode = 'XYZ'
    obj.rotation_euler = (
        obj.rotation_euler.x + rx,
        obj.rotation_euler.y + ry,
        obj.rotation_euler.z + rz,
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
