#!/usr/bin/env python3
"""Read-only white-card geometry measurement for an AVD PNG, without imaging dependencies."""
import json, struct, sys, zlib
from pathlib import Path
raw=Path(sys.argv[1]).read_bytes()
assert raw[:8]==b'\x89PNG\r\n\x1a\n'
pos=8; compressed=bytearray()
while pos<len(raw):
 size=struct.unpack('>I',raw[pos:pos+4])[0];kind=raw[pos+4:pos+8];data=raw[pos+8:pos+8+size];pos+=size+12
 if kind==b'IHDR':w,h,depth,color,compression,filter_method,interlace=struct.unpack('>IIBBBBB',data)
 if kind==b'IDAT':compressed.extend(data)
assert depth==8 and color in (2,6) and interlace==0
bpp=3 if color==2 else 4;stride=w*bpp;pixels=zlib.decompress(compressed);previous=bytearray(stride);offset=0;runs=[];start=None
for y in range(h):
 method=pixels[offset];row=bytearray(pixels[offset+1:offset+1+stride]);offset+=stride+1
 for i in range(stride):
  left=row[i-bpp] if i>=bpp else 0;up=previous[i];corner=previous[i-bpp] if i>=bpp else 0
  if method==1:predict=left
  elif method==2:predict=up
  elif method==3:predict=(left+up)//2
  elif method==4:
   p=left+up-corner;a=abs(p-left);b=abs(p-up);c=abs(p-corner);predict=left if a<=b and a<=c else up if b<=c else corner
  else:assert method==0;predict=0
  row[i]=(row[i]+predict)&255
 if 200<=y<1800:
  white=row[(w-100)*bpp:(w-100)*bpp+3]==b'\xff\xff\xff'
  if white and start is None:start=y
  if not white and start is not None:
   if y-start>80:runs.append((start,y-1,y-start))
   start=None
 previous=row
dpr=float(sys.argv[2]) if len(sys.argv)>2 else 2.625
print(json.dumps({'image':[w,h],'whiteCardRuns':runs,'logicalHeights':[round(r[2]/dpr,1) for r in runs],'logicalTopSteps':[round((b[0]-a[0])/dpr,1) for a,b in zip(runs,runs[1:])],'method':'White fill scan near right inset; rounded borders affect edge estimate; does not prove full pixel fidelity'},indent=2))
