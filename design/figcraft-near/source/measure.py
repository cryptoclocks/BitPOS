#!/usr/bin/env python3
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Adapted from the PayPal edition builder (paypal-hackathon/design/pp-edition/build/generators/72-74/measure.py).
"""Measure per-character advance widths of Noto Sans Thai with figcraft-cli (the same text engine
that renders the document) and write source/widths.json. Run: python3 -I source/measure.py"""
import json, os, subprocess, tempfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.expanduser('~/.local/bin/figcraft-cli')
chars = [chr(c) for c in range(32, 127)] + [chr(c) for c in range(0x0E01, 0x0E5C) if chr(c).isprintable()] \
    + list("·→←↑↓↗↻−–—…✓✗×•●○◉▸▾≤≥“”‘’éÉ₿▲▼■□◆★")
weights = [400, 600, 700]
items = [(w, ch) for w in weights for ch in chars]
H = len(items) * 130 + 200
lines = ['<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="%d" viewBox="0 0 4000 %d"><title>m</title>' % (H, H)]
for i, (w, ch) in enumerate(items):
    t = ch if ch != ' ' else 'a a'
    lines.append('<text id="m%d" x="10" y="%d" font-family="Noto Sans Thai" font-size="100" font-weight="%d">%s</text>'
                 % (i, 120 + i * 130, w, escape(t)))
lines.append('</svg>')
with tempfile.TemporaryDirectory() as td:
    svg = os.path.join(td, 'm.svg')
    open(svg, 'w', encoding='utf-8').write('\n'.join(lines))
    cmds = [{"command": "file.new", "params": {"name": "x"}},
            {"command": "file.import", "params": {"path": svg, "x": 0, "y": 0}}]
    cmds += [{"command": "node.get", "params": {"id": 3 + i}} for i in range(len(items))]
    script = os.path.join(td, 'm.jsonl')
    open(script, 'w').write('\n'.join(json.dumps(c) for c in cmds))
    out = subprocess.run([CLI, 'run', script], check=True, capture_output=True, text=True).stdout
res = {}
for l in out.splitlines():
    if not l.startswith('{'):
        continue
    r = json.loads(l).get('result')
    if isinstance(r, dict) and 'characters' in r and r.get('name', '').startswith('m'):
        res[int(r['name'][1:])] = r['width']
table = {}
a = {}
for i, (w, ch) in enumerate(items):
    if i in res and ch == 'a':
        a[w] = res[i]
for i, (w, ch) in enumerate(items):
    if i not in res:
        continue
    v = res[i]
    if ch == ' ':
        v = v - 2 * a[w]
    table.setdefault(str(w), {})[ch] = v
json.dump(table, open(os.path.join(HERE, 'widths.json'), 'w', encoding='utf-8'), ensure_ascii=False, sort_keys=True)
print('measured', len(res), 'of', len(items))
