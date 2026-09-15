"""Execute exported runtime torch GLSL using surfaceless Mesa EGL/OpenGL.

python scripts/render-torch-preview.py /tmp/emberwatch-torches.json docs/previews/torches.jpg
Flames use the unchanged game shader body. Holder geometry uses offline studio
lighting. Requires system EGL/GL, Python Pillow, and render-sky-preview.py.
"""
import ctypes as C
import importlib.util
import json
import pathlib
import sys
from PIL import Image, ImageDraw, ImageFont, ImageChops, ImageStat

module_path = pathlib.Path(__file__).with_name('render-sky-preview.py')
spec = importlib.util.spec_from_file_location('emberwatch_egl_preview', module_path)
egl_preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(egl_preview)


class TorchRenderer(egl_preview.Renderer):
    def __init__(self, width, height):
        super().__init__(width, height)
        g = self.gl
        for name, result, args in [
            ('glGenFramebuffers', None, [C.c_int, C.POINTER(C.c_uint)]),
            ('glBindFramebuffer', None, [C.c_uint, C.c_uint]),
            ('glGenRenderbuffers', None, [C.c_int, C.POINTER(C.c_uint)]),
            ('glBindRenderbuffer', None, [C.c_uint, C.c_uint]),
            ('glRenderbufferStorage', None, [C.c_uint, C.c_uint, C.c_int, C.c_int]),
            ('glFramebufferRenderbuffer', None, [C.c_uint, C.c_uint, C.c_uint, C.c_uint]),
            ('glCheckFramebufferStatus', C.c_uint, [C.c_uint]),
            ('glDepthMask', None, [C.c_ubyte]),
            ('glDepthFunc', None, [C.c_uint]),
            ('glCullFace', None, [C.c_uint]),
            ('glUniformMatrix3fv', None, [C.c_int, C.c_int, C.c_ubyte, C.POINTER(C.c_float)]),
        ]:
            self.bind(g, name, result, args)
        self.fbo = C.c_uint()
        g.glGenFramebuffers(1, C.byref(self.fbo))
        g.glBindFramebuffer(0x8D40, self.fbo)
        # A real depth attachment ensures holders occlude their flames correctly.
        for attachment, storage in [(0x8CE0, 0x8058), (0x8D00, 0x81A6)]:
            buffer = C.c_uint()
            g.glGenRenderbuffers(1, C.byref(buffer))
            g.glBindRenderbuffer(0x8D41, buffer)
            g.glRenderbufferStorage(0x8D41, storage, width, height)
            g.glFramebufferRenderbuffer(0x8D40, attachment, 0x8D41, buffer)
        if g.glCheckFramebufferStatus(0x8D40) != 0x8CD5:
            raise RuntimeError('Torch preview framebuffer is incomplete')

    def uniform(self, name, value):
        loc = self.gl.glGetUniformLocation(self.p, name.encode())
        if loc < 0:
            return
        if isinstance(value, bool):
            self.gl.glUniform1i(loc, int(value))
        elif isinstance(value, list) and len(value) == 9:
            self.gl.glUniformMatrix3fv(loc, 1, False, (C.c_float * 9)(*value))
        else:
            super().uniform(name, value)

    def begin_frame(self, background):
        g = self.gl
        g.glBindFramebuffer(0x8D40, self.fbo)
        g.glViewport(0, 0, self.w, self.h)
        g.glDepthMask(True)
        g.glDepthFunc(0x0203)
        g.glEnable(0x0B71)
        g.glDisable(0x0B44)
        g.glEnable(0x8642)
        g.glClearColor(*background, 1)
        g.glClear(0x4000 | 0x0100)

    def draw_torch(self, mesh, uniforms):
        g = self.gl
        g.glDepthMask(mesh.get('depthWrite', True))
        if mesh.get('depthTest', True):
            g.glEnable(0x0B71)
        else:
            g.glDisable(0x0B71)
        if mesh.get('side', 2) == 2:
            g.glDisable(0x0B44)
        else:
            g.glEnable(0x0B44)
            g.glCullFace(0x0405 if mesh['side'] == 0 else 0x0404)
        # Base draw handles ordinary alpha blending, actual attributes and GLSL.
        self.draw(mesh, uniforms)


if __name__ == '__main__':
    data = json.loads(pathlib.Path(sys.argv[1]).read_text())
    output = pathlib.Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    renderer = TorchRenderer(data['width'], data['height'])
    meshes = {mesh['name']: mesh for mesh in data['meshes']}
    programs = {}
    for mesh in meshes.values():
        key = mesh['vertex'] + mesh['fragment']
        if key not in programs:
            programs[key] = renderer.program(mesh['vertex'], mesh['fragment'])
        mesh['program'] = programs[key]
    width, height = data['width'], data['height']
    gap, header, footer = 20, 100, 56
    sheet = Image.new('RGB', (2 * width + 3 * gap, 2 * height + header + 2 * gap + footer), '#121d23')
    draw = ImageDraw.Draw(sheet)
    regular = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
    title = ImageFont.truetype(bold, 26)
    label = ImageFont.truetype(bold, 20)
    small = ImageFont.truetype(regular, 16)
    draw.text((gap, 16), 'EMBERWATCH  /  LIVING TORCHLIGHT', font=title, fill='#f0deb9')
    draw.text((gap, 58), 'Actual runtime flame GLSL and holder geometry  ·  Mesa software OpenGL  ·  Fixed camera', font=small, fill='#aebfc3')
    results = []
    for index, frame in enumerate(data['frames']):
        renderer.begin_frame(frame['background'])
        for item in sorted(frame['meshes'], key=lambda item: meshes[item['name']].get('renderOrder', 0)):
            if item['visible']:
                renderer.draw_torch(meshes[item['name']], item['uniforms'])
        result = renderer.pixels()
        results.append(result)
        x, y = gap + (index % 2) * (width + gap), header + (index // 2) * (height + gap)
        sheet.paste(result, (x, y))
        draw.rounded_rectangle((x + 12, y + 12, x + width - 12, y + 51), radius=6, fill='#15262d')
        draw.text((x + 23, y + 19), frame['label'], font=label, fill='#f1e3c9')
        print('Rendered', frame['label'], flush=True)
    draw.text((gap, sheet.height - 42), 'Isolated holders with studio lighting. Flame shaders rendered directly; no browser performance claim.', font=small, fill='#aebfc3')
    sheet.save(output, quality=93, subsampling=0, optimize=True)
    if len(results) >= 4:
        delta = ImageStat.Stat(ImageChops.difference(results[2], results[3])).mean
        print('Nighttime frame RGB difference:', sum(delta) / len(delta))
    print(f'Compiled {len(programs)} shader programs. Saved {output}')
