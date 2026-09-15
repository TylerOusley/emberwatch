"""Rasterize exact exported Resource Exchange geometry; no generated artwork.

python scripts/render-exchange-preview.py input.json output.jpg
Requires NumPy, Pillow, and DejaVu Sans. Bump maps, game shadows, and game
lighting are not reproduced; this is an offline geometry inspection image.
"""
import json
import math
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageColor
import re

source = sys.argv[1] if len(sys.argv) > 1 else '/tmp/emberwatch-exchange.json'
output = sys.argv[2] if len(sys.argv) > 2 else '/tmp/resource-exchange.jpg'
data = json.load(open(source))
W, H = 2400, 1450
canvas = Image.new('RGB', (W, H), '#131c22')
draw = ImageDraw.Draw(canvas)
regular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font = lambda size, strong=False: ImageFont.truetype(bold if strong else regular, size)
draw.text((68, 42), 'EMBERWATCH  /  THE RESOURCE EXCHANGE', font=font(31, True), fill='#f0e3c9')
draw.text((68, 89), 'Actual game building geometry  ·  Canvas sign commands rasterized offline  ·  Studio lighting', font=font(21), fill='#aebbc0')

def texture_image(source):
    im=Image.new('RGB',(source['width'],source['height']),'black')
    d=ImageDraw.Draw(im)
    for command in source['commands']:
        op,args,state=command['op'],command['args'],command['state']
        if op=='fillRect':
            x,y,w,h=args;d.rectangle((x,y,x+w,y+h),fill=state['fillStyle'])
        elif op=='strokeRect':
            x,y,w,h=args;d.rectangle((x,y,x+w,y+h),outline=state['strokeStyle'],width=round(state['lineWidth']))
        elif op=='fillText':
            text,x,y,*maximum=args
            size=int(re.search(r'(\d+)px',state['font']).group(1))
            f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',size)
            bounds=d.textbbox((0,0),text,font=f)
            tw,th=bounds[2]-bounds[0],bounds[3]-bounds[1]
            tile=Image.new('RGBA',(tw+2,th+2),(0,0,0,0));td=ImageDraw.Draw(tile)
            td.text((1-bounds[0],1-bounds[1]),text,font=f,fill=state['fillStyle'])
            if maximum and tile.width>maximum[0]:tile=tile.resize((round(maximum[0]),tile.height),Image.Resampling.LANCZOS)
            im.paste(tile,(round(x-tile.width/2),round(y-tile.height/2)),tile)
    pixels=np.asarray(im,dtype=np.float64)/255
    return np.where(pixels<=.04045,pixels/12.92,((pixels+.055)/1.055)**2.4)

textures={key:texture_image(source) for key,source in data.get('textures',{}).items()}

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
        if tri.get('texture') and tri.get('uv'):
            uv=np.asarray(tri['uv']);tex=textures[tri['texture']]
            value=a[mask,None]*uv[0]+b[mask,None]*uv[1]+c[mask,None]*uv[2]
            tx=np.clip(np.rint(value[:,0]*(tex.shape[1]-1)),0,tex.shape[1]-1).astype(int)
            ty=np.clip(np.rint((1-value[:,1])*(tex.shape[0]-1)),0,tex.shape[0]-1).astype(int)
            base*=tex[ty,tx]
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
    x, y = 56 + column * 1172, 153
    canvas.paste(render(panel, 1116, 1040), (x, y))
    draw.text((x + 20, y + 1060), panel['label'], font=font(22, True), fill='#eddfc7')
    draw.text((x + 20, y + 1096), panel['caption'], font=font(17), fill='#acb8bd')

draw.line((68, 1376, 2332, 1376), fill='#41515a', width=1)
draw.text((68, 1400), 'Geometry review only. Canvas font rasterization and studio lighting approximate the browser; game shadows require a live playtest.', font=font(18), fill='#aab8be')
canvas.save(output, quality=91, optimize=True, subsampling=0)
print(output)
