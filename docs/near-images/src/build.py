# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Builds docs/near-images/visual-*.jpg: product visualizations (AI café images from BitPOS-Motion/public/product with
# the English NEAR FigCraft screens mapped onto the device and phone screens). Run: python3 -I docs/near-images/src/build.py
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from composite import place
from PIL import Image, ImageDraw, ImageFilter
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
P = os.path.expanduser('~/Desktop/BitPOS/BitPOS-Motion/public/product/'); S = os.path.join(ROOT, 'design/figcraft-near/previews/'); OUT = os.path.join(ROOT, 'docs/near-images/')

def screen(name, hide_lang=False):
    im = Image.open(S + name).convert('RGB')
    if hide_lang:  # the Thai language pill on ND-04 (x 306-344, y 8-33): painted with the header colour
        ImageDraw.Draw(im).rectangle((301, 4, 350, 37), fill=(11, 16, 32))
    return im

def depth(img, sharp_box, radius=6, feather=120):
    """Shallow depth of field: blur everything, keep `sharp_box` (x0,y0,x1,y1) sharp with a soft edge."""
    blurred = img.filter(ImageFilter.GaussianBlur(radius))
    m = Image.new('L', img.size, 0); ImageDraw.Draw(m).rounded_rectangle(sharp_box, radius=60, fill=255)
    return Image.composite(img, blurred, m.filter(ImageFilter.GaussianBlur(feather)))

def save(img, name, label='Product visualization · screens: FigCraft concept · NEAR testnet'):
    d = ImageDraw.Draw(img); w, h = img.size
    try:
        from PIL import ImageFont; f = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', max(14, w // 80))
    except Exception: f = None
    d.text((w - 14, h - 12), label, fill=(255, 255, 255), anchor='rd', font=f, stroke_width=2, stroke_fill=(30, 20, 40))
    img.save(OUT + name, quality=86); print(name, img.size)

# 1. guest scans the table's BitPOS Mini; the menu opens on the phone (foreground hand soft, device sharp)
b = Image.open(P + 'table-ordering-cafe.jpg').convert('RGB')
place(b, screen('ND-01.png'), [(452, 500), (852, 486), (858, 792), (462, 806)])
place(b, screen('NC-01.png'), [(902, 420), (1020, 420), (1127, 690), (1018, 690)], only_dark=True)
b = depth(b, (330, 380, 1150, 900), radius=5, feather=90)
save(b, 'visual-scan-at-table.jpg')

# 2. paid: the table screen shows the split it read from the chain
b = Image.open(P + 'posclock-cafe-lifestyle.jpg').convert('RGB')
place(b, screen('ND-04.png', hide_lang=True), [(347, 381), (825, 376), (833, 705), (357, 710)])
b = depth(b, (230, 300, 1000, 820), radius=4, feather=110)
save(b, 'visual-paid-split.jpg')

# 3. witness: the screen checks NEAR before it signs
b = Image.open(P + 'ai-table-offer-cafe.jpg').convert('RGB')
place(b, screen('ND-03.png'), [(813, 300), (1378, 306), (1348, 757), (757, 717)])
b = depth(b, (650, 200, 1560, 860), radius=5, feather=110)
save(b, 'visual-witness-check.jpg')
