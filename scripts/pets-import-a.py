"""Convert the approved CC0 OpenGameArt pets with Blender 4.5 LTS.

Run: blender --background --python scripts/pets-import-a.py -- SOURCE_DIRECTORY
Sources are downloaded separately and kept outside the repository. This importer
retains the authors' meshes, skin weights, UVs and texture pixels, bakes their
constraint-based rigs, and exports separate, deliberately selected game clips.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


CONFIG = {
    'rabbit': dict(folder='rabbit', file='rabbit.blend', rig='Armature',
                   meshes=['Rabbit', 'Fur'], authors=['CDmir', 'TinyWorlds'],
                   clips={'idle': ('Guarding', 0, 400), 'walk': ('Running', 0, 16)}, flip=False),
    'boar': dict(folder='boar', file='boar.blend', rig='boar_armature',
                 meshes=['boar_mesh.000'], authors=['Teh_Bucket'],
                 clips={'idle': ('default', 0, 48), 'walk': ('walk', 0, 40), 'attack': ('attack', 0, 19)}, flip=True),
    'squirrel': dict(folder='squirrel', file='source/squirrel-anim.blend', rig='Armature',
                     meshes=['Squirrel', 'Head', 'Fingers', 'Teeth', 'Ears'], authors=['CDmir', 'TinyWorlds'],
                     clips={'idle': ('Idle.003', 0, 77), 'walk': ('Run', 0, 9), 'attack': ('Attack.000', 0, 22)}, flip=False),
    'vampire_bat': dict(folder='bat', file='source/bat_v5.blend', rig='Armature_Bat',
                        meshes=['Bat_LP_Anim'], authors=['rubberduck', 'yughues (original CC0 texture sources)'],
                        clips={'idle': ('Bat_Idle', 0, 8), 'walk': ('Bat_Flying', 0, 8), 'attack': ('Bat_Attack', 0, 8)}, flip=True),
    'frost_bat': dict(folder='bat', file='source/bat_v5.blend', rig='Armature_Frost_Bat',
                      meshes=['Frost_Bat_LP_Anim'], authors=['rubberduck', 'yughues (original CC0 texture sources)'],
                      clips={'idle': ('Bat_Idle', 0, 8), 'walk': ('Bat_Flying', 0, 8), 'attack': ('Bat_Attack', 0, 8)}, flip=True),
}


def material(name, diffuse, normal=None, alpha=False):
    mat = bpy.data.materials[name]
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.88
    mat.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    color = nodes.new('ShaderNodeTexImage')
    color.image = bpy.data.images[diffuse]
    color.image.colorspace_settings.name = 'sRGB'
    mat.node_tree.links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        mat.node_tree.links.new(color.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.surface_render_method = 'DITHERED'
    if normal:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images[normal]
        texture.image.colorspace_settings.name = 'Non-Color'
        converter = nodes.new('ShaderNodeNormalMap')
        mat.node_tree.links.new(texture.outputs['Color'], converter.inputs['Color'])
        mat.node_tree.links.new(converter.outputs['Normal'], bsdf.inputs['Normal'])
    mat.use_backface_culling = False


def configure_materials(asset_id):
    if asset_id == 'rabbit':
        material('Fur.001', 'rabbot-skinn', 'rabbit-NORM')
        material('Fur', 'Fur-skin', alpha=True)
    elif asset_id == 'boar':
        material('Material', 'boar')
    elif asset_id == 'squirrel':
        material('Body', 'Body', 'squirrel-body-norm.png')
        material('Head', 'Head', 'squirrel-head-norm.png')
        material('Ear-Hair', 'Head', alpha=True)
    else:
        prefix = 'frost_bat' if asset_id == 'frost_bat' else 'bat'
        material(prefix, prefix + '_tex.jpg', 'bat_tex_n.jpg')
        material(prefix + '_parts', prefix + '_parts.jpg')
    used = {n.image for o in bpy.context.scene.objects if o.type == 'MESH'
            for slot in o.material_slots if slot.material and slot.material.use_nodes
            for n in slot.material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}
    for image in used:
        assert min(image.size) > 0, ('Missing source image', image.name, image.filepath)
        assert max(image.size) <= 2048, (image.name, tuple(image.size))
    return [{'name': i.name, 'width': i.size[0], 'height': i.size[1]} for i in sorted(used, key=lambda i: i.name)]


def bounds(meshes):
    graph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in meshes:
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        evaluated.to_mesh_clear()
    return Vector([min(p[i] for p in points) for i in range(3)]), Vector([max(p[i] for p in points) for i in range(3)])


def bake_clips(rig, config, asset_id):
    """Sample evaluated author rigs before removing IK constraints for glTF.

    Convert pose-space matrices back to bone-local TRS using Blender's own
    inherit-scale conversion, retaining the authored rest rig and skin weights.
    """
    rig.animation_data_create()
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    snapshots = {}
    for name, (source, start, end) in config['clips'].items():
        rig.animation_data.action = None
        for bone in rig.pose.bones:
            bone.matrix_basis = Matrix.Identity(4)
        action = bpy.data.actions[source]
        rig.animation_data.action = action
        frames = []
        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(0 if asset_id == 'boar' and name == 'idle' else frame)
            if asset_id == 'boar' and name == 'idle':
                phase = 2 * math.pi * (frame - start) / (end - start)
                # A restrained breathing/sniffing idle on the original rig.
                rig.pose.bones['body.001'].scale = (1 + 0.012 * math.sin(phase), 1, 1 + 0.008 * math.sin(phase))
                rig.pose.bones['head'].rotation_mode = 'QUATERNION'
                rig.pose.bones['head'].rotation_quaternion = Quaternion((1, 0, 0), 0.025 * math.sin(phase))
            bpy.context.view_layer.update()
            evaluated = rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
            frames.append({b.name: b.matrix.copy() for b in evaluated.pose.bones})
        if name in ('idle', 'walk'):
            difference = max(abs(frames[-1][bone][row][column] - frames[0][bone][row][column])
                             for bone in frames[0] for row in range(4) for column in range(4))
            if difference > 0.0001:
                # Some source actions are movement snippets rather than closed
                # game loops. Ease back to their first pose without a hard snap.
                closure = 6 if asset_id == 'squirrel' and name == 'idle' else 2
                last = frames[-1]
                for step in range(1, closure + 1):
                    factor = step / closure
                    factor = factor * factor * (3 - 2 * factor)
                    sample = {}
                    for bone in last:
                        loc_a, rot_a, scale_a = last[bone].decompose()
                        loc_b, rot_b, scale_b = frames[0][bone].decompose()
                        sample[bone] = Matrix.LocRotScale(loc_a.lerp(loc_b, factor), rot_a.slerp(rot_b, factor), scale_a.lerp(scale_b, factor))
                    frames.append(sample)
        snapshots[name] = frames
    rig.animation_data_clear()
    for bone in rig.pose.bones:
        for constraint in list(bone.constraints):
            bone.constraints.remove(constraint)
    rig.data.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    rig.animation_data_create()
    actions = {}
    for name, frames in snapshots.items():
        action = bpy.data.actions.new(name)
        rig.animation_data.action = action
        for frame, matrices in enumerate(frames):
            for bone in rig.pose.bones:
                kwargs = {} if not bone.parent else {'parent_matrix': matrices[bone.parent.name], 'parent_matrix_local': bone.parent.bone.matrix_local}
                basis = bone.bone.convert_local_to_pose(matrices[bone.name], bone.bone.matrix_local, invert=True, **kwargs)
                bone.rotation_mode = 'QUATERNION'
                bone.matrix_basis = basis
                bone.keyframe_insert('location', frame=frame, group=bone.name)
                bone.keyframe_insert('rotation_quaternion', frame=frame, group=bone.name)
                bone.keyframe_insert('scale', frame=frame, group=bone.name)
        for curve in action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
        actions[name] = action
    rig.animation_data.action = actions['idle']
    bpy.context.scene.frame_set(0)
    return actions


def patch_alpha_and_inspect(path, alpha_names):
    raw = path.read_bytes()
    length, kind = struct.unpack_from('<II', raw, 12)
    assert kind == 0x4E4F534A
    doc = json.loads(raw[20:20 + length])
    binary_chunk = raw[20 + length:]
    for mat in doc.get('materials', []):
        if mat.get('name') in alpha_names:
            mat.update(alphaMode='MASK', alphaCutoff=0.35, doubleSided=True)
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    total = 12 + 8 + len(encoded) + len(binary_chunk)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + binary_chunk)
    assert doc.get('skins') and doc.get('images'), 'Textured skin must survive export'
    assert {'idle', 'walk'}.issubset({a['name'] for a in doc.get('animations', [])})
    return doc


def render_thumbnail(path, meshes):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    scene.world = bpy.data.worlds.new('Pet preview world')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.3, 0.36, 0.46, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
    lo, hi = bounds(meshes)
    center = (lo + hi) / 2
    size = max(hi - lo)
    data = bpy.data.cameras.new('Pet preview camera')
    camera = bpy.data.objects.new('Pet preview camera', data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector((1.4, -2.7, 1.15)).normalized() * size * 2.9
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = size * 1.18
    scene.camera = camera
    for name, offset, energy, color in [('key', (2, -3, 4), 450, (1, 0.89, 0.75)),
                                         ('fill', (-3, -1, 2), 300, (0.7, 0.82, 1)),
                                         ('rim', (0, 3, 3), 550, (1, 0.95, 0.87))]:
        light_data = bpy.data.lights.new(name, 'AREA')
        light_data.energy = energy * size * size
        light_data.color = color
        light_data.shape = 'DISK'
        light_data.size = size * 2
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = center + Vector(offset) * size
        light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def convert(asset_id, source_root, output_root):
    config = CONFIG[asset_id]
    source_dir = source_root / config['folder']
    source = source_dir / config['file']
    metadata = json.loads((source_dir / 'source.json').read_text())
    original = source_dir / metadata['sourceFile']
    assert hashlib.sha256(original.read_bytes()).hexdigest() == metadata['sourceSha256']
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.render.fps_base = 1
    rig = bpy.data.objects[config['rig']]
    meshes = [bpy.data.objects[n] for n in config['meshes']]
    for obj in list(bpy.data.objects):
        if obj not in [rig, *meshes]:
            bpy.data.objects.remove(obj, do_unlink=True)
    # Legacy 2.7 layer conversion can leave the animated bat on an excluded
    # collection; move the chosen rig/mesh into the active scene collection.
    for obj in [rig, *meshes]:
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        scene.collection.objects.link(obj)
        obj.hide_viewport = obj.hide_render = obj.hide_select = False
        obj.hide_set(False)
    for mesh in meshes:
        mesh.animation_data_clear()
        mesh.hide_set(False)
        mesh.hide_viewport = mesh.hide_render = False
        # Preserve the author's mirrored/decimated evaluated geometry and weights.
        bpy.context.view_layer.objects.active = mesh
        for modifier in list(mesh.modifiers):
            if modifier.type != 'ARMATURE':
                bpy.ops.object.modifier_apply(modifier=modifier.name)
    textures = configure_materials(asset_id)
    actions = bake_clips(rig, config, asset_id)
    root = bpy.data.objects.new(asset_id + '_normalized', None)
    scene.collection.objects.link(root)
    for obj in [rig, *meshes]:
        if obj.parent is None:
            obj.parent = root
    root.rotation_euler.z = math.pi if config['flip'] else 0
    bpy.context.view_layer.update()
    lo, hi = bounds(meshes)
    original_bounds = {'min': list(lo), 'max': list(hi)}
    height = hi.z - lo.z
    assert height > 0
    root.scale = (1 / height,) * 3
    root.location = (-(lo.x + hi.x) / (2 * height), -(lo.y + hi.y) / (2 * height), -lo.z / height)
    bpy.context.view_layer.update()
    lo, hi = bounds(meshes)
    assert abs(lo.z) < 0.00001 and abs(hi.z - 1) < 0.00001, (lo, hi)
    output = output_root / asset_id
    output.mkdir(parents=True, exist_ok=True)
    # A distinct NLA track per clip prevents source timelines from mixing.
    rig.animation_data.action = None
    for name, action in actions.items():
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.extrapolation = 'NOTHING'
        track.mute = True
    scene.frame_start = 0
    scene.frame_end = max(int(a.frame_range[1]) for a in actions.values())
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, rig, *meshes]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(output / 'model.glb'), export_format='GLB', use_selection=True,
                              export_animations=True, export_animation_mode='NLA_TRACKS', export_frame_range=False,
                              export_force_sampling=True, export_anim_slide_to_zero=True, export_rest_position_armature=True,
                              export_yup=True, export_skins=True, export_influence_nb=4, export_all_influences=False,
                              # Constant pose channels can differ from the rest
                              # pose (notably rabbit hips); retain their samples.
                              export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True)
    doc = patch_alpha_and_inspect(output / 'model.glb', ['Fur', 'Ear-Hair'])
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    rig.animation_data.action = actions['idle']
    scene.frame_set(0)
    render_thumbnail(output / 'thumbnail.png', meshes)
    clips = [{'name': name, 'sourceAction': source_name, 'sourceFrames': [start, end], 'duration': float(actions[name].frame_range[1]) / 24,
              'loopClosureFrames': int(actions[name].frame_range[1]) - (end - start),
              'notes': 'Original rig breathing/sniffing idle authored for this conversion.' if asset_id == 'boar' and name == 'idle' else 'Baked creator-authored skeletal motion.'}
             for name, (source_name, start, end) in config['clips'].items()]
    provenance = dict(assetId=asset_id, model='model.glb', thumbnail='thumbnail.png', title=asset_id.replace('_', ' ').title(),
                      license='CC0-1.0', licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/', authors=config['authors'],
                      sourceUrls=[metadata['sourcePage'], metadata['sourceDownload']],
                      sourceFiles=[{'name': metadata['sourceFile'], 'sha256': metadata['sourceSha256'], 'bytes': metadata['sourceBytes']}],
                      blendSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                      modelSha256=hashlib.sha256((output / 'model.glb').read_bytes()).hexdigest(),
                      modelBytes=(output / 'model.glb').stat().st_size, clips=clips, textures=textures,
                      normalization={'up': '+Y', 'forward': '+Z', 'idleFeetY': 0, 'idleHeight': 1,
                                     'sourceHeading': '+Y' if config['flip'] else '-Y', 'headingFlipped': config['flip'], 'originalBoundsZUp': original_bounds},
                      meshCount=len(doc['meshes']), skinCount=len(doc['skins']),
                      modifications=['Preserved source mesh, skin weights, UVs and supplied diffuse/normal texture pixels.',
                                     'Applied author non-armature modifiers and rebuilt legacy Blender materials as Principled PBR.',
                                     'Baked original IK constraints into separate named skeletal clips; no mixed full timeline.',
                                     'Eased non-looping source idle/walk endpoints back to their initial pose; recorded added frames per clip.',
                                     'Centered and normalized the idle pose to height 1 meter with feet at Y=0 and forward +Z.',
                                     'Rendered the actual converted model to a transparent 512px thumbnail.'])
    (output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print('PET_DONE', asset_id, provenance['modelBytes'], 'bytes', [a['name'] for a in doc['animations']], flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public/assets/pets')
    parser.add_argument('--only', choices=list(CONFIG), nargs='*')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    for asset in args.only or CONFIG:
        convert(asset, args.source, args.output)
