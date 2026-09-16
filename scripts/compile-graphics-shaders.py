"""Compile/link exported runtime GLSL ES 3 with a real surfaceless EGL context.

Input is a JSON bundle on stdin, or one filename argument. No shader rewriting,
browser, game process, or production data is involved. Requires libEGL with
OpenGL ES 3; reports unsupported environments as failures rather than passes.
"""
import ctypes as C
import ctypes.util
import json
import pathlib
import re
import sys
from types import SimpleNamespace


class ShaderCompiler:
    def bind(self, library, name, result, arguments):
        function = getattr(library, name)
        function.restype = result
        function.argtypes = arguments
        return function

    def __init__(self, width=1, height=1):
        self.display = self.surface = self.context = None
        egl_library = ctypes.util.find_library('EGL')
        if not egl_library:
            raise RuntimeError('The system EGL library is unavailable.')
        self.egl = C.CDLL(egl_library)
        e = self.egl
        self.bind(e, 'eglGetProcAddress', C.c_void_p, [C.c_char_p])
        address = e.eglGetProcAddress(b'eglGetPlatformDisplayEXT')
        if not address:
            raise RuntimeError('EGL platform display extension is unavailable.')
        platform = C.CFUNCTYPE(C.c_void_p, C.c_uint, C.c_void_p, C.POINTER(C.c_int))(address)
        self.display = platform(0x31DD, None, None)  # EGL_PLATFORM_SURFACELESS_MESA
        for name, result, arguments in [
            ('eglInitialize', C.c_uint, [C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_int)]),
            ('eglBindAPI', C.c_uint, [C.c_uint]),
            ('eglChooseConfig', C.c_uint, [C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_void_p), C.c_int, C.POINTER(C.c_int)]),
            ('eglCreatePbufferSurface', C.c_void_p, [C.c_void_p, C.c_void_p, C.POINTER(C.c_int)]),
            ('eglCreateContext', C.c_void_p, [C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_int)]),
            ('eglMakeCurrent', C.c_uint, [C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p]),
            ('eglDestroySurface', C.c_uint, [C.c_void_p, C.c_void_p]),
            ('eglDestroyContext', C.c_uint, [C.c_void_p, C.c_void_p]),
            ('eglTerminate', C.c_uint, [C.c_void_p]),
        ]:
            self.bind(e, name, result, arguments)
        if not e.eglInitialize(self.display, None, None):
            raise RuntimeError('Surfaceless EGL initialization failed.')
        if not e.eglBindAPI(0x30A0):  # EGL_OPENGL_ES_API
            raise RuntimeError('OpenGL ES is unavailable in EGL.')
        attributes = (C.c_int * 15)(0x3033, 1, 0x3040, 0x40, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3025, 24, 0x3038)
        config, count = C.c_void_p(), C.c_int()
        if not e.eglChooseConfig(self.display, attributes, C.byref(config), 1, C.byref(count)) or not count.value:
            raise RuntimeError('No EGL OpenGL ES 3 pbuffer configuration.')
        self.surface = e.eglCreatePbufferSurface(self.display, config, (C.c_int * 5)(0x3057, width, 0x3056, height, 0x3038))
        self.context = e.eglCreateContext(self.display, config, None, (C.c_int * 3)(0x3098, 3, 0x3038))
        if not self.surface or not self.context or not e.eglMakeCurrent(self.display, self.surface, self.surface, self.context):
            raise RuntimeError('Cannot create a current EGL OpenGL ES 3 context.')
        # Mesa can expose ES through EGL without a separate libGLESv2 package.
        # Obtain the actual context's entry points instead of accidentally
        # calling CDLL(None) when find_library returns None.
        self.gl = SimpleNamespace()
        g = self.gl
        for name, result, arguments in [
            ('glGetString', C.c_char_p, [C.c_uint]),
            ('glCreateShader', C.c_uint, [C.c_uint]),
            ('glShaderSource', None, [C.c_uint, C.c_int, C.POINTER(C.c_char_p), C.POINTER(C.c_int)]),
            ('glCompileShader', None, [C.c_uint]),
            ('glGetShaderiv', None, [C.c_uint, C.c_uint, C.POINTER(C.c_int)]),
            ('glGetShaderInfoLog', None, [C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_char_p]),
            ('glDeleteShader', None, [C.c_uint]),
            ('glCreateProgram', C.c_uint, []),
            ('glAttachShader', None, [C.c_uint, C.c_uint]),
            ('glLinkProgram', None, [C.c_uint]),
            ('glGetProgramiv', None, [C.c_uint, C.c_uint, C.POINTER(C.c_int)]),
            ('glGetProgramInfoLog', None, [C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_char_p]),
            ('glDeleteProgram', None, [C.c_uint]),
        ]:
            address = e.eglGetProcAddress(name.encode())
            if not address:
                raise RuntimeError(f'OpenGL ES entry point {name} is unavailable.')
            setattr(g, name, C.CFUNCTYPE(result, *arguments)(address))
        self.renderer = g.glGetString(0x1F01).decode()
        self.version = g.glGetString(0x1F02).decode()
        self.shading_language = g.glGetString(0x8B8C).decode()

    def diagnostic(self, ident, shader=True):
        length = C.c_int()
        query = self.gl.glGetShaderiv if shader else self.gl.glGetProgramiv
        log = self.gl.glGetShaderInfoLog if shader else self.gl.glGetProgramInfoLog
        query(ident, 0x8B84, C.byref(length))  # GL_INFO_LOG_LENGTH
        buffer = C.create_string_buffer(max(1, length.value))
        log(ident, len(buffer), None, buffer)
        return buffer.value.decode(errors='replace').strip()

    def shader(self, source, kind, name):
        shader = self.gl.glCreateShader(kind)
        value = C.c_char_p(source.encode())
        self.gl.glShaderSource(shader, 1, C.byref(value), None)
        self.gl.glCompileShader(shader)
        success = C.c_int()
        self.gl.glGetShaderiv(shader, 0x8B81, C.byref(success))
        if not success.value:
            detail = self.diagnostic(shader)
            matches = re.findall(r'(?:ERROR:\s*)?0[:(](\d+)', detail)
            excerpt = ''
            if matches:
                line = int(matches[0]); lines = source.splitlines()
                excerpt = '\n' + '\n'.join(f'{index + 1}: {lines[index]}' for index in range(max(0, line - 4), min(len(lines), line + 3)))
            self.gl.glDeleteShader(shader)
            raise RuntimeError(f'{name} compile failed:\n{detail}{excerpt}')
        return shader

    def program(self, item):
        shaders = []
        program = None
        try:
            for stage, kind in [('vertex', 0x8B31), ('fragment', 0x8B30)]:
                shaders.append(self.shader(item[stage], kind, f'{item["name"]} {stage}'))
            program = self.gl.glCreateProgram()
            for shader in shaders:
                self.gl.glAttachShader(program, shader)
            self.gl.glLinkProgram(program)
            success = C.c_int()
            self.gl.glGetProgramiv(program, 0x8B82, C.byref(success))
            if not success.value:
                raise RuntimeError(f'{item["name"]} link failed:\n{self.diagnostic(program, shader=False)}')
            return {'name': item['name'], 'compiled': True, 'linked': True, 'hashes': item.get('hashes')}
        finally:
            if program:
                self.gl.glDeleteProgram(program)
            for shader in shaders:
                self.gl.glDeleteShader(shader)

    def close(self):
        if self.display:
            self.egl.eglMakeCurrent(self.display, None, None, None)
            if self.context:
                self.egl.eglDestroyContext(self.display, self.context)
            if self.surface:
                self.egl.eglDestroySurface(self.display, self.surface)
            self.egl.eglTerminate(self.display)


def main():
    bundle = json.loads(pathlib.Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else sys.stdin.read())
    compiler = ShaderCompiler()
    try:
        results = []
        for item in bundle['programs']:
            try:
                results.append(compiler.program(item))
            except RuntimeError as error:
                results.append({'name': item['name'], 'compiled': False, 'linked': False, 'error': str(error)})
        report = {'renderer': compiler.renderer, 'version': compiler.version, 'shadingLanguage': compiler.shading_language, 'threeRevision': bundle.get('threeRevision'), 'runtimeHashes': bundle.get('runtimeHashes'), 'programs': results}
        print(json.dumps(report, indent=2))
        return 0 if results and all(row['linked'] for row in results) else 1
    finally:
        compiler.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
