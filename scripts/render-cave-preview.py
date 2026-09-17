"""Render exact exported cave geometry into an offline inspection sheet.

python scripts/render-cave-preview.py input.json output.jpg
Uses a depth-buffered rasterizer with near-plane clipping and perspective-
correct normal/color interpolation. Game lighting and shadows are not matched.
Requires NumPy, Pillow, and DejaVu Sans.
"""
import json
import math
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

source = sys.argv[1] if len(sys.argv) > 1 else '/tmp/emberwatch-cave.json'
output = sys.argv[2] if len(sys.argv) > 2 else '/tmp/cave.jpg'
data = json.load(open(source))
W, H = 2400, 1800
canvas = Image.new('RGB', (W, H), '#121c22')
draw = ImageDraw.Draw(canvas)
regular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font = lambda size, strong=False: ImageFont.truetype(bold if strong else regular, size)
draw.text((66, 39), 'EMBERWATCH  /  THE DEEPWORKS', font=font(32, True), fill='#efe1c7')
draw.text((66, 88), f"Actual cave geometry and {data['stats']['minerals']} mineral formations  ·  Reproducible sample ore roll  ·  Offline lighting", font=font(21), fill='#abb9bf')

def normalized(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)

def srgb(v):
    return np.where(v <= .0031308, v * 12.92, 1.055 * np.maximum(v, 0) ** (1 / 2.4) - .055)

def clipped(vertices, camera, view, near=.12):
    result = []
    for a, b in zip(vertices, vertices[1:] + vertices[:1]):
        da, db = -np.dot(a[:3] - camera, view), -np.dot(b[:3] - camera, view)
        if da >= near:
            result.append(a)
        if (da >= near) != (db >= near):
            result.append(a + (b - a) * ((near - da) / (db - da)))
    return [np.asarray([result[0], result[i], result[i + 1]]) for i in range(1, len(result) - 1)]

def render(panel, width, height):
    tris = [tri for tri in data['triangles'] if tri['part'] not in panel.get('hide', [])]
    perspective = panel['projection'] == 'perspective'
    camera = np.asarray(panel.get('camera', [0, 0, 0]), dtype=np.float64)
    view = normalized(camera - np.asarray(panel['target'])) if perspective else normalized(panel['view'])
    right = normalized(np.cross([0, 1, 0], view))
    up = np.cross(view, right)
    if perspective:
        center = camera
        scale = height / (2 * math.tan(math.radians(panel['fov']) / 2))
    else:
        points = np.asarray([p for tri in tris for p in tri['p']])
        projected = np.column_stack((points @ right, points @ up, points @ view))
        mid = (projected.max(axis=0) + projected.min(axis=0)) * .5
        center = right * mid[0] + up * mid[1] + view * mid[2]
        span_x, span_y = np.ptp(projected, axis=0)[:2]
        scale = min(width / (span_x * 1.23), height / (span_y * 1.10))
    y, x = np.mgrid[:height, :width]
    glow = np.exp(-(((x - width * .46) / (width * .65)) ** 2 + ((y - height * .36) / (height * .65)) ** 2))
    color = np.zeros((height, width, 3), np.float32)
    color[:] = np.array([.011, .018, .024]) + glow[..., None] * np.array([.022, .033, .037])
    buffer = np.full((height, width), -1e9, np.float32)
    light = normalized([-.35, .85, .60])
    fill = normalized([.7, .25, -.4])
    for tri in tris:
        world, normals, colors = np.asarray(tri['p']), np.asarray(tri['n']), np.asarray(tri['c'])
        face = np.cross(world[1] - world[0], world[2] - world[0])
        front = np.dot(face, camera - world[0] if perspective else view) > 0
        side = tri.get('side', 0)
        if (side == 0 and not front) or (side == 1 and front):
            continue
        if not front:
            normals = -normals
        vertices = np.column_stack((world, normals, colors))
        pieces = clipped(list(vertices), camera, view) if perspective else [vertices]
        for piece in pieces:
            world, n, vc = piece[:, :3], piece[:, 3:6], piece[:, 6:9]
            p = world - center
            depths = p @ view
            denominator_z = -depths if perspective else np.ones(3)
            sx = (p @ right) / denominator_z * scale + width * .5
            sy = height * .5 - (p @ up) / denominator_z * scale
            x0, x1 = max(0, math.floor(sx.min())), min(width - 1, math.ceil(sx.max()))
            y0, y1 = max(0, math.floor(sy.min())), min(height - 1, math.ceil(sy.max()))
            if x1 < x0 or y1 < y0:
                continue
            den = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2])
            if abs(den) < 1e-10:
                continue
            yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            xx, yy = xx + .5, yy + .5
            a = ((sy[1] - sy[2]) * (xx - sx[2]) + (sx[2] - sx[1]) * (yy - sy[2])) / den
            b = ((sy[2] - sy[0]) * (xx - sx[2]) + (sx[0] - sx[2]) * (yy - sy[2])) / den
            c = 1 - a - b
            inside = (a >= -1e-7) & (b >= -1e-7) & (c >= -1e-7)
            if perspective:
                a, b, c = a / denominator_z[0], b / denominator_z[1], c / denominator_z[2]
                total = a + b + c
                valid = np.abs(total) > 1e-12
                total = np.where(valid, total, 1)
                z = -1 / total
                a, b, c = a / total, b / total, c / total
                inside &= valid
            else:
                z = a * depths[0] + b * depths[1] + c * depths[2]
            mask = inside & (z > buffer[y0:y1 + 1, x0:x1 + 1])
            if not mask.any():
                continue
            na = a[mask, None] * n[0] + b[mask, None] * n[1] + c[mask, None] * n[2]
            na /= np.maximum(np.linalg.norm(na, axis=1, keepdims=True), 1e-9)
            base = a[mask, None] * vc[0] + b[mask, None] * vc[1] + c[mask, None] * vc[2]
            diffuse = .20 + (na[:, 1] + 1) * .085 + np.maximum(0, na @ light) * .72 + np.maximum(0, na @ fill) * .13
            rgb = base * diffuse[:, None] + np.asarray(tri['e'])[None, :] * .5
            if panel.get('lights'):
                wp = a[mask, None] * world[0] + b[mask, None] * world[1] + c[mask, None] * world[2]
                for lamp in panel['lights']:
                    delta = np.asarray(lamp['position']) - wp
                    distance2 = np.maximum(np.sum(delta ** 2, axis=1), .25)
                    direction = delta / np.sqrt(distance2)[:, None]
                    nd = np.maximum(0, np.sum(na * direction, axis=1))
                    rgb += base * np.asarray(lamp['color'])[None, :] * (nd * lamp['intensity'] / distance2 * .18)[:, None]
            color[y0:y1 + 1, x0:x1 + 1][mask] = rgb
            buffer[y0:y1 + 1, x0:x1 + 1][mask] = z[mask]
    im = Image.fromarray((np.clip(srgb(color), 0, 1) * 255).astype(np.uint8))
    if panel.get('chambers'):
        d = ImageDraw.Draw(im)
        for chamber in panel['chambers']:
            p = np.asarray(chamber['point']) - center
            xx, yy = p @ right * scale + width * .5, height * .5 - p @ up * scale
            text = chamber['label']
            box = d.textbbox((xx, yy), text, font=font(21, True), anchor='mm')
            d.rounded_rectangle((box[0] - 12, box[1] - 9, box[2] + 12, box[3] + 9), fill='#19272b', radius=6)
            d.text((xx, yy), text, font=font(21, True), anchor='mm', fill='#ebd6a8')
    return im

positions = [(56, 155, 980, 1400), (1080, 155, 1264, 660), (1080, 936, 1264, 660)]
for panel, (x, y, width, height) in zip(data['panels'], positions):
    canvas.paste(render(panel, width, height), (x, y))
    draw.text((x + 16, y + height + 18), panel['label'], font=font(22, True), fill='#efddbd')
    draw.text((x + 16, y + height + 52), panel['caption'], font=font(18), fill='#aab8bd')
    print(f"Rendered {panel['id']}", flush=True)
draw.line((66, 1725, 2334, 1725), fill='#40515a', width=1)
draw.text((66, 1746), 'Geometry review only. Ceiling hidden in overview; game lighting, shadow maps, and camera movement require a live playtest.', font=font(18), fill='#a8b7bd')
canvas.save(output, quality=92, optimize=True, subsampling=0)
print(output)
