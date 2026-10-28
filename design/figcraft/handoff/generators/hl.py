# -*- coding: utf-8 -*-
import json, subprocess
CLI = '/Users/cryptoclock/.local/bin/figcraft-cli'
BG = '#F8F5FC'; INK = '#29183F'; MUTE = '#7B7088'; PUR = '#64188A'; LINE = '#E9E1F1'
cmds = []
def rect(p, x, y, w, h, fill, stroke=None, r=0):
    props = {"fill": fill, "cornerRadius": r}
    if stroke: props.update({"stroke": stroke, "strokeWeight": 1})
    cmds.append({"command": "node.create", "params": {"type": "rectangle", "x": x, "y": y, "width": w, "height": h, "parent": p, "props": props, "select": False}})
def text(p, s, x, y, size=14, style='Regular', fill=INK, width=None, align=None):
    props = {"fontFamily": "Noto Sans Thai", "fontStyle": style, "fontSize": size, "fill": fill}
    if align: props["textAlign"] = align
    q = {"text": s, "x": x, "y": y, "parent": p, "props": props}
    if width: q["width"] = width
    cmds.append({"command": "text.create", "params": q})
def setc(i, s): cmds.append({"command": "node.set", "params": {"ids": [i], "characters": s}})
def run(src, dst, name):
    json.dump(cmds, open(name + '-run.json', 'w'), ensure_ascii=False)
    res = subprocess.run([CLI, 'run', name + '-run.json', '--in', src, '--out', dst], capture_output=True, text=True).stdout.strip().split('\n')
    bad = [l for l in res if l.startswith('{') and not json.loads(l).get('ok')]
    print(name, len(cmds), 'commands, failures', len(bad), bad[:2])
