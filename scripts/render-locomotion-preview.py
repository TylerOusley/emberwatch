"""Render an actual indexed mesh animation exported by preview-locomotion.mjs.

python scripts/render-locomotion-preview.py /tmp/emberwatch-locomotion output.mp4
  --title 'EMBERWATCH / MOVEMENT' [--gif] [--width 960] [--height 600]

Requires NumPy, Pillow, ffmpeg, and a C compiler. A small local rasterizer is
compiled in a temporary folder for speed; no OpenGL or network service is used.
The fixed studio camera and lighting expose the deformed model accurately.
Game shadows, textures, and postprocessing require an in-game WebGL playtest.
"""
import argparse
import ctypes
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

PARSER=argparse.ArgumentParser(description=__doc__)
PARSER.add_argument('input',type=Path)
PARSER.add_argument('output',type=Path)
PARSER.add_argument('--title',default='EMBERWATCH / MOVEMENT')
PARSER.add_argument('--gif',action='store_true')
PARSER.add_argument('--width',type=int,default=960)
PARSER.add_argument('--height',type=int,default=600)
PARSER.add_argument('--contact-seconds',type=float,default=.7,help='Timespan covered by the four contact-sheet frames.')
ARGS=PARSER.parse_args()
if ARGS.width<320 or ARGS.height<240 or ARGS.width%2 or ARGS.height%2:
    PARSER.error('Width and height must be even and at least 320 by 240.')
START=time.monotonic()
DATA=json.loads((ARGS.input/'manifest.json').read_text())
INDEX=np.fromfile(ARGS.input/'indices.u32',dtype='<u4').reshape(-1,3)
COLORS=np.fromfile(ARGS.input/'colors.f32',dtype='<f4').reshape(-1,3)
MATERIALS=np.fromfile(ARGS.input/'materials.f32',dtype='<f4').reshape(-1,12)
W,H=ARGS.width,ARGS.height
SCALE=H*.285
CAMERAS=[(-.6,'THREE QUARTER'),(-math.pi/2,'SIDE')]

# Barycentric rasterization with a genuine depth buffer. Vertex colors are
# shaded from each frame's deformed normals, never from undeformed bind poses.
C_SOURCE=r'''
#include <math.h>
#include <stddef.h>
void render(float *image, float *zbuffer, int width, int height,
            const float *points, const float *colors, const float *alpha, int count) {
  for(int t=0;t<count;t++) {
    const float *p=points+t*9, *c=colors+t*9;
    const float den=(p[4]-p[7])*(p[0]-p[6])+(p[6]-p[3])*(p[1]-p[7]);
    if(fabsf(den)<1e-8f)continue;
    int x0=(int)floorf(fminf(p[0],fminf(p[3],p[6]))), x1=(int)ceilf(fmaxf(p[0],fmaxf(p[3],p[6])));
    int y0=(int)floorf(fminf(p[1],fminf(p[4],p[7]))), y1=(int)ceilf(fmaxf(p[1],fmaxf(p[4],p[7])));
    if(x0<0)x0=0;if(x1>=width)x1=width-1;if(y0<0)y0=0;if(y1>=height)y1=height-1;
    for(int y=y0;y<=y1;y++)for(int x=x0;x<=x1;x++) {
      const float a=((p[4]-p[7])*(x+.5f-p[6])+(p[6]-p[3])*(y+.5f-p[7]))/den;
      const float b=((p[7]-p[1])*(x+.5f-p[6])+(p[0]-p[6])*(y+.5f-p[7]))/den;
      const float d=1-a-b;
      if(a<-1e-6f||b<-1e-6f||d<-1e-6f)continue;
      const float z=a*p[2]+b*p[5]+d*p[8];
      const size_t pixel=(size_t)y*width+x;
      if(z<=zbuffer[pixel])continue;
      for(int ch=0;ch<3;ch++)image[pixel*3+ch]=(a*c[ch]+b*c[ch+3]+d*c[ch+6])*alpha[t]+image[pixel*3+ch]*(1-alpha[t]);
      if(alpha[t]>=1)zbuffer[pixel]=z;
    }
  }
}
'''

def unit(value):
    value=np.asarray(value,dtype=np.float32)
    return value/np.linalg.norm(value)

VIEW=unit([0,.16,1])
RIGHT=np.array([1,0,0],np.float32)
UP=np.cross(VIEW,RIGHT)
LIGHT=unit([-.5,.85,.7]);FILL=unit([.75,.25,.6]);RIM=unit([.2,.4,-1]);HALF=unit(LIGHT+VIEW)
BG=np.empty((H,W,3),np.float32)
yy,xx=np.mgrid[:H,:W]
glow=np.exp(-(((xx-W*.42)/(W*.8))**2+((yy-H*.38)/(H*.8))**2))
BG[:]=np.array([.013,.019,.026])+glow[...,None]*np.array([.029,.036,.042])
for column in range(2):
    shadow=np.exp(-(((xx-(column+.5)*W/2)/(SCALE*.45))**2+((yy-H*.79)/(SCALE*.12))**2)*2)*.4
    BG*=1-shadow[...,None]
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
font=ImageFont.truetype(FONT,max(11,int(W/80)))
heading=ImageFont.truetype(BOLD,max(15,int(W/45)))

def render_frame(frame,raster):
    values=np.fromfile(ARGS.input/f'frame-{frame:03}.f32',dtype='<f4').reshape(2,DATA['vertices'],3)
    buffer=BG.copy();zbuffer=np.full((H,W),-1e10,np.float32)
    for column,(yaw,label) in enumerate(CAMERAS):
        rotation=np.array([[math.cos(yaw),0,math.sin(yaw)],[0,1,0],[-math.sin(yaw),0,math.cos(yaw)]],np.float32)
        vertices=values[0]@rotation.T;normals=values[1]@rotation.T
        p=vertices[INDEX];n=normals[INDEX].copy()
        face=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])
        front=face@VIEW>0
        selected=((MATERIALS[:,9]!=0)|front)&((MATERIALS[:,9]!=1)|~front)
        p=p[selected];n=n[selected];face=face[selected];m=MATERIALS[selected];idx=INDEX[selected]
        flat=m[:,10]>0
        if np.any(flat):n[flat]=(face[flat]/np.maximum(np.linalg.norm(face[flat],axis=1,keepdims=True),1e-9))[:,None,:]
        n[~front[selected]]*=-1
        n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-9)
        illumination=.22+(n[:,:,1]+1)*.085+np.maximum(n@LIGHT,0)*.56+np.maximum(n@FILL,0)*.12+np.maximum(n@RIM,0)*.10
        base=np.broadcast_to(m[:,None,:3],n.shape).copy()
        use_vertex=m[:,11]>0;base[use_vertex]*=COLORS[idx[use_vertex]]
        spec=np.maximum(n@HALF,0)**(14+(1-m[:,7,None])*95)
        rgb=base*illumination[:,:,None]+spec[:,:,None]*(.035*(1-m[:,6,None,None])+base*m[:,6,None,None]*.50)+m[:,None,3:6]*.35
        projected=np.stack([p@RIGHT*SCALE+(column+.5)*W/2,H*.79-p@UP*SCALE,p@VIEW],axis=-1)
        # Opaque geometry first; translucent details sorted far to near.
        order=np.lexsort((np.where(m[:,8]<1,projected[:,:,2].mean(axis=1),0),m[:,8]<1))
        arrays=[np.ascontiguousarray(value,dtype=np.float32) for value in [projected[order],rgb[order],m[order,8]]]
        raster(buffer.ctypes.data_as(PTR),zbuffer.ctypes.data_as(PTR),W,H,*(a.ctypes.data_as(PTR) for a in arrays),len(order))
    linear=np.clip(buffer,0,1)
    srgb=np.where(linear<=.0031308,12.92*linear,1.055*linear**(1/2.4)-.055)
    image=Image.fromarray((srgb*255).astype(np.uint8))
    draw=ImageDraw.Draw(image)
    draw.text((28,24),ARGS.title,font=heading,fill='#ebdbc0')
    draw.text((28,57),f'Actual game geometry · {DATA["role"]} · {DATA["speed"]:g} units/sec',font=font,fill='#aeb9bf')
    draw.line((W//2,105,W//2,H-70),fill='#3b4750')
    for column,(_,label) in enumerate(CAMERAS):draw.text(((column+.5)*W/2,H-62),label,font=font,anchor='mm',fill='#e7ddcb')
    draw.text((28,H-26),'Studio lighting · in-game appearance needs a live playtest',font=font,fill='#99a5aa')
    return image

ARGS.output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='emberwatch-motion-render-') as temporary:
    temporary=Path(temporary)
    (temporary/'raster.c').write_text(C_SOURCE)
    subprocess.run([os.environ.get('CC','cc'),'-O3','-shared','-fPIC',str(temporary/'raster.c'),'-lm','-o',str(temporary/'raster.so')],check=True)
    PTR=ctypes.POINTER(ctypes.c_float)
    lib=ctypes.CDLL(str(temporary/'raster.so'))
    lib.render.argtypes=[PTR,PTR,ctypes.c_int,ctypes.c_int,PTR,PTR,PTR,ctypes.c_int]
    contacts=[]
    contact_span=min(DATA['seconds'],max(0,ARGS.contact_seconds))*DATA['fps']
    contact_frames={min(DATA['frames']-1,round(i*contact_span/4)) for i in range(4)}
    for frame in range(DATA['frames']):
        image=render_frame(frame,lib.render)
        image.save(temporary/f'frame-{frame:03}.png')
        if frame in contact_frames:contacts.append(image.copy())
    fps=str(DATA['fps'])
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate',fps,'-i',str(temporary/'frame-%03d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-movflags','+faststart',str(ARGS.output)],check=True)
    sheet=Image.new('RGB',(W*2,H*2))
    for i,image in enumerate(contacts):sheet.paste(image,((i%2)*W,(i//2)*H))
    contact_path=ARGS.output.with_name(ARGS.output.stem+'-contact.jpg')
    sheet.save(contact_path,quality=90,optimize=True)
    if ARGS.gif:
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate',fps,'-i',str(temporary/'frame-%03d.png'),'-filter_complex','split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3','-loop','0',str(ARGS.output.with_suffix('.gif'))],check=True)
print(json.dumps({'output':str(ARGS.output),'contact':str(contact_path),'frames':DATA['frames'],'seconds':round(time.monotonic()-START,2)}))
