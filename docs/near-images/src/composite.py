# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Product visualizations for the README: English NEAR FigCraft screens mapped onto the screens in BitPOS's existing
# AI café visualizations (BitPOS-Motion/public/product, "Product visualization"), plus a soft foreground blur.
import sys
from PIL import Image, ImageDraw, ImageFilter
def solve(A, B):
    n=len(B);M=[row[:]+[b] for row,b in zip(A,B)]
    for c in range(n):
        p=max(range(c,n),key=lambda r:abs(M[r][c]));M[c],M[p]=M[p],M[c]
        for r in range(n):
            if r!=c:
                f=M[r][c]/M[c][c];M[r]=[a-f*b for a,b in zip(M[r],M[c])]
    return [M[i][n]/M[i][i] for i in range(n)]
def coeffs(dst, src):
    A=[];B=[]
    for (x,y),(u,v) in zip(dst,src):
        A+= [[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]];B+=[u,v]
    return solve(A,B)
def place(base, screen, quad, only_dark=False):
    w,h=screen.size;src=[(0,0),(w,0),(w,h),(0,h)]
    warped=screen.convert('RGBA').transform(base.size, Image.PERSPECTIVE, coeffs(quad,src), Image.BICUBIC)
    mask=Image.new('L',base.size,0);ImageDraw.Draw(mask).polygon(quad,fill=255)
    if only_dark:
        # keep fingers and reflections: replace only the dark glass of the screen
        g=base.convert('L').point(lambda v:255 if v<70 else 0).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(5))
        from PIL import ImageChops
        mask=ImageChops.multiply(mask,g)
    mask=mask.filter(ImageFilter.GaussianBlur(0.8))
    base.paste(warped,(0,0),mask)
    return base
