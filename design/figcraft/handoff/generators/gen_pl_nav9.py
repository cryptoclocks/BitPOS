# -*- coding: utf-8 -*-
"""Remove the separate refund-reconciliation menu entry from PL01-PL10 (the app shows it as a panel in the incidents page)
and align PL01 column/cell text and the PL10 subtitle with the app."""
import json, subprocess, sys
CLI = '/Users/cryptoclock/.local/bin/figcraft-cli'
src, dst = sys.argv[1], sys.argv[2]
ids = json.load(open('pl-ids.json'))
def tree(a, fid):
    open('n9-get.json', 'w').write(json.dumps([{"command": "node.get", "params": {"id": fid, "depth": 30}}]))
    out = subprocess.run([CLI, 'run', 'n9-get.json', '--in', a], capture_output=True, text=True).stdout.strip().split('\n')[-1]
    return json.loads(out)['result']
def nodes(o, acc):
    if isinstance(o, dict):
        if 'id' in o and 'type' in o: acc.append(o)
        for v in o.values(): nodes(v, acc)
    elif isinstance(o, list):
        for v in o: nodes(v, acc)
    return acc
cmds = []
for name, fid in ids.items():
    if name.startswith('PL11'): continue
    alln = nodes(tree(src, fid), [])
    label = [n for n in alln if n.get('characters') == 'กระทบยอดคืนเงิน' and n['x'] < 100]
    assert len(label) == 1, (name, len(label))
    y = label[0]['y']
    icon = [n for n in alln if n['type'] == 'VECTOR' and n['x'] < 60 and abs(n['y'] - y) < 12]
    hot = [n for n in alln if str(n.get('name', '')).startswith('Hotspot') and n['x'] < 20 and 740 < n['y'] < 750]
    print(name, 'label', label[0]['id'], 'icon', [n['id'] for n in icon], 'hot', [n['id'] for n in hot])
    cmds.append({"command": "edit.delete", "params": {"ids": [label[0]['id']] + [n['id'] for n in icon] + [n['id'] for n in hot]}})
    if name.startswith('PL01'):
        for n in alln:
            if n['type'] == 'TEXT' and n.get('characters') == 'เปิดล่าสุด': cmds.append({"command": "node.set", "params": {"ids": [n['id']], "characters": 'ทางเข้า'}})
            if n['type'] == 'TEXT' and n.get('characters') == 'ตอนนี้': cmds.append({"command": "node.set", "params": {"ids": [n['id']], "characters": 'เปิดหน้า'}})
    if name.startswith('PL10'):
        for n in alln:
            if n['type'] == 'TEXT' and n.get('characters') == 'ตรวจว่าเงินคืนโอนจริงบนเชนและตรงกับเคส':
                cmds.append({"command": "node.set", "params": {"ids": [n['id']], "characters": 'แผงในหน้าเหตุและความช่วยเหลือ ตรวจว่าเงินคืนโอนจริงบนเชนและตรงกับเคส'}})
open('n9-run.json', 'w').write(json.dumps(cmds, ensure_ascii=False))
res = subprocess.run([CLI, 'run', 'n9-run.json', '--in', src, '--out', dst], capture_output=True, text=True).stdout.strip().split('\n')
bad = [l for l in res if l.startswith('{') and not json.loads(l).get('ok')]
print(len(cmds), 'commands, failures', len(bad))
