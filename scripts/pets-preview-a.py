"""Render checkpoints from a converted GLB's real skeletal animation.

blender --background --python scripts/pets-preview-a.py -- MODEL CLIP OUTPUT
Output stays outside the repository; this is a visual validation helper.
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def mesh_bounds(meshes):
    points = []
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in meshes:
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        evaluated.to_mesh_clear()
    return Vector([min(v[i] for v in points) for i in range(3)]), Vector([max(v[i] for v in points) for i in range(3)])


def preview(model, clip, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(model))
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == 'MESH']
    rigs = [o for o in scene.objects if o.type == 'ARMATURE']
    action = bpy.data.actions[clip]
    for obj in scene.objects:
        if obj.animation_data:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = True
    assert len(rigs) == 1
    rig = rigs[0]
    rig.animation_data_create()
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = next(s for s in action.slots if s.target_id_type == 'OBJECT')
    start, end = action.frame_range
    frames = [start + (end - start) * ratio for ratio in (0, 0.25, 0.5, 0.75, 0.999)]
    ranges = []
    for frame in frames:
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        bpy.context.view_layer.update()
        lo, hi = mesh_bounds(meshes)
        ranges.append((lo, hi))
    lo = Vector([min(pair[0][i] for pair in ranges) for i in range(3)])
    hi = Vector([max(pair[1][i] for pair in ranges) for i in range(3)])
    center = (lo + hi) / 2
    size = max(hi - lo)
    world = bpy.data.worlds.new('Studio world')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.15, 0.20, 0.26, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 448
    scene.render.resolution_y = 448
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    data = bpy.data.cameras.new('Checkpoint camera')
    camera = bpy.data.objects.new('Checkpoint camera', data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector((1.4, -2.7, 1.3)).normalized() * size * 2.9
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = size * 1.16
    scene.camera = camera
    for name, position, energy, color in [('key', (2, -3, 4), 500, (1, 0.89, 0.76)),
                                         ('fill', (-3, -1, 2), 330, (0.7, 0.82, 1)),
                                         ('rim', (0, 3, 3), 600, (1, 0.95, 0.9))]:
        light_data = bpy.data.lights.new(name, 'AREA')
        light_data.energy = energy * size * size
        light_data.color = color
        light_data.shape = 'DISK'
        light_data.size = size * 2
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = center + Vector(position) * size
        light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
    # This neutral floor is validation scenery, never exported into the pet.
    bpy.ops.mesh.primitive_plane_add(size=size * 200, location=(0, 0, 0))
    floor = bpy.context.object
    mat = bpy.data.materials.new('Ground reference')
    mat.diffuse_color = (0.075, 0.095, 0.12, 1)
    floor.data.materials.append(mat)
    output.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        scene.frame_set(math.floor(frame), subframe=frame % 1)
        scene.render.filepath = str(output / f'{index}.png')
        bpy.ops.render.render(write_still=True)
    (output / 'checkpoints.json').write_text(json.dumps({'model': str(model), 'clip': clip, 'frames': frames,
                                                        'boundsZUp': [{'min': list(a), 'max': list(b)} for a, b in ranges]}, indent=2) + '\n')
    print('PET_PREVIEW', str(output), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('model', type=Path)
    parser.add_argument('clip')
    parser.add_argument('output', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    preview(args.model, args.clip, args.output)
