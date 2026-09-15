"""Render actual exported crate geometry into transparent PNGs and a 4×5 sheet.

Run node scripts/preview-crate-collection.mjs first, then:
  python3 scripts/render-crate-collection.py /tmp/emberwatch-crate-collection
Options: --jobs 4 --only sunforged_viking_helm,iron_coif
Requires installed NumPy and Pillow. No browser, network, or generated artwork.
Uses smooth authored normals/colors, source UV bump maps, and an approximate
studio reflection environment. These are illustrations, not WebGL screenshots.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import json
import math
import os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[1]
WRAP_REPEAT, WRAP_MIRROR = 1000, 1002


def unit(v):
    value = np.asarray(v, dtype=np.float64)
    return value / max(np.linalg.norm(value), 1e-12)


def srgb(linear):
    return np.where(linear <= .0031308, 12.92 * linear, 1.055 * np.maximum(linear, 0) ** (1 / 2.4) - .055)


def aces(linear):
    value = np.maximum(linear, 0)
    return np.clip((value * (2.51 * value + .03)) / (value * (2.43 * value + .59) + .14), 0, 1)


def sampler(texture, uv):
    """Bilinear source data sampling, including its real UV matrix and wrapping."""
    matrix = np.asarray(texture['matrix']).reshape(3, 3).T
    coords = np.column_stack((uv, np.ones(len(uv)))) @ matrix.T
    for axis, key in enumerate(('wrapS', 'wrapT')):
        if texture[key] == WRAP_REPEAT:
            coords[:, axis] %= 1
        elif texture[key] == WRAP_MIRROR:
            coords[:, axis] = 1 - np.abs(coords[:, axis] % 2 - 1)
        else:
            coords[:, axis] = np.clip(coords[:, axis], 0, 1)
    if texture['flipY']:
        coords[:, 1] = 1 - coords[:, 1]
    image = texture['_pixels']
    h, w = image.shape[:2]
    tx = coords[:, 0] * w - .5
    ty = coords[:, 1] * h - .5
    x0, y0 = np.floor(tx).astype(int), np.floor(ty).astype(int)
    fx, fy = (tx - x0)[:, None], (ty - y0)[:, None]
    def address(index, extent, mode):
        return index % extent if mode == WRAP_REPEAT else np.clip(index, 0, extent - 1)
    x1 = address(x0 + 1, w, texture['wrapS']); y1 = address(y0 + 1, h, texture['wrapT'])
    x0 = address(x0, w, texture['wrapS']); y0 = address(y0, h, texture['wrapT'])
    return ((image[y0, x0] * (1 - fx) + image[y0, x1] * fx) * (1 - fy)
            + (image[y1, x0] * (1 - fx) + image[y1, x1] * fx) * fy)


def bump_normals(normals, uv, triangle, triangle_uv, texture, strength):
    edges = triangle[1:] - triangle[0]
    delta = triangle_uv[1:] - triangle_uv[0]
    determinant = delta[0, 0] * delta[1, 1] - delta[1, 0] * delta[0, 1]
    if abs(determinant) < 1e-10:
        return normals
    tangent = (edges[0] * delta[1, 1] - edges[1] * delta[0, 1]) / determinant
    bitangent = (edges[1] * delta[0, 0] - edges[0] * delta[1, 0]) / determinant
    gram = np.array([[tangent @ tangent, tangent @ bitangent], [tangent @ bitangent, bitangent @ bitangent]])
    if abs(np.linalg.det(gram)) < 1e-14:
        return normals
    du, dv = 1 / texture['width'], 1 / texture['height']
    dhdu = (sampler(texture, uv + [du, 0])[:, 0] - sampler(texture, uv - [du, 0])[:, 0]) * strength / (2 * du)
    dhdv = (sampler(texture, uv + [0, dv])[:, 0] - sampler(texture, uv - [0, dv])[:, 0]) * strength / (2 * dv)
    slopes = np.column_stack((dhdu, dhdv)) @ np.linalg.inv(gram)
    gradient = slopes[:, 0, None] * tangent + slopes[:, 1, None] * bitangent
    gradient -= normals * np.sum(gradient * normals, axis=1)[:, None]
    # Bound subpixel texture slopes to keep tiny seams stable at thumbnail size.
    gradient *= np.minimum(1, .32 / np.maximum(np.linalg.norm(gradient, axis=1), 1e-12))[:, None]
    result = normals - gradient
    return result / np.maximum(np.linalg.norm(result, axis=1, keepdims=True), 1e-12)


def softbox(reflection, direction, width, height, roughness):
    axis = unit(direction); right = unit(np.cross([0, 1, 0], axis)); up = np.cross(axis, right)
    facing = reflection @ axis
    denominator = np.maximum(facing, .001)
    x = (reflection @ right) / denominator
    y = (reflection @ up) / denominator
    blur = roughness ** 2 * 1.5
    exponent = 6 - roughness * 3
    with np.errstate(over='ignore'):
        box = np.exp(-np.minimum(80, np.abs(x / (width + blur)) ** exponent + np.abs(y / (height + blur)) ** exponent))
    return box * (facing > 0)


def shade(normals, base, material, view, right, up):
    if material['unlit']:
        return base
    # View-relative studio light positions keep a rear-view pack equally readable.
    key = unit(right * -.52 + up * .74 + view * .83)
    fill = unit(right * .80 + up * .2 + view * .6)
    rim = unit(right * .4 + up * .7 - view * .7)
    nl = np.maximum(0, normals @ key)
    nf = np.maximum(0, normals @ fill)
    nr = np.maximum(0, normals @ rim)
    nv = np.clip(normals @ view, 0, 1)
    hemi = np.clip(normals[:, 1] * .5 + .5, 0, 1)
    metal, rough = material['metalness'], material['roughness']
    light = .19 + hemi * .20 + nl * .64 + nf * .17 + nr * .14
    diffuse = base * light[:, None] * (1 - metal * .86)
    reflection = normals * (2 * nv)[:, None] - view
    # Use camera-space reflection directions for three large reflected light cards.
    reflected = np.column_stack((reflection @ right, reflection @ up, reflection @ view))
    environment = np.full_like(reflection, .14) + np.maximum(reflected[:, 1], 0)[:, None] * np.array([.20, .24, .28])
    environment += softbox(reflected, [-.65, .60, .82], .43, .72, rough)[:, None] * np.array([2.9, 2.75, 2.5])
    environment += softbox(reflected, [.83, .05, .58], .12, .80, rough)[:, None] * np.array([1.25, 1.48, 1.8])
    environment += softbox(reflected, [-.25, -.60, .80], .50, .17, rough)[:, None] * np.array([.8, .78, .73])
    f0 = .04 * (1 - metal) + base * metal
    fresnel = f0 + (1 - f0) * (1 - nv[:, None]) ** 5
    rgb = diffuse + environment * fresnel * (1 - rough * .48) * material['envMapIntensity']
    half = unit(key + view)
    gloss = np.maximum(0, normals @ half) ** (18 + (1 - rough) ** 2 * 210)
    rgb += gloss[:, None] * fresnel * (1.4 - rough * .7)
    if material['clearcoat']:
        coat = softbox(reflected, [-.65, .60, .82], .39, .69, material['clearcoatRoughness'])
        rgb += coat[:, None] * material['clearcoat'] * .42
    return rgb + np.asarray(material['emissive'])


def render_item(arguments):
    source, destination, entry, width, height = arguments
    data = json.loads((source / entry['file']).read_text())
    ss = 2; w, h = width * ss, height * ss
    yaw, pitch = data['camera']['yaw'], data['camera']['pitch']
    view = unit([math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)])
    right = unit(np.cross([0, 1, 0], view)); up = np.cross(view, right)
    for material in data['materials']:
        for key in ('map', 'bumpMap'):
            texture = material[key]
            if texture:
                texture['_pixels'] = np.array(texture['data'], dtype=np.float64).reshape(texture['height'], texture['width'], texture['channels']) / 255
    # Fit projected *actual vertices* instead of guessing size from slot names.
    extent = []
    for collection in ('meshes', 'points'):
        for mesh in data[collection]:
            mesh['_p'] = np.asarray(mesh['positions'], dtype=np.float64).reshape(-1, 3)
            extent.append(np.column_stack((mesh['_p'] @ right, mesh['_p'] @ up)))
    projected = np.vstack(extent); lo, hi = projected.min(axis=0), projected.max(axis=0)
    center = (lo + hi) / 2
    scale = min(w * .85 / max(hi[0] - lo[0], .001), h * .84 / max(hi[1] - lo[1], .001))
    color = np.zeros((h, w, 3), np.float64); alpha = np.zeros((h, w), np.float64)
    depth = np.full((h, w), -np.inf)
    meshes = sorted(data['meshes'], key=lambda mesh: (data['materials'][mesh['material']]['transparent'], float(np.mean(mesh['_p'] @ view))))
    visible_triangles = 0
    for mesh in meshes:
        material = data['materials'][mesh['material']]
        positions = mesh['_p']; normals = np.asarray(mesh['normals']).reshape(-1, 3)
        uvs = np.asarray(mesh['uvs']).reshape(-1, 2) if mesh['uvs'] else None
        vertex_colors = np.asarray(mesh['colors']).reshape(-1, 3) if mesh['colors'] and material['vertexColors'] else None
        screen = np.column_stack(((positions @ right - center[0]) * scale + w / 2, h / 2 - (positions @ up - center[1]) * scale))
        depths = positions @ view
        for indices in np.asarray(mesh['indices']).reshape(-1, 3):
            p, n = positions[indices], normals[indices]
            face = np.cross(p[1] - p[0], p[2] - p[0]); facing = float(face @ view) > 0
            if (material['side'] == 0 and not facing) or (material['side'] == 1 and facing):
                continue
            if material['flatShading']:
                n = np.tile(unit(face), (3, 1))
            if not facing:
                n = -n
            pixel = screen[indices]; sx, sy = pixel[:, 0], pixel[:, 1]
            x0 = max(0, int(math.floor(sx.min()))); x1 = min(w - 1, int(math.ceil(sx.max())))
            y0 = max(0, int(math.floor(sy.min()))); y1 = min(h - 1, int(math.ceil(sy.max())))
            if x1 < x0 or y1 < y0:
                continue
            denominator = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2])
            if abs(denominator) < 1e-12:
                continue
            yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]; xx = xx + .5; yy = yy + .5
            a = ((sy[1] - sy[2]) * (xx - sx[2]) + (sx[2] - sx[1]) * (yy - sy[2])) / denominator
            b = ((sy[2] - sy[0]) * (xx - sx[2]) + (sx[0] - sx[2]) * (yy - sy[2])) / denominator
            c = 1 - a - b
            z = a * depths[indices[0]] + b * depths[indices[1]] + c * depths[indices[2]]
            mask = (a >= -1e-7) & (b >= -1e-7) & (c >= -1e-7) & (z > depth[y0:y1 + 1, x0:x1 + 1])
            if not np.any(mask):
                continue
            weights = np.column_stack((a[mask], b[mask], c[mask]))
            smooth = weights @ n; smooth /= np.maximum(np.linalg.norm(smooth, axis=1, keepdims=True), 1e-12)
            uv = weights @ uvs[indices] if uvs is not None else None
            if material['bumpMap'] and uv is not None:
                smooth = bump_normals(smooth, uv, p, uvs[indices], material['bumpMap'], material['bumpScale'])
            base = np.tile(material['color'], (len(weights), 1))
            if vertex_colors is not None:
                base *= weights @ vertex_colors[indices]
            opacity = np.full(len(weights), material['opacity'])
            if material['map'] and uv is not None:
                texel = sampler(material['map'], uv)
                albedo = texel[:, :3]
                if material['map']['colorSpace'] == 'srgb':
                    albedo = np.where(albedo <= .04045, albedo / 12.92, ((albedo + .055) / 1.055) ** 2.4)
                base *= albedo
                if texel.shape[1] == 4:
                    opacity *= texel[:, 3]
            rgb = shade(smooth, base, material, view, right, up)
            target = color[y0:y1 + 1, x0:x1 + 1]; target_alpha = alpha[y0:y1 + 1, x0:x1 + 1]
            if material['additive']:
                target[mask] += rgb * opacity[:, None]
                target_alpha[mask] = np.maximum(target_alpha[mask], opacity)
            else:
                target[mask] = rgb * opacity[:, None] + target[mask] * (1 - opacity[:, None])
                target_alpha[mask] = opacity + target_alpha[mask] * (1 - opacity)
            if material['depthWrite']:
                depth[y0:y1 + 1, x0:x1 + 1][mask] = z[mask]
            visible_triangles += 1
    # Points are the model's authored bounded ember particles, not invented mesh.
    for points in data['points']:
        material = data['materials'][points['material']]
        for point in points['_p']:
            cx = (point @ right - center[0]) * scale + w / 2
            cy = h / 2 - (point @ up - center[1]) * scale
            radius = max(.65, points['size'] * scale * .5)
            x0 = max(0, int(cx - radius)); x1 = min(w - 1, int(cx + radius + 1))
            y0 = max(0, int(cy - radius)); y1 = min(h - 1, int(cy + radius + 1))
            yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            coverage = np.clip(radius + .5 - np.maximum(np.abs(xx + .5 - cx), np.abs(yy + .5 - cy)), 0, 1) * material['opacity']
            visible = point @ view > depth[y0:y1 + 1, x0:x1 + 1]
            coverage *= visible
            color[y0:y1 + 1, x0:x1 + 1] += np.asarray(material['color']) * coverage[..., None]
            alpha[y0:y1 + 1, x0:x1 + 1] = np.maximum(alpha[y0:y1 + 1, x0:x1 + 1], coverage)
    straight = color / np.maximum(alpha[..., None], 1e-12)
    image = np.dstack((np.clip(srgb(aces(straight * .92)), 0, 1), alpha))
    result = Image.fromarray(np.rint(image * 255).astype(np.uint8), 'RGBA').resize((width, height), Image.Resampling.LANCZOS)
    box = result.getchannel('A').getbbox()
    assert box and min(box[:2]) > 2 and box[2] < width - 2 and box[3] < height - 2, (entry['id'], box)
    assert visible_triangles > 0
    destination.mkdir(parents=True, exist_ok=True)
    filename = destination / f"{entry['id']}.png"
    result.save(filename, optimize=True)
    return entry['id'], filename.stat().st_size, visible_triangles, box


def contact_sheet(entries, directory, output):
    columns = 4; tile_w = 412; tile_h = 425; gap = 16; margin = 32; header = 142; footer = 65
    rows = math.ceil(len(entries) / columns)
    width = margin * 2 + columns * tile_w + (columns - 1) * gap
    height = header + rows * tile_h + (rows - 1) * gap + footer
    image = Image.new('RGB', (width, height), '#101918'); draw = ImageDraw.Draw(image)
    fonts = '/usr/share/fonts/truetype/dejavu/'
    bold = fonts + 'DejaVuSans-Bold.ttf'; regular = fonts + 'DejaVuSans.ttf'
    draw.text((margin, 29), 'EMBERWATCH', font=ImageFont.truetype(bold, 35), fill='#edddbb')
    draw.text((margin, 78), 'THE COLLECTION  /  20 ORIGINAL ITEM MODELS', font=ImageFont.truetype(bold, 16), fill='#aab6a7')
    draw.text((width - margin, 44), 'ARTWORK PREVIEW', font=ImageFont.truetype(bold, 13), anchor='ra', fill='#b9c6b8')
    draw.text((width - margin, 76), 'Authored geometry · Studio lighting', font=ImageFont.truetype(regular, 14), anchor='ra', fill='#819486')
    for i, entry in enumerate(entries):
        x = margin + i % columns * (tile_w + gap); y = header + i // columns * (tile_h + gap)
        draw.rounded_rectangle((x, y, x + tile_w, y + tile_h), radius=12, fill='#1c2925', outline='#34473c', width=1)
        draw.line((x + 17, y + 16, x + 68, y + 16), fill=entry['tierColor'], width=3)
        icon = Image.open(directory / f"{entry['id']}.png").convert('RGBA')
        image.paste(icon, (x + (tile_w - icon.width) // 2, y + 10), icon)
        font = ImageFont.truetype(bold, 18)
        while draw.textlength(entry['name'], font=font) > tile_w - 36:
            font = ImageFont.truetype(bold, font.size - 1)
        draw.text((x + 18, y + 369), entry['name'], font=font, fill='#e6dfcb')
        draw.text((x + 18, y + 399), entry['tierLabel'].upper(), font=ImageFont.truetype(bold, 12), fill=entry['tierColor'])
    draw.text((margin, height - 38), 'Rendered from the actual 3D assets. Kit previews show the pickaxe option.', font=ImageFont.truetype(regular, 14), fill='#97a99a')
    draw.text((width - margin, height - 38), '19 crate items + Hundredth Watch reward', font=ImageFont.truetype(regular, 14), anchor='ra', fill='#97a99a')
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, quality=93, optimize=True, subsampling=0)
    return image.size


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path, default=Path('/tmp/emberwatch-crate-collection'))
    parser.add_argument('--output', type=Path, default=REPO / 'public/assets/crate-items')
    parser.add_argument('--sheet', type=Path, default=REPO / 'docs/previews/crate-collection.jpg')
    parser.add_argument('--jobs', type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    collection = json.loads((args.source / 'collection.json').read_text())
    assert collection['format'] == 1
    only = set(filter(None, args.only.split(',')))
    if only - {item['id'] for item in collection['items']}:
        parser.error('Unknown item in --only')
    items = [entry for entry in collection['items'] if not only or entry['id'] in only]
    jobs = [(args.source, args.output, item, collection['width'], collection['height']) for item in items]
    with ProcessPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for future in as_completed(pool.submit(render_item, job) for job in jobs):
            name, size, triangles, box = future.result()
            print(f'{name}: {size:,} bytes; {triangles:,} visible triangles; alpha bounds {box}', flush=True)
    if all((args.output / f"{item['id']}.png").exists() for item in collection['items']):
        size = contact_sheet(collection['items'], args.output, args.sheet)
        print(f'Contact sheet: {args.sheet} ({size[0]} × {size[1]})', flush=True)
    print(f'Rendered {len(items)} transparent thumbnails.', flush=True)


if __name__ == '__main__':
    main()
