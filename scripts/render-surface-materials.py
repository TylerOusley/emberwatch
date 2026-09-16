"""Render real exported Three PBR shaders/maps through an ES 3 EGL context.

Developer diagnostic, not a browser or production screenshot. Requires Mesa EGL
and Pillow. Geometry, lights, camera and material uniforms come from the JS export.
"""
import ctypes as C
import importlib.util
import json
import pathlib
import sys
from PIL import Image, ImageDraw, ImageFont

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('shader_compiler', pathlib.Path(__file__).with_name('compile-graphics-shaders.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SurfaceRenderer(module.ShaderCompiler):
    def __init__(self, width, height):
        super().__init__(width, height)
        self.width, self.height, self.textures = width, height, {}
        for name, result, args in [
            ('glGetError', C.c_uint, []), ('glUseProgram', None, [C.c_uint]),
            ('glGetUniformLocation', C.c_int, [C.c_uint, C.c_char_p]),
            ('glUniform1f', None, [C.c_int, C.c_float]), ('glUniform1i', None, [C.c_int, C.c_int]),
            ('glUniform3fv', None, [C.c_int, C.c_int, C.POINTER(C.c_float)]),
            ('glUniformMatrix3fv', None, [C.c_int, C.c_int, C.c_ubyte, C.POINTER(C.c_float)]),
            ('glUniformMatrix4fv', None, [C.c_int, C.c_int, C.c_ubyte, C.POINTER(C.c_float)]),
            ('glGenTextures', None, [C.c_int, C.POINTER(C.c_uint)]), ('glActiveTexture', None, [C.c_uint]),
            ('glBindTexture', None, [C.c_uint, C.c_uint]), ('glTexParameteri', None, [C.c_uint, C.c_uint, C.c_int]),
            ('glTexImage2D', None, [C.c_uint, C.c_int, C.c_int, C.c_int, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_void_p]),
            ('glGenerateMipmap', None, [C.c_uint]), ('glDeleteTextures', None, [C.c_int, C.POINTER(C.c_uint)]),
            ('glGenBuffers', None, [C.c_int, C.POINTER(C.c_uint)]), ('glBindBuffer', None, [C.c_uint, C.c_uint]),
            ('glBufferData', None, [C.c_uint, C.c_size_t, C.c_void_p, C.c_uint]), ('glDeleteBuffers', None, [C.c_int, C.POINTER(C.c_uint)]),
            ('glGetAttribLocation', C.c_int, [C.c_uint, C.c_char_p]), ('glEnableVertexAttribArray', None, [C.c_uint]),
            ('glDisableVertexAttribArray', None, [C.c_uint]), ('glVertexAttrib4fv', None, [C.c_uint, C.POINTER(C.c_float)]),
            ('glVertexAttribPointer', None, [C.c_uint, C.c_int, C.c_uint, C.c_ubyte, C.c_int, C.c_void_p]),
            ('glDrawElements', None, [C.c_uint, C.c_int, C.c_uint, C.c_void_p]),
            ('glViewport', None, [C.c_int, C.c_int, C.c_int, C.c_int]), ('glClearColor', None, [C.c_float, C.c_float, C.c_float, C.c_float]),
            ('glClear', None, [C.c_uint]), ('glEnable', None, [C.c_uint]),
            ('glReadPixels', None, [C.c_int, C.c_int, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_void_p]), ('glFinish', None, [])
        ]:
            address = self.egl.eglGetProcAddress(name.encode())
            if not address:
                raise RuntimeError(f'Missing GL function {name}')
            setattr(self.gl, name, C.CFUNCTYPE(result, *args)(address))

    def link(self, item):
        shaders = [self.shader(item[key], kind, key) for key, kind in [('vertex', 0x8B31), ('fragment', 0x8B30)]]
        g = self.gl
        self.program_id = g.glCreateProgram()
        for shader in shaders:
            g.glAttachShader(self.program_id, shader)
        g.glLinkProgram(self.program_id)
        success = C.c_int()
        g.glGetProgramiv(self.program_id, 0x8B82, C.byref(success))
        for shader in shaders:
            g.glDeleteShader(shader)
        if not success.value:
            raise RuntimeError(self.diagnostic(self.program_id, shader=False))
        g.glUseProgram(self.program_id)

    def uniform(self, name, value):
        g = self.gl
        location = g.glGetUniformLocation(self.program_id, name.encode())
        if location < 0:
            return
        if isinstance(value, dict):
            if 'integer' in value:
                g.glUniform1i(location, value['integer'])
                return
            key = (value['texture'], bool(value.get('srgb')))
            unit = value['unit']
            g.glActiveTexture(0x84C0 + unit)
            if key not in self.textures:
                image = Image.open(key[0]).convert('RGBA').transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                texture = C.c_uint()
                g.glGenTextures(1, C.byref(texture))
                g.glBindTexture(0x0DE1, texture.value)
                for parameter, setting in [(0x2801, 0x2703), (0x2800, 0x2601), (0x2802, 0x2901), (0x2803, 0x2901)]:
                    g.glTexParameteri(0x0DE1, parameter, setting)
                pixels = C.create_string_buffer(image.tobytes())
                # Match Three's WebGLTextures: SRGB8_ALPHA8 for albedo only.
                g.glTexImage2D(0x0DE1, 0, 0x8C43 if key[1] else 0x8058, image.width, image.height, 0, 0x1908, 0x1401, pixels)
                g.glGenerateMipmap(0x0DE1)
                self.textures[key] = texture.value
            g.glBindTexture(0x0DE1, self.textures[key])
            g.glUniform1i(location, unit)
        elif isinstance(value, (int, float)):
            g.glUniform1f(location, value)
        else:
            array = (C.c_float * len(value))(*value)
            if len(value) == 16:
                g.glUniformMatrix4fv(location, 1, False, array)
            elif len(value) == 9:
                g.glUniformMatrix3fv(location, 1, False, array)
            else:
                g.glUniform3fv(location, 1, array)

    def render(self, mesh, uniforms):
        g = self.gl
        g.glViewport(0, 0, self.width, self.height)
        g.glEnable(0x0B71)
        g.glClearColor(.047, .075, .09, 1)
        g.glClear(0x4000 | 0x0100)
        for name, value in uniforms.items():
            self.uniform(name, value)
        buffers, locations = [], []
        for name, attribute in mesh['attributes'].items():
            location = g.glGetAttribLocation(self.program_id, name.encode())
            if location < 0:
                continue
            values = (C.c_float * len(attribute['values']))(*attribute['values'])
            buffer = C.c_uint()
            g.glGenBuffers(1, C.byref(buffer))
            buffers.append(buffer)
            g.glBindBuffer(0x8892, buffer.value)
            g.glBufferData(0x8892, C.sizeof(values), values, 0x88E4)
            g.glEnableVertexAttribArray(location)
            g.glVertexAttribPointer(location, attribute['size'], 0x1406, False, 0, None)
            locations.append(location)
        location = g.glGetAttribLocation(self.program_id, b'instanceMatrix')
        for column in range(4):
            g.glDisableVertexAttribArray(location + column)
            values = (C.c_float * 4)(*mesh['instanceMatrix'][column * 4:column * 4 + 4])
            g.glVertexAttrib4fv(location + column, values)
        indices = (C.c_uint * len(mesh['index']))(*mesh['index'])
        buffer = C.c_uint()
        g.glGenBuffers(1, C.byref(buffer))
        buffers.append(buffer)
        g.glBindBuffer(0x8893, buffer.value)
        g.glBufferData(0x8893, C.sizeof(indices), indices, 0x88E4)
        g.glDrawElements(4, len(indices), 0x1405, None)
        for location in locations:
            g.glDisableVertexAttribArray(location)
        for buffer in buffers:
            g.glDeleteBuffers(1, C.byref(buffer))
        g.glFinish()
        pixels = (C.c_ubyte * (self.width * self.height * 4))()
        g.glReadPixels(0, 0, self.width, self.height, 0x1908, 0x1401, pixels)
        error = g.glGetError()
        if error:
            raise RuntimeError(f'GL render error {hex(error)}')
        return Image.frombytes('RGBA', (self.width, self.height), bytes(pixels)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')


def main():
    data = json.loads(pathlib.Path(sys.argv[1]).read_text())
    output = pathlib.Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    width, height, gap, header, footer = data['width'], data['height'], 12, 106, 52
    renderer = SurfaceRenderer(width, height)
    try:
        renderer.link(data['program'])
        sheet = Image.new('RGB', (width * len(data['frames']) + gap * (len(data['frames']) + 1), header + height * 2 + gap * 2 + footer), '#0c1317')
        draw = ImageDraw.Draw(sheet)
        font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
        title, label, small = [ImageFont.truetype(font, size) for size in [26, 19, 16]]
        draw.text((gap, 14), 'EMBERWATCH / REAL PBR MATERIAL DIAGNOSTIC', font=title, fill='#eed6ae')
        draw.text((gap, 51), 'Actual Three.js shader + 1K albedo / normal / roughness textures. Curved surface above; nonuniformly scaled instance below.', font=small, fill='#b8c8ce')
        for column, frame in enumerate(data['frames']):
            x = gap + column * (width + gap)
            draw.text((x + 8, 81), frame['kind'].upper(), font=label, fill='#eed6ae')
            for row, mesh in enumerate(data['meshes']):
                image = renderer.render(mesh, frame['uniforms'])
                sheet.paste(image, (x, header + row * (height + gap)))
        draw.text((gap, sheet.height - 41), f"{renderer.version} / {renderer.renderer}", font=small, fill='#b8c8ce')
        draw.text((gap, sheet.height - 20), 'Software ES render under a neutral daylight rig; not a gameplay screenshot or device performance measurement.', font=small, fill='#b8c8ce')
        sheet.save(output, quality=94)
        print(json.dumps({'output': str(output), 'renderer': renderer.renderer, 'materials': len(data['frames']), 'renders': len(data['frames']) * len(data['meshes'])}))
    finally:
        renderer.close()


if __name__ == '__main__':
    main()
