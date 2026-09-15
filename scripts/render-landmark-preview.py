"""Rasterize exact exported game landmark geometry; no generated artwork.

python scripts/render-landmark-preview.py input.json output.jpg
Requires NumPy, Pillow, and DejaVu Sans. Bump maps, game shadows, and game
lighting are not reproduced; this is an offline geometry inspection image.
"""
import json
import math
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

source = sys.argv[1] if len(sys.argv) > 1 else '/tmp/emberwatch-landmarks.json'
output = sys.argv[2] if len(sys.argv) > 2 else '/tmp/gate-well.jpg'
data = json.load(open(source))
W, H = 2400, 1800
canvas = Image.new('RGB', (W, H), '#131c22')
draw = ImageDraw.Draw(canvas)
regular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font = lambda size, strong=False: ImageFont.truetype(bold if strong else regular, size)
draw.text((68, 42), 'EMBERWATCH  /  GATE & WELL DETAIL', font=font(31, True), fill='#f0e3c9')
draw.text((68, 89), 'Actual game geometry  ·  Material colors and vertex normals  ·  Offline studio lighting', font=font(21), fill='#aebbc0')

def normalized(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)

def srgb(v):
    return np.where(v <= .0031308, v * 12.92, 1.055 * np.maximum(v, 0) ** (1 / 2.4) - .055)

def render(panel, width, height):
    tris = panel['triangles']
    view = normalized(panel['view'])
    right = normalized(np.cross([0, 1, 0], view))
    up = np.cross(view, right)
    all_points = np.asarray([p for tri in tris for p in tri['p']])
    focus = panel.get('focus')
    if focus:
        center = np.asarray(focus['center'])
        span_x, span_y = focus['width'], focus['height']
    else:
        projected = np.column_stack((all_points @ right, all_points @ up, all_points @ view))
        mid = (projected.min(axis=0) + projected.max(axis=0)) * .5
        center = right * mid[0] + up * mid[1] + view * mid[2]
        span_x, span_y = np.ptp(projected, axis=0)[:2]
        span_x *= 1.15
        span_y *= 1.10
    scale = min(width / span_x, height / span_y)
    yy, xx = np.mgrid[:height, :width]
    glow = np.exp(-(((xx - width * .45) / (width * .65)) ** 2 + ((yy - height * .38) / (height * .65)) ** 2))
    color = np.zeros((height, width, 3), np.float32)
    color[:] = np.array([.012, .019, .024]) + glow[..., None] * np.array([.029, .039, .042])
    depth_buffer = np.full((height, width), -1e9, np.float32)
    light = normalized([-.45, .90, .72])
    fill = normalized([.72, .30, -.25])
    half = normalized(light + view)
    tris = sorted(tris, key=lambda tri: (tri.get('opacity', 1) < 1, np.mean(np.asarray(tri['p']) @ view) if tri.get('opacity', 1) < 1 else 0))
    for tri in tris:
        world = np.asarray(tri['p'])
        p = world - center
        n = np.asarray(tri['n'])
        front = np.dot(np.cross(p[1] - p[0], p[2] - p[0]), view) > 0
        side = tri.get('side', 0)
        if (side == 0 and not front) or (side == 1 and front):
            continue
        if not front:
            n = -n
        sx = p @ right * scale + width * .5
        sy = height * .5 - p @ up * scale
        depths = p @ view
        x0, x1 = max(0, math.floor(sx.min())), min(width - 1, math.ceil(sx.max()))
        y0, y1 = max(0, math.floor(sy.min())), min(height - 1, math.ceil(sy.max()))
        if x1 < x0 or y1 < y0:
            continue
        denominator = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2])
        if abs(denominator) < 1e-10:
            continue
        y, x = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        x, y = x + .5, y + .5
        a = ((sy[1] - sy[2]) * (x - sx[2]) + (sx[2] - sx[1]) * (y - sy[2])) / denominator
        b = ((sy[2] - sy[0]) * (x - sx[2]) + (sx[0] - sx[2]) * (y - sy[2])) / denominator
        c = 1 - a - b
        z = a * depths[0] + b * depths[1] + c * depths[2]
        mask = (a >= -1e-7) & (b >= -1e-7) & (c >= -1e-7) & (z > depth_buffer[y0:y1 + 1, x0:x1 + 1])
        if not mask.any():
            continue
        normal = a[mask, None] * n[0] + b[mask, None] * n[1] + c[mask, None] * n[2]
        normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-9)
        diffuse = .18 + (normal[:, 1] + 1) * .065 + np.maximum(0, normal @ light) * .70 + np.maximum(0, normal @ fill) * .12
        vc = np.asarray(tri['c'])
        base = a[mask, None] * vc[0] + b[mask, None] * vc[1] + c[mask, None] * vc[2]
        metal, rough = tri['metal'], tri['rough']
        spec = np.maximum(0, normal @ half) ** (14 + (1 - rough) * 95)
        rgb = base * diffuse[:, None] + spec[:, None] * (.035 * (1 - metal) + base * metal * .5)
        rgb += np.asarray(tri['e'])[None, :] * .35
        alpha = tri.get('opacity', 1)
        region = color[y0:y1 + 1, x0:x1 + 1]
        region[mask] = rgb * alpha + region[mask] * (1 - alpha)
        if alpha >= 1:
            depth_buffer[y0:y1 + 1, x0:x1 + 1][mask] = z[mask]
    return Image.fromarray((np.clip(srgb(color), 0, 1) * 255).astype(np.uint8))

for index, panel in enumerate(data['panels']):
    column, row = index % 2, index // 2
    x, y = 56 + column * 1172, 153 + row * 770
    canvas.paste(render(panel, 1116, 660), (x, y))
    draw.text((x + 20, y + 680), panel['label'], font=font(22, True), fill='#eddfc7')
    draw.text((x + 20, y + 713), panel['caption'], font=font(17), fill='#acb8bd')

draw.line((68, 1732, 2332, 1732), fill='#41515a', width=1)
draw.text((68, 1754), 'Geometry review only. Roof omitted in well views; procedural bump maps and in-game lighting require a live playtest.', font=font(18), fill='#aab8be')
canvas.save(output, quality=91, optimize=True, subsampling=0)
print(output)
