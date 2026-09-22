"""Normalize the licensed group-B pet sources without altering their rigs.

Source downloads are kept outside the repository. Run with an input directory
containing wolf/fox/husky/shiba.gltf, Owl.glb and Marmot.glb. A creator's glTF
color materials are preserved honestly; this does not fabricate fur textures.
"""
import argparse
import base64
import copy
import hashlib
import io
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image


def read_model(path):
    raw = Path(path).read_bytes()
    if raw[:4] == b"glTF":
        length, kind = struct.unpack_from("<II", raw, 12)
        assert kind == 0x4E4F534A
        doc = json.loads(raw[20:20 + length])
        offset = 20 + length
        count, kind = struct.unpack_from("<II", raw, offset)
        assert kind == 0x004E4942
        binary = bytearray(raw[offset + 8:offset + 8 + count])
    else:
        doc = json.loads(raw)
        assert len(doc["buffers"]) == 1
        uri = doc["buffers"][0]["uri"]
        assert uri.startswith("data:application/octet-stream;base64,")
        binary = bytearray(base64.b64decode(uri.split(",", 1)[1]))
        del doc["buffers"][0]["uri"]
    return doc, binary, hashlib.sha256(raw).hexdigest()


def accessor(doc, binary, index):
    a = doc["accessors"][index]
    assert "sparse" not in a
    v = doc["bufferViews"][a["bufferView"]]
    dtype = {5120: "i1", 5121: "u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[a["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    size = np.dtype(dtype).itemsize
    offset = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", width * size)
    return np.ndarray((a["count"], width), dtype=dtype, buffer=binary, offset=offset, strides=(stride, size)).copy()


def matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape((4, 4), order="F")
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    m = np.array([[1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w, 0],
                  [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w, 0],
                  [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y, 0],
                  [0, 0, 0, 1]], dtype=float)
    m[:3, :3] *= np.array(node.get("scale", [1, 1, 1]))
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def posed_bounds(doc, binary):
    # Normalize against the actual first idle pose, including skinning.
    nodes = copy.deepcopy(doc["nodes"])
    idle = next((a for a in doc.get("animations", []) if a.get("name", "").lower() == "idle"), None)
    if idle:
        for channel in idle["channels"]:
            target = channel["target"]
            if target["path"] in ("translation", "rotation", "scale"):
                sample = idle["samplers"][channel["sampler"]]
                nodes[target["node"]][target["path"]] = accessor(doc, binary, sample["output"])[0].tolist()
    world = {}
    def visit(i, parent):
        world[i] = parent @ matrix(nodes[i])
        for child in nodes[i].get("children", []):
            visit(child, world[i])
    for i in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        visit(i, np.eye(4))
    points = []
    for i, node in enumerate(nodes):
        if "mesh" not in node or i not in world:
            continue
        for p in doc["meshes"][node["mesh"]]["primitives"]:
            pos = accessor(doc, binary, p["attributes"]["POSITION"])
            vertices = np.column_stack((pos, np.ones(len(pos))))
            if "skin" in node:
                skin = doc["skins"][node["skin"]]
                inv = accessor(doc, binary, skin["inverseBindMatrices"]).reshape((-1, 4, 4)).transpose(0, 2, 1)
                palette = np.array([world[j] @ ib for j, ib in zip(skin["joints"], inv)])
                joints = accessor(doc, binary, p["attributes"]["JOINTS_0"])
                weights = accessor(doc, binary, p["attributes"]["WEIGHTS_0"])
                transformed = np.zeros((len(pos), 4))
                for slot in range(4):
                    transformed += np.einsum("nij,nj->ni", palette[joints[:, slot]], vertices) * weights[:, slot:slot+1]
            else:
                transformed = vertices @ world[i].T
            points.extend(transformed[:, :3])
    points = np.array(points)
    assert len(points) and np.isfinite(points).all()
    return points.min(axis=0), points.max(axis=0), world


def write_glb(path, doc, binary):
    binary.extend(b"\0" * (-len(binary) % 4))
    doc["buffers"] = [{"byteLength": len(binary)}]
    data = json.dumps(doc, separators=(",", ":")).encode()
    data += b" " * (-len(data) % 4)
    raw = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(data) + 8 + len(binary))
    raw += struct.pack("<II", len(data), 0x4E4F534A) + data
    raw += struct.pack("<II", len(binary), 0x004E4942) + binary
    Path(path).write_bytes(raw)
    return hashlib.sha256(raw).hexdigest(), len(raw)


def normalize(source, destination, asset_id, metadata, flip=False):
    doc, binary, source_hash = read_model(source)
    source_names = [a.get("name", "") for a in doc.get("animations", [])]
    canonical = []
    for animation in doc.get("animations", []):
        name = animation.get("name", "").lower()
        if name in ("idle", "walk", "attack", "death", "dead"):
            animation["name"] = "death" if name == "dead" else name
            canonical.append(animation)
    assert {"idle", "walk", "attack"}.issubset({a["name"] for a in canonical}), source
    doc["animations"] = canonical
    lo, hi, world = posed_bounds(doc, binary)
    height = float(hi[1] - lo[1])
    assert height > 0.01
    center = (hi + lo) / 2
    # Artist-authored +Z heading is retained. The caller can explicitly correct
    # a source with different orientation after inspecting its actual model.
    rotate = np.array([-1, 1, -1]) if flip else np.ones(3)
    wrapper = {"name": asset_id + "_normalized", "children": doc["scenes"][doc.get("scene", 0)]["nodes"],
               "scale": [1 / height] * 3,
               "translation": [-float(center[0] * rotate[0]) / height, -float(lo[1]) / height, -float(center[2] * rotate[2]) / height]}
    if flip:
        wrapper["rotation"] = [0, 1, 0, 0]
    doc["scenes"][doc.get("scene", 0)]["nodes"] = [len(doc["nodes"])]
    doc["nodes"].append(wrapper)
    doc["asset"] = {"version": "2.0", "generator": "Emberwatch licensed pet normalization", "copyright": metadata["license"] + " — " + ", ".join(metadata["authors"])}
    textures = []
    for image in doc.get("images", []):
        v = doc["bufferViews"][image["bufferView"]]
        im = Image.open(io.BytesIO(binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]))
        assert max(im.size) <= 2048, (asset_id, im.size)
        textures.append({"width": im.width, "height": im.height, "format": im.format})
    destination.mkdir(parents=True, exist_ok=True)
    digest, size = write_glb(destination / "model.glb", doc, binary)
    clips = []
    for a in canonical:
        duration = max(float(accessor(doc, binary, s["input"])[-1, 0]) for s in a["samplers"])
        clips.append({"name": a["name"], "duration": duration, "source": metadata.get("animationSource", "creator animation")})
    provenance = dict(metadata, assetId=asset_id, model="model.glb", thumbnail="thumbnail.png", modelSha256=digest,
                      modelBytes=size, sourceFiles=metadata.get("sourceFiles", []) + [{"name": source.name, "sha256": source_hash, "kind": "conversion input"}], sourceAnimations=source_names,
                      triangles=sum(doc["accessors"][p["indices"]]["count"] // 3 if "indices" in p else doc["accessors"][p["attributes"]["POSITION"]]["count"] // 3 for mesh in doc["meshes"] for p in mesh["primitives"]),
                      skinCount=len(doc.get("skins", [])), drawCalls=sum(len(mesh["primitives"]) for mesh in doc["meshes"]),
                      clips=clips, textures=textures, normalization={"up": "+Y", "forward": "+Z", "idleFeetY": 0,
                      "idleHeight": 1, "originalBounds": {"min": lo.tolist(), "max": hi.tolist()}, "headingFlipped": flip},
                      modifications=metadata.get("modifications", ["Preserved creator mesh, skin weights, materials and source texture pixels."]) + [
                                     "Selected canonical idle, walk, attack and death clips with the source/adaptation stated per clip.",
                                     "Added scene parent to normalize idle height to 1, center X/Z and place feet at Y=0."])
    (destination / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(asset_id, size, "bytes", "bounds", lo, hi, "textures", textures, "clips", [c["name"] for c in clips])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public/assets/pets")
    args = parser.parse_args()
    cc0 = {"license": "CC0-1.0", "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/", "downloadedAt": "2026-09-21"}
    drive = {"wolf": "1lFQoQ9ln2Z2wGuFFWObj9i5jHqUl_ftG", "fox": "1z-CWoUC2vJxrqgGFTYlMaywpE1ooV-bA",
             "husky": "1oYn47mfq9JAdkJJDcUftbhHNsgQ_CWdt", "shiba": "1XWUVbmMbiG9E90OqrumueD_pBdnYdyHZ"}
    for animal, file_id in drive.items():
        metadata = dict(cc0, title=animal.title(), authors=["Quaternius"],
                        sourceUrls=["https://quaternius.com/packs/ultimateanimatedanimals.html",
                                    "https://drive.google.com/drive/folders/1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry",
                                    "https://drive.google.com/uc?export=download&id=" + file_id],
                        surfaceNotes="Creator-authored color materials; this source has no image textures.")
        normalize(args.source / (animal + ".gltf"), args.output / animal, animal, metadata)
    for animal in ("owl", "marmot"):
        metadata = dict(cc0, title=animal.title(), authors=["Gobkit / Alsomind Tech Co., Ltd."],
                        sourceUrls=["https://gobkit.itch.io/gobkit-free-animal-pack-vol-2", "https://gobkit.com/api/free",
                                    "https://gobkit.com/freebies/animalB/" + animal.title() + ".glb"],
                        surfaceNotes="Embedded creator color atlas preserved. Actual downloaded file has four separately named clips; no timeline slicing needed.")
        normalize(args.source / (animal.title() + ".glb"), args.output / animal, animal, metadata)
    def source_file(name):
        file = args.source / name
        return {"name": name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "kind": "original creator file"}
    if (args.source / "dragon-export.glb").exists():
        metadata = dict(cc0, title="Dragon", authors=["Drummyfish", "Cethiel"],
                        sourceUrls=["https://opengameart.org/content/cethiels-dragon-3d", "https://opengameart.org/sites/default/files/dragon_oga.zip"],
                        sourceFiles=[source_file(n) for n in ("dragon_oga.zip", "dragon/dragon-2_80.blend", "dragon/dragon.png")],
                        surfaceNotes="Original 472×420 hand-painted dragon texture. Grounded pet; no flight fabricated.",
                        modifications=["Removed creator preview planes/lights and converted original Blender mesh, skin and four actions to GLB.",
                                       "Explicitly bound Blender 4.5 legacy action slots; verified actual skinned-vertex movement in idle, walk and attack.",
                                       "Preserved creator texture pixels and the original rig animation."])
        normalize(args.source / "dragon-export.glb", args.output / "dragon", "dragon", metadata)
    if (args.source / "griffin-export.glb").exists():
        metadata = dict(cc0, title="Golden Griffin", authors=["Quaternius (quadruped mesh and gait)", "Panther-One (bird mesh, texture and wing animation)", "Emberwatch (griffin adaptation)"],
                        license="CC-BY-3.0 (bird component); CC0-1.0 (quadruped component)",
                        licenseUrl="https://creativecommons.org/licenses/by/3.0/",
                        sourceUrls=["https://opengameart.org/content/bird-animated", "https://opengameart.org/sites/default/files/Bird.blend",
                                    "https://opengameart.org/sites/default/files/Bird_0.png", "https://quaternius.com/packs/ultimateanimatedanimals.html",
                                    "https://drive.google.com/uc?export=download&id=1lFQoQ9ln2Z2wGuFFWObj9i5jHqUl_ftG",
                                    "https://creativecommons.org/licenses/by/3.0/", "https://creativecommons.org/publicdomain/zero/1.0/"],
                        sourceFiles=[source_file(n) for n in ("Bird.blend", "Bird_0.png", "wolf.gltf")],
                        animationSource="Adapted composite: Quaternius quadruped action plus Panther-One wing/head action, synchronized on shoulder-mounted rigs; attack feather cycle accelerated.",
                        sourceSubstitution="The selected VitSh Griffin requires an authenticated Sketchfab download (HTTP401). An alternative BlendSwap griffin also requires sign-in. Neither access control was bypassed. This is a different original adaptation from the credited component meshes.",
                        surfaceNotes="Original 1024×1024 golden feather diffuse pixels preserved. Quadruped uses modified warm lion-color materials.",
                        modifications=["Bird - Animated by Panther-One, https://opengameart.org/content/bird-animated, used under CC BY 3.0. Credit and license retained for this modified mesh/animation.",
                                       "Quaternius Ultimate Animated Animal Pack wolf body and gait, used under CC0 1.0.",
                                       "Removed canine head/upper neck and bird tail at original skin groups; combined the remaining authored meshes into a griffin.",
                                       "Broadened lion torso, enlarged the existing bird skull, sculpted a downward hooked beak and swept brow/crest from original head vertices; retained UVs and skin weights.",
                                       "Attached feather rig to the moving quadruped shoulder; synchronized separate rigs into canonical idle/walk/attack/death clips. Original wing texture was not repainted."])
        normalize(args.source / "griffin-export.glb", args.output / "griffin", "griffin", metadata)
