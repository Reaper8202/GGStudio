"""Orthographic axis views with an exact coordinate frame.

Camera is framed so the image spans exactly [-SPAN/2, +SPAN/2] in glTF model
units both ways, centred on the model origin, so joint coordinates can be read
straight off the pixels.

glTF (x, y_up, z) imports into Blender as (x, -z, y_up).
"""
import sys, bpy, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
src, out, view = argv[0], argv[1], argv[2]
SPAN = float(argv[3]) if len(argv) > 3 else 2.2

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# Camera positions in Blender space for each glTF-space viewing direction.
# 'front' looks from glTF +Z (Blender -Y) toward the origin.
VIEWS = {
    "front": ((0, -6, 0), (1.5708, 0, 0)),
    "back":  ((0,  6, 0), (1.5708, 0, 3.14159)),
    "right": (( 6, 0, 0), (1.5708, 0, 1.5708)),
    "left":  ((-6, 0, 0), (1.5708, 0, -1.5708)),
}
loc, rot = VIEWS[view]

cam_data = bpy.data.cameras.new("Cam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = SPAN
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

# Sun aimed down the viewing axis so the facing surface is evenly lit.
ld = bpy.data.lights.new("key", type='SUN')
ld.energy = 3.0
lo = bpy.data.objects.new("key", ld)
bpy.context.collection.objects.link(lo)
lo.location = loc
aim = mathutils.Vector((0, 0, 0)) - mathutils.Vector(loc)
lo.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 660
scene.render.resolution_y = 660
scene.render.filepath = out
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print("ORTHO_OK", out, view, "span=", SPAN)
