#!/usr/bin/env python3
"""Local artifact proof only: actual licensed photograph; no provider/network/DB.
Run from the integrated repository with python3+Pillow and inherited Sarabun font.
This does not claim physical rendering or actual model execution.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image

root = Path(__file__).resolve().parents[2]
renderer = root / 'apps/api/src/promotion-render.py'
data = {'imageUrl': '/images/menu/espresso.jpg', 'headline': 'กาแฟลดราคา',
        'copy': 'Local renderer proof - not AI', 'discountPercent': 15,
        'price': '2.30', 'currency': 'USD', 'qr': None}
encoded = json.dumps(data, ensure_ascii=False).encode()
results = [subprocess.run([sys.executable, str(renderer)], input=encoded, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True, timeout=10).stdout for _ in range(2)]
assert results[0] == results[1], 'same licensed source and overlay must be deterministic'
result = json.loads(results[0])
image = base64.b64decode(result['image'], validate=True)
preview = base64.b64decode(result['preview'], validate=True)
assert len(image) == 112000
assert hashlib.sha256(image).hexdigest() == result['sha256']
with Image.open(io.BytesIO(preview)) as png:
    assert png.size == (480, 320)
    assert png.format == 'PNG'
assert len(preview) <= 524288
photo = (root / 'apps/web/public/images/menu/espresso.jpg').read_bytes()
assert hashlib.sha256(photo).hexdigest() == result['sourceSha256']
invalid = {**data, 'imageUrl': 'https://arbitrary.invalid/photo.jpg'}
rejected = subprocess.run([sys.executable, str(renderer)], input=json.dumps(invalid).encode(),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
assert rejected.returncode != 0 and not rejected.stdout, 'remote photo is never fetched/rendered'
print(json.dumps({'origin': 'actual_local_licensed_photo_deterministic_renderer',
                  'imageBytes': len(image), 'imageSha256': result['sha256'],
                  'previewWidth': 480, 'previewHeight': 320,
                  'previewSha256': hashlib.sha256(preview).hexdigest(),
                  'sourceSha256': result['sourceSha256'], 'providerCalls': 0,
                  'physicalRenderClaim': False, 'previewQR': 'clearly_labeled_preselection_placeholder'}))
