"""Blender 4.5 conversion and actual-model thumbnails for licensed pet group B.

blender -b --factory-startup --python scripts/pets-build-b.py -- dragon SOURCE_DIR
blender -b --factory-startup --python scripts/pets-build-b.py -- thumbnails PET_DIR IDS...
"""
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix


def export_dragon(source):
    bpy.ops.wm.open_mainfile(filepath=str(source / "dragon/dragon-2_80.blend"), load_ui=False)
    keep = {bpy.data.objects["dragon"], bpy.data.objects["Armature"]}
    for obj in keep:
        if obj.parent and obj.parent not in keep:
            transform = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = transform
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    for image in bpy.data.images:
        if image.name == "dragon.png":
            image.filepath = str(source / "dragon/dragon.png")
            image.reload()
    for action in bpy.data.actions:
        action.name = {"Attack": "attack", "Idle": "idle", "Walk": "walk", "Die": "death"}.get(action.name, action.name)
        action.use_fake_user = True
    rig = bpy.data.objects["Armature"]
    rig.animation_data_create()
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    rig.animation_data.action = bpy.data.actions["idle"]
    rig.animation_data.action_slot = bpy.data.actions["idle"].slots[0]
    bpy.context.scene.frame_set(1)
    bpy.context.scene.render.fps = 30
    for obj in bpy.context.scene.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(source / "dragon-export.glb"), export_format="GLB", use_selection=True,
                             export_animations=True, export_animation_mode="ACTIONS", export_anim_slide_to_zero=True,
                             export_frame_range=False, export_force_sampling=True, export_optimize_animation_size=True)
    print("DRAGON_EXPORTED", source / "dragon-export.glb")


def export_griffin(source, pets):
    """Adapt two licensed artist meshes into a feathered, rigged griffin.

    Quaternius supplies the quadruped body and gait. Panther-One supplies the
    actual textured bird head, chest, feathers, wings and flight rig. Nothing
    here substitutes a primitive proxy for either creator's mesh.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(pets / "wolf/model.glb"))
    wolf = bpy.data.objects["Wolf"]
    rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    wolf_actions = {a.name: a for a in bpy.data.actions}
    rig.animation_data.action = wolf_actions["idle"]
    rig.animation_data.action_slot = wolf_actions["idle"].slots[0]
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    # Remove the canine head and upper neck at their actual skin groups. The
    # retained lower neck joins the feathered chest inside the new bird mesh.
    remove_groups = {g.index for g in wolf.vertex_groups if g.name.startswith("Ear") or g.name in ("Head", "Neck2", "Neck3")}
    remove_indices = {v.index for v in wolf.data.vertices if sum(g.weight for g in v.groups if g.group in remove_groups) > 0.45}
    mesh = bmesh.new()
    mesh.from_mesh(wolf.data)
    mesh.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[v for v in mesh.verts if v.index in remove_indices], context="VERTS")
    mesh.to_mesh(wolf.data)
    mesh.free()
    torso_groups = {g.index for g in wolf.vertex_groups if g.name in ("Body", "Back", "Torso", "Torso2", "Torso3")}
    for vertex in wolf.data.vertices:
        torso_weight = sum(g.weight for g in vertex.groups if g.group in torso_groups)
        vertex.co.x *= 1.12 + 0.42 * min(1, torso_weight)
    wolf.name = "Griffin lion body"
    # Warm lion coloring is a material change, leaving the creator topology and
    # all limb weights intact. The feather texture remains unmodified.
    for mat in wolf.data.materials:
        node = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if node:
            name = mat.name.split(".")[0]
            color = (0.30, 0.15, 0.045, 1) if name == "Main" else (0.55, 0.35, 0.12, 1)
            node.inputs["Base Color"].default_value = color
            node.inputs["Roughness"].default_value = 0.78
    with bpy.data.libraries.load(str(source / "Bird.blend"), link=False) as (available, imported):
        imported.objects = ["Armature", "Sphere"]
    for obj in imported.objects:
        bpy.context.scene.collection.objects.link(obj)
    bird_rig = next(o for o in imported.objects if o.type == "ARMATURE")
    bird_mesh = next(o for o in imported.objects if o.type == "MESH")
    bird_rig.name = "Griffin feather rig"
    bird_mesh.name = "Griffin eagle head and wings"
    # The small bird's tail would overlap the lion's tail and is removed at
    # its own skin group. Authored chest/head/wings remain unchanged.
    tail = bird_mesh.vertex_groups.get("Bone.008")
    remove_indices = {v.index for v in bird_mesh.data.vertices if any(g.group == tail.index and g.weight > 0.5 for g in v.groups)}
    mesh = bmesh.new()
    mesh.from_mesh(bird_mesh.data)
    mesh.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[v for v in mesh.verts if v.index in remove_indices], context="VERTS")
    mesh.to_mesh(bird_mesh.data)
    mesh.free()
    # Sculpt the existing bird head into a larger raptor profile. The original
    # head UVs/skin weights remain intact; the existing beak tip is shortened
    # and bent down, with the skull's upper ring forming brow and swept crest.
    inverse_mesh = bird_mesh.matrix_world.inverted()
    for vertex in bird_mesh.data.vertices:
        weight = sum(g.weight for g in vertex.groups if g.group == 7)
        if weight < 0.5:
            continue
        original = bird_mesh.matrix_world @ vertex.co
        p = original.copy()
        factor = max(0, min(1, (-p.y - 0.075) / 0.055))
        p.x *= 1 + 0.40 * factor
        p.y = -0.12 + (p.y + 0.12) * (1 - 0.20 * factor)
        p.z = 0.14 + (p.z - 0.14) * (1 + 1.20 * factor) + 0.065 * factor
        if original.y < -0.35:
            p.y = -0.30
            p.z = 0.155
        if original.z > 0.19 and original.y > -0.18:
            p.z += 0.025 * factor
            p.y += 0.018 * factor
        elif original.z > 0.17 and original.y < -0.21:
            p.y -= 0.014 * factor
        vertex.co = inverse_mesh @ p
    bird_mesh.data.validate(verbose=True)
    feather = bpy.data.materials.new("Panther-One original golden feather texture")
    feather.use_nodes = True
    image = bpy.data.images.load(str(source / "Bird_0.png"), check_existing=False)
    image.pack()
    tex = feather.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = image
    shader = feather.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = 0.78
    feather.node_tree.links.new(tex.outputs["Color"], shader.inputs["Base Color"])
    bird_mesh.data.materials.clear()
    bird_mesh.data.materials.append(feather)
    for poly in bird_mesh.data.polygons:
        poly.material_index = 0
    original_bird = bird_rig.animation_data.action
    original_bird.name = "source_bird_flight"
    bird_rig.animation_data.action = original_bird
    bird_rig.animation_data.action_slot = original_bird.slots[0]
    bpy.context.scene.frame_set(1)
    # A common transformation moves the entire authored bird rig, preserving
    # its mesh-to-armature bind. The joint at the shoulder makes wing roots
    # follow the body's motion with no detached components.
    mount = bpy.data.objects.new("Feathered chest shoulder mount", None)
    bpy.context.scene.collection.objects.link(mount)
    mount.location = (0, -0.24, 0.49)
    mount.scale = (1.75, 1.75, 1.75)
    bird_rig.parent = mount
    bpy.context.view_layer.update()
    keep = mount.matrix_world.copy()
    mount.parent = rig
    mount.parent_type = "BONE"
    mount.parent_bone = "Torso3"
    mount.matrix_world = keep
    # Each body action gets a matching feather track. Export merges tracks by
    # name, so all pieces are driven by one idle/walk/attack/death game clip.
    for owner in (rig, bird_rig):
        owner.animation_data.action = None
        for track in list(owner.animation_data.nla_tracks):
            owner.animation_data.nla_tracks.remove(track)
    for name in ("idle", "walk", "attack", "death"):
        action = wolf_actions[name]
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.action_slot = action.slots[0]
        track.mute = name != "idle"
        bird_action = original_bird.copy()
        bird_action.name = "feather_" + name
        bird_action.use_fake_user = True
        track = bird_rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, bird_action)
        strip.action_slot = bird_action.slots[0]
        strip.scale = 0.75 if name == "attack" else 1
        strip.repeat = max(1, action.frame_range[1] / (29 * strip.scale))
        strip.frame_end = action.frame_range[1]
        track.mute = name != "idle"
    bpy.context.scene.frame_set(0)
    for obj in bpy.context.scene.objects:
        obj.select_set(obj.type in {"MESH", "ARMATURE", "EMPTY"} and not obj.hide_render and obj.visible_get())
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(source / "griffin-export.glb"), export_format="GLB", use_selection=True,
                             export_animations=True, export_animation_mode="NLA_TRACKS", export_merge_animation="NLA_TRACK",
                             export_anim_slide_to_zero=True, export_frame_range=False, export_force_sampling=True,
                             export_optimize_animation_size=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(source / "griffin-assembled.blend"))
    print("GRIFFIN_EXPORTED", source / "griffin-export.glb")


def bounds():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render or not obj.visible_get():
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        vertices.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        evaluated.to_mesh_clear()
    return Vector([min(v[i] for v in vertices) for i in range(3)]), Vector([max(v[i] for v in vertices) for i in range(3)])


def thumbnail(directory, name, clip_name="idle", fraction=0, output=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(directory / name / "model.glb"))
    # The source idle clip is used for a faithful rendered preview of this GLB.
    for obj in bpy.data.objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:
                track.mute = True
            candidates = [a for a in bpy.data.actions if a.name.lower() == clip_name]
            if candidates and obj.type == "ARMATURE":
                obj.animation_data.action = candidates[0]
                slot = next((s for s in candidates[0].slots if s.name_display == obj.name), None)
                if slot:
                    obj.animation_data.action_slot = slot
    duration = max((a.frame_range[1] for a in bpy.data.actions if a.name.lower() == clip_name), default=1)
    frame = duration * fraction
    bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
    lo, hi = bounds()
    center = (lo + hi) * 0.5
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("Pet preview world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.30, 0.35, 0.43, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.65
    scene.world = world
    camera = bpy.data.objects.new("Preview camera", bpy.data.cameras.new("Preview camera"))
    scene.collection.objects.link(camera)
    camera.location = center + Vector((2.4, -3.6, 1.8)).normalized() * 5
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    inv = camera.rotation_euler.to_matrix().transposed()
    corners = [inv @ Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    camera.data.ortho_scale = max(max(v[k] for v in corners) - min(v[k] for v in corners) for k in (0, 1)) * 1.22
    scene.camera = camera
    for label, offset, energy, size, color in [
        ("Warm key", (3, -4, 5), 480, 4, (1.0, 0.87, 0.70)),
        ("Cool fill", (-3, -2, 3), 240, 3, (0.63, 0.77, 1.0)),
        ("Rim", (1, 3, 4), 400, 3, (1.0, 0.83, 0.57))]:
        lamp = bpy.data.lights.new(label, "AREA")
        lamp.energy, lamp.size, lamp.color = energy, size, color
        obj = bpy.data.objects.new(label, lamp)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(offset)
        obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(output or directory / name / "thumbnail.png")
    bpy.ops.render.render(write_still=True)
    print("PET_THUMBNAIL", name, "bounds", list(lo), list(hi))


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    if args[0] == "dragon":
        export_dragon(Path(args[1]))
    elif args[0] == "griffin":
        export_griffin(Path(args[1]), Path(args[2]))
    elif args[0] == "thumbnails":
        for asset_id in args[2:]:
            thumbnail(Path(args[1]), asset_id)
    elif args[0] == "poses":
        destination = Path(args[3])
        destination.mkdir(parents=True, exist_ok=True)
        for clip, fraction in (("idle", .35), ("walk", .4), ("attack", .25), ("attack", .65)):
            thumbnail(Path(args[1]), args[2], clip, fraction, destination / (args[2] + "-" + clip + "-" + str(fraction) + ".png"))
    else:
        raise ValueError(args[0])
