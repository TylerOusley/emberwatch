# Real blade/ribbon geometry and actual ribbon GLSL via software OpenGL.
# Model lighting is a preview approximation; this is not browser gameplay.
import ctypes as C, importlib.util,json,pathlib,sys
from PIL import Image,ImageDraw,ImageFont
spec=importlib.util.spec_from_file_location('sky_renderer',pathlib.Path(__file__).with_name('render-sky-preview.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
data=json.loads(pathlib.Path(sys.argv[1]).read_text());w,h=data['width'],data['height'];r=module.Renderer(w,h);g=r.gl
# Supply a depth attachment: the generic sky renderer's pbuffer has none.
for name,args in [('glGenFramebuffers',[C.c_int,C.POINTER(C.c_uint)]),('glBindFramebuffer',[C.c_uint,C.c_uint]),('glGenRenderbuffers',[C.c_int,C.POINTER(C.c_uint)]),('glBindRenderbuffer',[C.c_uint,C.c_uint]),('glRenderbufferStorage',[C.c_uint,C.c_uint,C.c_int,C.c_int]),('glFramebufferRenderbuffer',[C.c_uint,C.c_uint,C.c_uint,C.c_uint]),('glDepthMask',[C.c_ubyte])]:r.bind(g,name,None,args)
fbo=C.c_uint();g.glGenFramebuffers(1,C.byref(fbo));g.glBindFramebuffer(0x8D40,fbo)
for attachment,format in [(0x8CE0,0x8058),(0x8D00,0x81A6)]:
 rb=C.c_uint();g.glGenRenderbuffers(1,C.byref(rb));g.glBindRenderbuffer(0x8D41,rb);g.glRenderbufferStorage(0x8D41,format,w,h);g.glFramebufferRenderbuffer(0x8D40,attachment,0x8D41,rb)
programs={};gap=18;header=84;sheet=Image.new('RGB',(w*2+gap*3,h*2+header+gap*2+40),'#111d23');d=ImageDraw.Draw(sheet)
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';title=ImageFont.truetype(font,25);small=ImageFont.truetype(font,15);label=ImageFont.truetype(font,22)
d.text((gap,16),'EMBERWATCH / SWORD SWEEP',font=title,fill='#f6ddb0');d.text((gap,49),'Actual articulated blade path and ribbon shader / software OpenGL preview',font=small,fill='#b7c9ca')
for i,frame in enumerate(data['frames']):
 r.begin();g.glEnable(0x0B71);g.glDepthMask(True);g.glClearColor(.043,.067,.078,1);g.glClear(0x4000|0x0100)
 for mesh in frame['meshes']:
  key=(mesh['vertex'],mesh['fragment'])
  if key not in programs:programs[key]=r.program(*key)
  mesh['program']=programs[key];g.glDepthMask(not mesh['transparent']);r.draw(mesh,mesh['uniforms'])
 image=r.pixels();x=gap+i%2*(w+gap);y=header+i//2*(h+gap);sheet.paste(image,(x,y));d.text((x+14,y+14),frame['label'],font=label,fill='#f2e8cb')
d.text((gap,sheet.height-26),'Model lighting is approximate. The faint trail lasts 0.16 seconds and never affects hits.',font=small,fill='#b7c9ca')
output=pathlib.Path(sys.argv[2]);output.parent.mkdir(parents=True,exist_ok=True);sheet.save(output,quality=92);print(output)
