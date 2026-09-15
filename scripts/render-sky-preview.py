# Render exported Emberwatch sky shaders through Mesa EGL/OpenGL (not a browser screenshot).
# python scripts/render-sky-preview.py /tmp/emberwatch-sky.json docs/previews/sky-cycle.jpg
# Development-only dependencies: system EGL/GL plus Python Pillow. No game dependency.
import ctypes as C, ctypes.util as U, re
class Renderer:
 def __init__(self,w,h):
  self.w,self.h=w,h
  self.egl=C.CDLL(U.find_library('EGL'));e=self.egl
  self.bind(e,'eglGetProcAddress',C.c_void_p,[C.c_char_p])
  platform=C.CFUNCTYPE(C.c_void_p,C.c_uint,C.c_void_p,C.POINTER(C.c_int))(e.eglGetProcAddress(b'eglGetPlatformDisplayEXT'))
  self.display=platform(0x31DD,None,None)
  self.bind(e,'eglInitialize',C.c_uint,[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_int)])
  if not e.eglInitialize(self.display,None,None):raise RuntimeError('Surfaceless EGL unavailable')
  self.bind(e,'eglBindAPI',C.c_uint,[C.c_uint]);e.eglBindAPI(0x30A2)
  self.bind(e,'eglChooseConfig',C.c_uint,[C.c_void_p,C.POINTER(C.c_int),C.POINTER(C.c_void_p),C.c_int,C.POINTER(C.c_int)])
  attrs=(C.c_int*13)(0x3033,1,0x3040,8,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3038);cfg=C.c_void_p();num=C.c_int()
  if not e.eglChooseConfig(self.display,attrs,C.byref(cfg),1,C.byref(num)) or not num.value:raise RuntimeError('No EGL pbuffer config')
  self.bind(e,'eglCreatePbufferSurface',C.c_void_p,[C.c_void_p,C.c_void_p,C.POINTER(C.c_int)])
  self.surface=e.eglCreatePbufferSurface(self.display,cfg,(C.c_int*5)(0x3057,w,0x3056,h,0x3038))
  self.bind(e,'eglCreateContext',C.c_void_p,[C.c_void_p,C.c_void_p,C.c_void_p,C.POINTER(C.c_int)])
  self.context=e.eglCreateContext(self.display,cfg,None,(C.c_int*1)(0x3038))
  self.bind(e,'eglMakeCurrent',C.c_uint,[C.c_void_p,C.c_void_p,C.c_void_p,C.c_void_p])
  if not self.context or not self.surface or not e.eglMakeCurrent(self.display,self.surface,self.surface,self.context):raise RuntimeError('No current EGL context')
  self.gl=C.CDLL(U.find_library('GL'));g=self.gl
  for name,restype,args in [
   ('glGetString',C.c_char_p,[C.c_uint]),('glGetError',C.c_uint,[]),
   ('glCreateShader',C.c_uint,[C.c_uint]),('glShaderSource',None,[C.c_uint,C.c_int,C.POINTER(C.c_char_p),C.POINTER(C.c_int)]),('glCompileShader',None,[C.c_uint]),
   ('glGetShaderiv',None,[C.c_uint,C.c_uint,C.POINTER(C.c_int)]),('glGetShaderInfoLog',None,[C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_char_p]),
   ('glCreateProgram',C.c_uint,[]),('glAttachShader',None,[C.c_uint,C.c_uint]),('glLinkProgram',None,[C.c_uint]),('glGetProgramiv',None,[C.c_uint,C.c_uint,C.POINTER(C.c_int)]),('glGetProgramInfoLog',None,[C.c_uint,C.c_int,C.POINTER(C.c_int),C.c_char_p]),
   ('glUseProgram',None,[C.c_uint]),('glGetUniformLocation',C.c_int,[C.c_uint,C.c_char_p]),('glUniform1f',None,[C.c_int,C.c_float]),('glUniform1i',None,[C.c_int,C.c_int]),('glUniform2fv',None,[C.c_int,C.c_int,C.POINTER(C.c_float)]),('glUniform3fv',None,[C.c_int,C.c_int,C.POINTER(C.c_float)]),('glUniform4fv',None,[C.c_int,C.c_int,C.POINTER(C.c_float)]),('glUniformMatrix4fv',None,[C.c_int,C.c_int,C.c_ubyte,C.POINTER(C.c_float)]),
   ('glGetAttribLocation',C.c_int,[C.c_uint,C.c_char_p]),('glEnableVertexAttribArray',None,[C.c_uint]),('glVertexAttribPointer',None,[C.c_uint,C.c_int,C.c_uint,C.c_ubyte,C.c_int,C.c_void_p]),('glDrawElements',None,[C.c_uint,C.c_int,C.c_uint,C.c_void_p]),
   ('glDrawArrays',None,[C.c_uint,C.c_int,C.c_int]),('glEnable',None,[C.c_uint]),('glBlendFunc',None,[C.c_uint,C.c_uint]),('glDisableVertexAttribArray',None,[C.c_uint]),
   ('glViewport',None,[C.c_int,C.c_int,C.c_int,C.c_int]),('glClearColor',None,[C.c_float,C.c_float,C.c_float,C.c_float]),('glClear',None,[C.c_uint]),('glReadPixels',None,[C.c_int,C.c_int,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_void_p]),('glFinish',None,[]),('glDisable',None,[C.c_uint])]:self.bind(g,name,restype,args)
  print('Render engine:',g.glGetString(0x1F01).decode())
 def bind(self,lib,name,result,args):
  fn=getattr(lib,name);fn.restype=result;fn.argtypes=args;return fn
 def shader(self,source,kind):
  source=re.sub(r'\bprecision\s+(?:highp|mediump|lowp)\s+\w+\s*;', '', source)
  source=re.sub(r'\b(?:highp|mediump|lowp)\s+', '', source)
  ident=self.gl.glCreateShader(kind); encoded=source.encode();cp=C.c_char_p(encoded)
  self.gl.glShaderSource(ident,1,C.byref(cp),None);self.gl.glCompileShader(ident)
  ok=C.c_int();self.gl.glGetShaderiv(ident,0x8B81,C.byref(ok))
  if not ok.value:
   buf=C.create_string_buffer(16384);self.gl.glGetShaderInfoLog(ident,len(buf),None,buf);raise RuntimeError(buf.value.decode())
  return ident
 def program(self,vertex,fragment):
  g=self.gl;p=g.glCreateProgram()
  g.glAttachShader(p,self.shader(vertex,0x8B31));g.glAttachShader(p,self.shader(fragment,0x8B30));g.glLinkProgram(p)
  ok=C.c_int();g.glGetProgramiv(p,0x8B82,C.byref(ok))
  if not ok.value:
   buf=C.create_string_buffer(16384);g.glGetProgramInfoLog(p,len(buf),None,buf);raise RuntimeError(buf.value.decode())
  g.glUseProgram(p);self.p=p;return p
 def uniform(self,name,v):
  loc=self.gl.glGetUniformLocation(self.p,name.encode())
  if loc<0:return
  if isinstance(v,(int,float)):self.gl.glUniform1f(loc,v);return
  values=(C.c_float*len(v))(*v)
  if len(v)==16:self.gl.glUniformMatrix4fv(loc,1,False,values)
  else:getattr(self.gl,'glUniform%sfv'%len(v))(loc,1,values)
 def begin(self):
  g=self.gl;g.glViewport(0,0,self.w,self.h);g.glDisable(0x0B71);g.glDisable(0x0B44);g.glEnable(0x8642);g.glClearColor(0,0,0,1);g.glClear(0x4000)
 def draw(self,mesh,uniforms):
  g=self.gl;g.glUseProgram(mesh['program']);self.p=mesh['program']
  for name,v in uniforms.items():self.uniform(name,v)
  if mesh['transparent']:g.glEnable(0x0BE2);g.glBlendFunc(0x0302,0x0303)
  else:g.glDisable(0x0BE2)
  arrays=[];locations=[]
  for name,attr in mesh['attributes'].items():
   loc=g.glGetAttribLocation(self.p,name.encode())
   if loc<0:continue
   array=(C.c_float*len(attr['values']))(*attr['values']);arrays.append(array);locations.append(loc)
   g.glEnableVertexAttribArray(loc);g.glVertexAttribPointer(loc,attr['size'],0x1406,False,0,C.cast(array,C.c_void_p))
  if mesh['index']:
   ix=(C.c_uint*len(mesh['index']))(*mesh['index']);g.glDrawElements(4,len(ix),0x1405,C.cast(ix,C.c_void_p))
  else:g.glDrawArrays(0 if mesh['points'] else 4,0,len(mesh['attributes']['position']['values'])//3)
  for loc in locations:g.glDisableVertexAttribArray(loc)
 def pixels(self):
  from PIL import Image
  g=self.gl;g.glFinish();pixels=(C.c_ubyte*(self.w*self.h*4))();g.glReadPixels(0,0,self.w,self.h,0x1908,0x1401,C.cast(pixels,C.c_void_p))
  err=g.glGetError()
  if err:raise RuntimeError(f'OpenGL error {hex(err)}')
  return Image.frombytes('RGBA',(self.w,self.h),bytes(pixels)).transpose(Image.Transpose.FLIP_TOP_BOTTOM).convert('RGB')

if __name__=='__main__':
 import json,sys,pathlib
 from PIL import Image,ImageDraw,ImageFont
 data=json.loads(pathlib.Path(sys.argv[1]).read_text());output=pathlib.Path(sys.argv[2]);output.parent.mkdir(parents=True,exist_ok=True)
 r=Renderer(data['width'],data['height']);by_name={mesh['name']:mesh for mesh in data['meshes']}
 for mesh in data['meshes']:
  mesh['program']=r.program(mesh['vertex'],mesh['fragment']);print('Compiled',mesh['name'])
 gap=18;header=82;footer=36;w=data['width'];h=data['height'];sheet=Image.new('RGB',(w*2+gap*3,h*2+header+gap*2+footer),'#101c22');draw=ImageDraw.Draw(sheet)
 fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
 title=ImageFont.truetype(fontpath,25);label=ImageFont.truetype(fontpath,22);small=ImageFont.truetype(fontpath,15)
 draw.text((gap,16),'EMBERWATCH / LIVING SKY',font=title,fill='#f6ddb0')
 draw.text((gap,49),'Actual game geometry and shaders • software OpenGL phase preview',font=small,fill='#b7c9ca')
 for i,frame in enumerate(data['frames']):
  r.begin()
  for item in sorted(frame['meshes'],key=lambda item:by_name[item['name']]['renderOrder']):
   if item['visible']:r.draw(by_name[item['name']],item['uniforms'])
  image=r.pixels();x=gap+(i%2)*(w+gap);y=header+(i//2)*(h+gap);sheet.paste(image,(x,y))
  draw.rounded_rectangle((x+12,y+12,x+230,y+48),radius=7,fill='#102027');draw.text((x+24,y+16),frame['label'],font=label,fill='#f2e8cb')
  print('Rendered',frame['label'])
 draw.text((gap,sheet.height-24),'Sky-only validation view; no world geometry. Camera faces the sun or moon at each phase.',font=small,fill='#b7c9ca')
 sheet.save(output,quality=92);print(output)
