#!/usr/bin/env python3
"""Private, deterministic licensed-photo renderer. No URLs, network, or writes.
Fixed server invocation: python3 apps/api/src/promotion-render.py < bounded JSON.
Pillow and licensed device/firmware/fonts/Sarabun-Regular.ttf required.
"""
import array
import base64
import hashlib
import io
import json
import re
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[3]
Image.MAX_IMAGE_PIXELS = 16_000_000

def main():
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192:
        raise ValueError('bounded renderer input')
    data = json.loads(raw)
    if not {'imageUrl', 'headline', 'copy', 'discountPercent', 'price', 'currency', 'qr'}.issubset(data) or set(data)-{'imageUrl', 'headline', 'copy', 'discountPercent', 'price', 'currency', 'qr','secondImageUrl','discountLabel'}:
        raise ValueError('renderer schema')
    match = re.fullmatch(r'/images/menu/([a-z0-9-]{1,40})\.jpg', data['imageUrl'])
    if not match or len(data['headline']) > 80 or len(data['copy']) > 180:
        raise ValueError('local licensed photo allowlist')
    catalog = json.loads((ROOT / 'data/cafe-catalog.json').read_bytes())
    record = next(p for p in catalog['products'] if p['imageUrl'] == data['imageUrl'])
    photo = ROOT / 'apps/web/public' / data['imageUrl'].lstrip('/')
    public = (ROOT / 'apps/web/public').resolve()
    photo.resolve().relative_to(public)
    if photo.is_symlink() or photo.stat().st_size > 8_000_000:
        raise ValueError('bounded regular photo')
    source = photo.read_bytes()
    if hashlib.sha256(source).hexdigest() != record['photo']['sha256']:
        raise ValueError('source photo changed')
    with Image.open(io.BytesIO(source)) as original:
        if original.size != (record['photo']['width'], record['photo']['height']):
            raise ValueError('source dimensions changed')
        image = ImageOps.fit(original.convert('RGB'), (280, 200), method=Image.Resampling.LANCZOS)
    if data.get('secondImageUrl'):
        second = data['secondImageUrl']
        second_record = next((item for item in catalog['products'] if item['imageUrl'] == second), None)
        if not second_record: raise ValueError('second licensed photo required')
        second_path = public / second.lstrip('/')
        second_path.resolve().relative_to(public)
        if second_path.is_symlink() or second_path.stat().st_size > 8_000_000: raise ValueError('bounded photo')
        second_bytes = second_path.read_bytes()
        if hashlib.sha256(second_bytes).hexdigest() != second_record['photo']['sha256']: raise ValueError('second photo changed')
        left = ImageOps.fit(image, (140, 200), method=Image.Resampling.LANCZOS)
        with Image.open(io.BytesIO(second_bytes)) as right_source: right = ImageOps.fit(right_source.convert('RGB'), (140, 200), method=Image.Resampling.LANCZOS)
        image = Image.new('RGB',(280,200)); image.paste(left,(0,0)); image.paste(right,(140,0))
        source = source + second_bytes
    pixels = array.array('H', (((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3) for r, g, b in image.getdata()))
    if pixels.itemsize != 2:
        raise ValueError('sixteen bit required')
    if sys.byteorder != 'little':
        pixels.byteswap()
    bitmap = pixels.tobytes()
    if len(bitmap) != 112000:
        raise ValueError('exact RGB565 extent')
    preview = Image.new('RGB', (480, 320), '#1d0c2b')
    preview.paste(image, (12, 52))
    overlay = Image.new('RGBA', (280, 81), (29, 12, 43, 210))
    preview.paste(overlay, (12, 171), overlay)
    draw = ImageDraw.Draw(preview)
    font = ROOT / 'device/firmware/fonts/Sarabun-Regular.ttf'
    title = ImageFont.truetype(str(font), 20)
    text = ImageFont.truetype(str(font), 16)
    big = ImageFont.truetype(str(font), 24)
    # Fit deterministic lines by measured width, including Thai without spaces.
    def lines(value, selected, width, maximum):
        result, line = [], ''
        for char in value:
            if draw.textlength(line + char, font=selected) > width:
                result.append(line)
                line = ''
            line += char
        result.append(line)
        if len(result) > maximum:
            result = result[:maximum]
            while draw.textlength(result[-1] + '…', font=selected) > width:
                result[-1] = result[-1][:-1]
            result[-1] += '…'
        return result
    thai = bool(re.search(r'[\u0e00-\u0e7f]', data['headline'] + data['copy']))
    draw.text((12, 6), 'BitPOS - โปรโมชั่น' if thai else 'BitPOS - Promotion', font=big, fill='#ffffff')
    draw.text((24, 178), data.get('discountLabel') or (('ลด ' + str(data['discountPercent']) + '%') if thai else str(data['discountPercent']) + '% OFF'), font=title, fill='#ffffff')
    draw.text((24, 203), lines(data['headline'], title, 256, 1)[0], font=title, fill='#ffffff')
    draw.text((12, 259), lines(data['copy'], text, 280, 1)[0], font=text, fill='#ffffff')
    draw.rounded_rectangle((304, 52, 468, 216), radius=8, fill='#ffffff')
    if data['qr'] is not None:
        qr_bytes = base64.b64decode(data['qr'], validate=True)
        if len(qr_bytes) > 4096:
            raise ValueError('bounded QR')
        with Image.open(io.BytesIO(qr_bytes)) as qr:
            if qr.size != (148, 148):
                raise ValueError('QR dimensions')
            preview.paste(qr.convert('RGB'), (312, 60))
    else:
        for i, line in enumerate(lines('QR เมนูบนจอที่โต๊ะ' if thai else 'Scan to order', text, 140, 3)):
            draw.text((316, 94 + i * 23), line, font=text, fill='#512080')
    for i, line in enumerate(lines(data['currency'] + ' ' + data['price'], title, 164, 2)):
        draw.text((304, 222 + i * 22), line, font=title, fill='#ffffff')
    draw.rounded_rectangle((304, 272, 468, 316), radius=9, fill='#813bc6')
    draw.text((336, 282), 'ดูเมนู' if thai else 'View menu', font=text, fill='#ffffff')
    output = io.BytesIO()
    preview.save(output, format='PNG', optimize=False, compress_level=9)
    png = output.getvalue()
    if len(png) > 524288:
        raise ValueError('preview size bound')
    print(json.dumps({'image': base64.b64encode(bitmap).decode(), 'preview': base64.b64encode(png).decode(),
                      'sourceSha256': hashlib.sha256(source).hexdigest(), 'sha256': hashlib.sha256(bitmap).hexdigest()}))

if __name__ == '__main__':
    main()
