#!/usr/bin/env python3
"""Downscale the approved existing transparent logo; no replacement artwork."""
import hashlib
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'asset-pack/brand/bitpos-logo-large.png'
expected = '6a3465ae297e6170419e816072c1f6c419c52f8968563e94577092e4b949cccf'
if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
    raise SystemExit('Approved logo checksum mismatch')
image = Image.open(source).convert('RGBA')
image.thumbnail((126, 42), Image.Resampling.LANCZOS)
width, height = image.size
# LVGL ARGB8888 little-endian native pixels are B,G,R,A bytes.
data = bytes(channel for r,g,b,a in image.getdata() for channel in (b,g,r,a))
rows = ['    ' + ','.join('0x%02x' % value for value in data[offset:offset+24]) + ',' for offset in range(0, len(data), 24)]
content = ('/* Existing BitPOS transparent logo; technical resize only.\n'
           ' * Source: asset-pack/brand/bitpos-logo-large.png\n'
           ' * SHA256: ' + expected + '\n'
           ' * Provenance: asset-pack/brand/PROVENANCE.md; generator tools/firmware/convert-logo.py (Pillow11.3.0). */\n'
           '#include "lvgl.h"\n\nstatic const uint8_t pixels[] = {\n' + '\n'.join(rows) + '\n};\n\n'
           'const lv_image_dsc_t bitpos_logo = {\n'
           '    .header = {.magic=LV_IMAGE_HEADER_MAGIC, .cf=LV_COLOR_FORMAT_ARGB8888,\n'
           '               .w=%d, .h=%d, .stride=%d},\n' % (width,height,width*4) +
           '    .data_size=sizeof(pixels), .data=pixels,\n};\n')
(ROOT / 'device/firmware/main/bitpos_logo.c').write_text(content)
print({'existing_logo_converted': True, 'width': width, 'height': height, 'bytes': len(data), 'physical_render_claim': False})
