# Offline, deterministic model preview. Requires Python, NumPy, Pillow, and DejaVu Sans.
# python scripts/render-character-preview.py input.json output.jpg "EMBERWATCH / CHARACTER REDESIGN"
# Add --heads [--focus-y=1.78] for a close crop of the same exported geometry.
# The studio rasterizer preserves geometry and vertex colors; game bump maps,
# shadow maps and postprocessing require a live WebGL playtest.
import json,sys,math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
inp=sys.argv[1] if len(sys.argv)>1 else '/tmp/emberwatch-preview.json'
out=sys.argv[2] if len(sys.argv)>2 else '/tmp/emberwatch-preview.png'
title=sys.argv[3] if len(sys.argv)>3 else 'EMBERWATCH  /  CHARACTER STUDY'
data=json.load(open(inp));tris=data['triangles']
heads='--heads' in sys.argv[4:]
focus_y=next((float(arg.split('=',1)[1]) for arg in sys.argv[4:] if arg.startswith('--focus-y=')),1.78)
spacing=data.get('spacing',2.2)
W,H=2400,1200
scale=560.0 if heads else 260.0
# Orthographic camera looks downward just enough to read the feet and armor.
view=np.array([0,0.19,1.0]);view/=np.linalg.norm(view)
right=np.array([1.,0,0]);up=np.cross(view,right)
light=np.array([-0.5,0.85,0.7]);light/=np.linalg.norm(light)
fill=np.array([0.75,0.25,0.6]);fill/=np.linalg.norm(fill)
rim=np.array([0.2,0.4,-1.]);rim/=np.linalg.norm(rim)
C=np.zeros((H,W,3),np.float32)
# Soft charcoal studio background; modeled objects remain the sole subject.
y,x=np.mgrid[0:H,0:W]
glow=np.exp(-(((x-W*.45)/(W*.7))**2+((y-H*.35)/(H*.65))**2))
C[:]=np.array([.013,.019,.026])+glow[...,None]*np.array([.029,.036,.042])
# Ground contact shadow is a presentation aid (geometry itself is untouched).
for i in ([] if heads else range(4)):
  cx=W/2+(i-1.5)*spacing*scale
  yy=H*.76
  a=np.exp(-(((x-cx)/(scale*.53))**2+((y-yy)/(scale*.13))**2)*2)*.38
  C*=1-a[...,None]
zbuf=np.full((H,W),-1e8,np.float32)

def srgb(lin):
 return np.where(lin<=.0031308,12.92*lin,1.055*np.maximum(lin,0)**(1/2.4)-.055)

# Rasterize barycentrics into a true depth buffer; normal interpolation preserves smooth geometry.
# Translucent details are drawn after opaque geometry, from back to front.
tris=sorted(tris,key=lambda tri:(tri.get('opacity',1)<1, np.mean(np.array(tri['p'])@view) if tri.get('opacity',1)<1 else 0))
for tri in tris:
 p=np.array(tri['p'],np.float64);n=np.array(tri['n'],np.float64)
 face=np.cross(p[1]-p[0],p[2]-p[0])
 front=np.dot(face,view)>0
 side=tri.get('side',0) # Three.js FrontSide=0, BackSide=1, DoubleSide=2.
 if (side==0 and not front) or (side==1 and front):continue
 if not front:n=-n
 if heads:
  # A close crop of the same exported geometry, without replacing any detail.
  p[:,0]-=(tri['actor']-1.5)*spacing
  p[:,1]-=focus_y
  sx=p@right*scale+(tri['actor']+.5)*(W/4)
  sy=H*.48-p@up*scale
 else:
  sx=p@right*scale+W/2
  sy=H*.76-p@up*scale
 depths=p@view
 x0=max(0,int(math.floor(sx.min())));x1=min(W-1,int(math.ceil(sx.max())))
 y0=max(0,int(math.floor(sy.min())));y1=min(H-1,int(math.ceil(sy.max())))
 if heads:
  x0=max(x0,int(tri['actor']*W/4+18));x1=min(x1,int((tri['actor']+1)*W/4-18))
  y0=max(y0,200);y1=min(y1,975)
 if x1<x0 or y1<y0:continue
 den=(sy[1]-sy[2])*(sx[0]-sx[2])+(sx[2]-sx[1])*(sy[0]-sy[2])
 if abs(den)<1e-10:continue
 yy,xx=np.mgrid[y0:y1+1,x0:x1+1];xx=xx+.5;yy=yy+.5
 a=((sy[1]-sy[2])*(xx-sx[2])+(sx[2]-sx[1])*(yy-sy[2]))/den
 b=((sy[2]-sy[0])*(xx-sx[2])+(sx[0]-sx[2])*(yy-sy[2]))/den
 c=1-a-b
 inside=(a>=-1e-7)&(b>=-1e-7)&(c>=-1e-7)
 z=a*depths[0]+b*depths[1]+c*depths[2]
 mask=inside&(z>zbuf[y0:y1+1,x0:x1+1])
 if not mask.any():continue
 na=a[mask,None]*n[0]+b[mask,None]*n[1]+c[mask,None]*n[2]
 na/=np.maximum(np.linalg.norm(na,axis=1,keepdims=True),1e-9)
 nl=np.maximum(0,na@light);nf=np.maximum(0,na@fill);nr=np.maximum(0,na@rim)
 nv=np.maximum(0,na@view)
 hemi=(na[:,1]+1)*.5
 lightval=.22+hemi*.17+nl*.56+nf*.12+nr*.10
 vertex_color=np.array(tri['c'])
 if vertex_color.ndim==1:base=np.broadcast_to(vertex_color,(len(na),3)) # Original preview format.
 else:base=a[mask,None]*vertex_color[0]+b[mask,None]*vertex_color[1]+c[mask,None]*vertex_color[2]
 metal=tri['metal'];rough=tri['rough']
 half=(light+view);half/=np.linalg.norm(half)
 spec=np.maximum(0,na@half)**(14+(1-rough)*95)
 # Conservative material response, matching the colored mesh rather than beautifying it.
 rgb=base*lightval[:,None]
 rgb+=spec[:,None]*(.035*(1-metal)+base*metal*.50)
 rgb+=np.array(tri['e'])[None,:]*.35
 alpha=tri.get('opacity',1)
 C[y0:y1+1,x0:x1+1][mask]=rgb*alpha+C[y0:y1+1,x0:x1+1][mask]*(1-alpha)
 if alpha>=1:zbuf[y0:y1+1,x0:x1+1][mask]=z[mask]

im=Image.fromarray((np.clip(srgb(C),0,1)*255).astype(np.uint8)).resize((1600,800),Image.Resampling.LANCZOS)
draw=ImageDraw.Draw(im)
f='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';bold='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
draw.text((64,45),title,font=ImageFont.truetype(bold,24),fill='#ebdbc0')
draw.text((64,85),'Actual game models · preview lighting'+(' · Face detail' if heads else ''),font=ImageFont.truetype(f,16),fill='#acb3b7')
for i,s in enumerate(data['stats']):
 cx=((i+.5)*(W/4) if heads else W/2+(i-1.5)*spacing*scale)*2/3
 draw.text((cx,673),s['kind'].upper(),font=ImageFont.truetype(bold,18),anchor='mm',fill='#e7ddcb')

draw.line((64,743,1536,743),fill='#465159',width=1)
draw.text((64,761),'In-game lighting and animation require a live playtest.',font=ImageFont.truetype(f,13),fill='#99a5aa')
if out.lower().endswith(('.jpg','.jpeg')):
 im.save(out,quality=90,optimize=True,subsampling=0)
else:
 im.save(out)
print(out)
