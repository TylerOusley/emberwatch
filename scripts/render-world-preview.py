"""Render actual indexed/instanced world geometry through offline Mesa EGL.

node scripts/preview-world.mjs /tmp/emberwatch-world.json
python scripts/render-world-preview.py /tmp/emberwatch-world.json docs/previews/world-build18.jpg

This is geometry/material inspection with separate studio lighting, not a game
screenshot. Local CC0 albedo/normal maps use the game's world triplanar math.
Gameplay sky, exposure, torches and animation are deliberately not reproduced.
Requires system EGL/OpenGL, Pillow and DejaVu Sans; no runtime dependency.
"""
import base64
import ctypes as C
import importlib.util
import json
import pathlib
import re
import sys
from PIL import Image, ImageDraw, ImageFont

spec=importlib.util.spec_from_file_location('sky_renderer',pathlib.Path(__file__).with_name('render-sky-preview.py'))
sky=importlib.util.module_from_spec(spec);spec.loader.exec_module(sky)

VERTEX='''#version 330
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec3 color;
layout(location=3) in vec2 uv;
layout(location=4) in mat4 instanceMatrix;
layout(location=8) in vec3 instanceColor;
uniform mat4 vp;
out vec3 worldPosition;
out vec3 worldNormal;
out vec3 vertexColor;
out vec2 texUV;
void main(){
 vec4 p=instanceMatrix*vec4(position,1.0);
 worldPosition=p.xyz;worldNormal=normalize(transpose(inverse(mat3(instanceMatrix)))*normal);
 vertexColor=color*instanceColor;texUV=uv;gl_Position=vp*p;
}
'''
DEPTH='''#version 330
void main(){}
'''
FRAGMENT='''#version 330
in vec3 worldPosition;
in vec3 worldNormal;
in vec3 vertexColor;
in vec2 texUV;
out vec4 pixel;
uniform vec3 baseColor,emissive,sunDirection,eye;
uniform mat4 lightVP;
uniform sampler2D albedoMap,normalMap,shadowMap,canvasMap;
uniform float textured,worldScale,colorStrength,normalStrength,vertexColors,hasCanvas,flatShading,roughness,metalness,opacity;
vec3 weights(vec3 n){vec3 w=pow(abs(n),vec3(4.0));return w/max(dot(w,vec3(1.0)),.00001);}
vec3 sampleSurface(sampler2D source,vec3 p,vec3 n,vec3 w){
 vec3 s=step(vec3(0.0),n)*2.0-1.0;
 return texture(source,vec2(-s.x*p.z,p.y)).rgb*w.x+texture(source,vec2(p.x,-s.y*p.z)).rgb*w.y+texture(source,vec2(s.z*p.x,p.y)).rgb*w.z;
}
vec3 gradient(vec3 p,vec3 n,vec3 w){
 vec3 s=step(vec3(0.0),n)*2.0-1.0;
 vec3 x=texture(normalMap,vec2(-s.x*p.z,p.y)).xyz*2.0-1.0;
 vec3 y=texture(normalMap,vec2(p.x,-s.y*p.z)).xyz*2.0-1.0;
 vec3 z=texture(normalMap,vec2(s.z*p.x,p.y)).xyz*2.0-1.0;
 x.xy/=max(x.z,.35);y.xy/=max(y.z,.35);z.xy/=max(z.z,.35);
 vec3 g=vec3(0,x.y,-s.x*x.x)*w.x+vec3(y.x,0,-s.y*y.y)*w.y+vec3(s.z*z.x,z.y,0)*w.z;
 return g-n*dot(g,n);
}
float shadow(vec3 n){
 vec4 q=lightVP*vec4(worldPosition,1.0);vec3 p=q.xyz/q.w*.5+.5;
 if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0)return 1.0;
 float bias=.00042+.00055*(1.0-max(dot(n,sunDirection),0.0)),sum=0.0;
 for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)sum+=(p.z-bias<texture(shadowMap,p.xy+vec2(x,y)/2048.0).r)?1.0:0.0;
 return sum/9.0;
}
vec3 aces(vec3 c){return clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.0,1.0);}
vec3 srgb(vec3 c){return mix(1.055*pow(c,vec3(1.0/2.4))-.055,c*12.92,lessThanEqual(c,vec3(.0031308)));}
void main(){
 vec3 n=normalize(worldNormal);if(flatShading>.5)n=normalize(cross(dFdx(worldPosition),dFdy(worldPosition)));
 if(!gl_FrontFacing)n=-n;
 vec3 c=baseColor*mix(vec3(1),vertexColor,vertexColors);
 if(textured>.5){vec3 w=weights(n),p=worldPosition/worldScale;c*=mix(vec3(1),sampleSurface(albedoMap,p,n,w),colorStrength);n=normalize(n+gradient(p,n,w)*normalStrength);}
 if(hasCanvas>.5)c*=texture(canvasMap,texUV).rgb;
 float direct=max(dot(n,sunDirection),0.0),visibility=shadow(n);
 vec3 ambient=mix(vec3(.24,.22,.18),vec3(.56,.64,.71),n.y*.5+.5);
 vec3 light=c*(ambient+vec3(1.66,1.53,1.29)*direct*visibility);
 vec3 v=normalize(eye-worldPosition),h=normalize(v+sunDirection);
 float specular=pow(max(dot(n,h),0.0),mix(10.0,100.0,1.0-roughness));
 light+=mix(vec3(.035),c,metalness)*specular*visibility*(1.0-roughness*.7)+emissive;
 float fog=1.0-exp(-length(eye-worldPosition)*.00105);
 light=mix(light,vec3(.47,.57,.64),fog);
 pixel=vec4(srgb(aces(light)),opacity);
}
'''

class WorldRenderer(sky.Renderer):
 def __init__(self,w,h):
  super().__init__(w,h);g=self.gl
  for name,result,args in [
   ('glGenBuffers',None,[C.c_int,C.POINTER(C.c_uint)]),('glBindBuffer',None,[C.c_uint,C.c_uint]),('glBufferData',None,[C.c_uint,C.c_ssize_t,C.c_void_p,C.c_uint]),
   ('glGenVertexArrays',None,[C.c_int,C.POINTER(C.c_uint)]),('glBindVertexArray',None,[C.c_uint]),('glVertexAttribDivisor',None,[C.c_uint,C.c_uint]),
   ('glDrawElementsInstanced',None,[C.c_uint,C.c_int,C.c_uint,C.c_void_p,C.c_int]),('glVertexAttrib3f',None,[C.c_uint,C.c_float,C.c_float,C.c_float]),('glVertexAttrib2f',None,[C.c_uint,C.c_float,C.c_float]),
   ('glGenFramebuffers',None,[C.c_int,C.POINTER(C.c_uint)]),('glBindFramebuffer',None,[C.c_uint,C.c_uint]),('glFramebufferTexture2D',None,[C.c_uint,C.c_uint,C.c_uint,C.c_uint,C.c_int]),('glCheckFramebufferStatus',C.c_uint,[C.c_uint]),('glDrawBuffer',None,[C.c_uint]),('glReadBuffer',None,[C.c_uint]),
   ('glCullFace',None,[C.c_uint]),('glDepthMask',None,[C.c_ubyte]),('glGenerateMipmap',None,[C.c_uint]),('glDepthFunc',None,[C.c_uint])]:self.bind(g,name,result,args)
  self.main=self.program(VERTEX,FRAGMENT);self.depth=self.program(VERTEX,DEPTH)
  self.colorFBO,self.colorTexture,self.colorDepth=self.framebuffer(w,h,True)
  self.shadowFBO,_,self.shadowTexture=self.framebuffer(2048,2048,False)
  self.maps={}
 def texture(self,width,height,pixels=None,srgb=False,depth=False):
  # Upload on an unused unit so first-use maps cannot replace the shadow map
  # already bound for a frame. Rendering binds every sampled unit explicitly.
  g=self.gl;g.glActiveTexture(0x84C0+7);ident=C.c_uint();g.glGenTextures(1,C.byref(ident));g.glBindTexture(0x0DE1,ident.value)
  for key,val in [(0x2801,0x2601),(0x2800,0x2601),(0x2802,0x812F if depth else 0x2901),(0x2803,0x812F if depth else 0x2901)]:g.glTexParameteri(0x0DE1,key,val)
  payload=C.create_string_buffer(pixels) if pixels else None
  g.glTexImage2D(0x0DE1,0,0x8CAC if depth else 0x8C43 if srgb else 0x8058,width,height,0,0x1902 if depth else 0x1908,0x1406 if depth else 0x1401,C.cast(payload,C.c_void_p) if payload else None)
  if pixels:g.glGenerateMipmap(0x0DE1);g.glTexParameteri(0x0DE1,0x2801,0x2703)
  return ident.value
 def framebuffer(self,w,h,color):
  g=self.gl;ident=C.c_uint();g.glGenFramebuffers(1,C.byref(ident));g.glBindFramebuffer(0x8D40,ident.value)
  colorID=self.texture(w,h) if color else None;depthID=self.texture(w,h,depth=True)
  g.glFramebufferTexture2D(0x8D40,0x8D00,0x0DE1,depthID,0)
  if color:g.glFramebufferTexture2D(0x8D40,0x8CE0,0x0DE1,colorID,0);g.glDrawBuffer(0x8CE0);g.glReadBuffer(0x8CE0)
  else:g.glDrawBuffer(0);g.glReadBuffer(0)
  if g.glCheckFramebufferStatus(0x8D40)!=0x8CD5:raise RuntimeError('Incomplete preview framebuffer')
  return ident.value,colorID,depthID
 def buffer(self,data,target=0x8892):
  g=self.gl;ident=C.c_uint();g.glGenBuffers(1,C.byref(ident));g.glBindBuffer(target,ident.value);payload=C.create_string_buffer(base64.b64decode(data));g.glBufferData(target,len(payload)-1,C.cast(payload,C.c_void_p),0x88E4);return ident.value
 def compile_geometry(self,data):
  return {'attributes':{key:{'buffer':self.buffer(attr['data']),'size':attr['size']} for key,attr in data['attributes'].items()},'index':self.buffer(data['index'],0x8893)}
 def compile_draw(self,item,geometry):
  g=self.gl;vao=C.c_uint();g.glGenVertexArrays(1,C.byref(vao));g.glBindVertexArray(vao.value)
  for index,key in enumerate(['position','normal','color','uv']):
   attr=geometry['attributes'].get(key)
   if attr:g.glBindBuffer(0x8892,attr['buffer']);g.glEnableVertexAttribArray(index);g.glVertexAttribPointer(index,attr['size'],0x1406,False,0,None)
  matrix=self.buffer(item['matrices'])
  for i in range(4):g.glEnableVertexAttribArray(4+i);g.glVertexAttribPointer(4+i,4,0x1406,False,64,C.c_void_p(i*16));g.glVertexAttribDivisor(4+i,1)
  colors=self.buffer(item['colors']);g.glEnableVertexAttribArray(8);g.glVertexAttribPointer(8,3,0x1406,False,0,None);g.glVertexAttribDivisor(8,1)
  g.glBindBuffer(0x8893,geometry['index']);return {**item,'vao':vao.value,'hasColor':'color' in geometry['attributes'],'hasUV':'uv' in geometry['attributes']}
 def bind_map(self,name,texture,unit):
  g=self.gl;g.glActiveTexture(0x84C0+unit);g.glBindTexture(0x0DE1,texture);g.glUniform1i(g.glGetUniformLocation(self.p,name.encode()),unit)
 def load_map(self,path,srgb):
  key=(str(path),srgb)
  if key not in self.maps:
   im=Image.open(path).convert('RGBA').transpose(Image.Transpose.FLIP_TOP_BOTTOM);self.maps[key]=self.texture(im.width,im.height,im.tobytes(),srgb=srgb)
  return self.maps[key]
 def draw_item(self,item,mat):
  g=self.gl;g.glBindVertexArray(item['vao'])
  if not item['hasColor']:g.glVertexAttrib3f(2,1,1,1)
  if not item['hasUV']:g.glVertexAttrib2f(3,0,0)
  if mat['side']==2:g.glDisable(0x0B44)
  else:g.glEnable(0x0B44);g.glCullFace(0x0404 if mat['side']==1 else 0x0405)
  g.glDrawElementsInstanced(4,item['length'],0x1405,C.c_void_p(item['offset']*4),item['count'])
 def render(self,frame,draws,materials,data,canvases):
  g=self.gl;g.glEnable(0x0B71);g.glDepthFunc(0x0203);g.glDepthMask(True);g.glDisable(0x0BE2)
  g.glBindFramebuffer(0x8D40,self.shadowFBO);g.glViewport(0,0,2048,2048);g.glClear(0x0100)
  g.glUseProgram(self.depth);self.p=self.depth;self.uniform('vp',frame['lightVP'])
  for item in draws:
   if item['castShadow'] and materials[item['material']]['opacity']>=1:self.draw_item(item,materials[item['material']])
  g.glBindFramebuffer(0x8D40,self.colorFBO);g.glViewport(0,0,self.w,self.h);g.glClearColor(.72,.80,.83,1);g.glClear(0x4000|0x0100)
  g.glUseProgram(self.main);self.p=self.main
  for key,value in {'vp':frame['vp'],'lightVP':frame['lightVP'],'eye':frame['eye'],'sunDirection':data['sun']}.items():self.uniform(key,value)
  self.bind_map('shadowMap',self.shadowTexture,2)
  for item in draws:
   mat=materials[item['material']];surface=mat['surface']
   for key,value in {'baseColor':mat['color'],'emissive':mat['emissive'],'vertexColors':int(mat['vertexColors']),'flatShading':int(mat['flat']),'roughness':mat['roughness'],'metalness':mat['metalness'],'opacity':mat['opacity'],'textured':int(bool(surface)),'hasCanvas':int(bool(mat['canvas']))}.items():self.uniform(key,value)
   if surface:
    for key in ['worldScale','colorStrength','normalStrength']:self.uniform(key,surface[key])
    for unit,role in enumerate(['albedo','normal']):self.bind_map(role+'Map',self.load_map(pathlib.Path(data['assetRoot'])/(surface['kind']+'-'+role+'.jpg'),role=='albedo'),unit)
   if mat['canvas']:self.bind_map('canvasMap',canvases[mat['canvas']],3)
   if mat['opacity']<1:g.glEnable(0x0BE2);g.glBlendFunc(0x0302,0x0303);g.glDepthMask(False)
   else:g.glDisable(0x0BE2);g.glDepthMask(True)
   self.draw_item(item,mat)
  return self.pixels()

def canvas_image(source):
 im=Image.new('RGBA',(source['width'],source['height']),(0,0,0,0));d=ImageDraw.Draw(im)
 for command in source['commands']:
  op,args,state=command['op'],command['args'],command['state']
  if op in ('fillRect','strokeRect'):
   x,y,w,h=args;rect=(x,y,x+w,y+h)
   if op=='fillRect':d.rectangle(rect,fill=state['fillStyle'])
   else:d.rectangle(rect,outline=state['strokeStyle'],width=max(1,round(state['lineWidth'])))
  elif op=='fillText':
   text,x,y,*maximum=args;size=int(re.search(r'(\d+)px',state['font']).group(1));font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',size)
   box=d.textbbox((0,0),text,font=font);tile=Image.new('RGBA',(box[2]-box[0]+2,box[3]-box[1]+2),(0,0,0,0));ImageDraw.Draw(tile).text((1-box[0],1-box[1]),text,font=font,fill=state['fillStyle'])
   if maximum and tile.width>maximum[0]:tile=tile.resize((round(maximum[0]),tile.height),Image.Resampling.LANCZOS)
   im.alpha_composite(tile,(round(x-tile.width/2),round(y-tile.height/2)))
 return im.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

def main():
 data=json.loads(pathlib.Path(sys.argv[1]).read_text());output=pathlib.Path(sys.argv[2]);output.parent.mkdir(parents=True,exist_ok=True)
 r=WorldRenderer(data['width'],data['height']);geometries=[r.compile_geometry(g) for g in data['geometries']];draws=[r.compile_draw(item,geometries[item['geometry']]) for item in data['draws']]
 draws.sort(key=lambda item:data['materials'][item['material']]['opacity']<1)
 canvases={}
 for key,source in data['canvases'].items():
  image=canvas_image(source);canvases[key]=r.texture(image.width,image.height,image.tobytes(),srgb=True)
 width,height=data['width'],data['height'];gap=24;header=100;caption=44
 sheet=Image.new('RGB',(width*2+gap*3,(height+caption)*2+gap*3+header),'#132128');draw=ImageDraw.Draw(sheet)
 font=lambda size:ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',size)
 draw.text((gap,20),'EMBERWATCH / WORLD ART • BUILD 18',font=font(32),fill='#f6e4bf')
 draw.text((gap,65),'Actual game geometry and local CC0 materials • offline studio lighting • not a gameplay screenshot',font=font(20),fill='#b6c9c9')
 for i,frame in enumerate(data['frames']):
  image=r.render(frame,draws,data['materials'],data,canvases);x=gap+(i%2)*(width+gap);y=header+gap+(i//2)*(height+caption+gap);sheet.paste(image,(x,y))
  titleWidth=draw.textlength(frame['label'],font=font(23))+36;draw.rounded_rectangle((x+14,y+14,x+14+titleWidth,y+56),radius=6,fill='#132128');draw.text((x+32,y+20),frame['label'],font=font(23),fill='#f2e4c9')
  draw.text((x+2,y+height+13),frame['caption'],font=font(17),fill='#b6c9c9');print('Rendered',frame['label'],flush=True)
 sheet.save(output,quality=94);print(output);print(json.dumps(data['stats']))

if __name__=='__main__':main()
