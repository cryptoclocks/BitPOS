# -*- coding: utf-8 -*-
"""Draw the mobile frames that did not exist in FigCraft, by cloning U23 (customer) and R15 (rider) list frames."""
import json, subprocess, sys
CLI = '/Users/cryptoclock/.local/bin/figcraft-cli'
src, dst = sys.argv[1], sys.argv[2]
FR = [
 (1370, 'U44-sessions', 'อุปกรณ์ที่ลงชื่อเข้าใช้', ('ทั้งหมด', 'อุปกรณ์อื่น'), 'เซสชันของบัญชีนี้',
  [('อุปกรณ์นี้ · Android', 'ใช้งานอยู่ตอนนี้'), ('อุปกรณ์อื่น', 'ใช้งานล่าสุด 28 ต.ค. · เพิกถอนได้'), ('เซสชันเก่า', 'หมดอายุแล้ว 20 ต.ค.')], 'ออกจากระบบทุกอุปกรณ์ได้ในตั้งค่าบัญชี'),
 (1370, 'U45-order-again', 'สั่งอีกครั้ง', ('ทั้งหมด', 'ร้านโปรด'), 'จากออเดอร์ที่ชำระแล้วของคุณ',
  [('BitPOS Coffee House', 'Iced latte · 1 แก้ว · ฿95'), ('Morning Bake', 'Butter croissant · 1 ชิ้น · ฿75'), ('Matcha & More', 'Matcha latte · 2 แก้ว · ฿190')], 'ราคาและโปรจะตรวจใหม่ที่เซิร์ฟเวอร์ก่อนสั่ง'),
 (1370, 'U46-merchant-reviews', 'รีวิวจากลูกค้า', ('ทั้งหมด', 'ล่าสุด'), 'รีวิวที่เผยแพร่ของร้านนี้',
  [('5 ดาว', 'กาแฟหอม ส่งเร็ว · 28 ต.ค.'), ('4 ดาว', 'ของอร่อย รอนิดหน่อย · 27 ต.ค.'), ('5 ดาว', 'บรรจุภัณฑ์ดีมาก · 25 ต.ค.')], 'แสดงเฉพาะรีวิวที่ผ่านการตรวจและเผยแพร่'),
 (3256, 'R33-payout-beneficiary', 'บัญชีรับเงิน', ('ทั้งหมด', 'ใช้งาน'), 'ปลายทางรับรอบโอน',
  [('กระเป๋า Solana devnet', 'บัญชีรับเงินของคุณ'), ('USDG devnet', 'สินทรัพย์ที่รับรอบโอน'), ('ยืนยันก่อนเปลี่ยน', 'ต้องยืนยันใหม่ทุกครั้ง')], None),
 (3256, 'R34-compensation', 'ค่าชดเชยงานส่งอาหาร', ('ทั้งหมด', 'รออนุมัติ'), 'คำขอค่าชดเชย',
  [('งาน #3cfed3ca', 'ส่งไม่สำเร็จ'), ('งาน #7a21b9e0', 'ร้านปิดระหว่างทาง'), ('งาน #b04c11d2', 'ลูกค้าไม่รับ')], None),
]

def run(cmds, a, b):
    open('mb-run.json', 'w').write(json.dumps(cmds, ensure_ascii=False))
    out = subprocess.run([CLI, 'run', 'mb-run.json', '--in', a, '--out', b], capture_output=True, text=True).stdout.strip().split('\n')
    return [json.loads(l) for l in out if l.startswith('{')]

def tree(a, fid):
    open('mb-get.json', 'w').write(json.dumps([{"command": "node.get", "params": {"id": fid, "depth": 30}}]))
    out = subprocess.run([CLI, 'run', 'mb-get.json', '--in', a], capture_output=True, text=True).stdout.strip().split('\n')[-1]
    return json.loads(out)['result']

cur = src; ids = {}
for k, (tpl, name, title, chips, label, cards, hint) in enumerate(FR):
    nxt = 'mb-%d.figcraft' % k
    fid = run([{"command": "edit.duplicate", "params": {"ids": [tpl]}}], cur, nxt)[0]['result']['ids'][0]
    t = tree(nxt, fid)
    texts = []
    def walk(o):
        if isinstance(o, dict):
            if o.get('type') == 'TEXT' and (o.get('characters') or '').strip(): texts.append(o)
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(t)
    cmds = [{"command": "node.set", "params": {"ids": [fid], "name": name}}]
    def sc(node, s): cmds.append({"command": "node.set", "params": {"ids": [node['id']], "characters": s}})
    titlenode = [x for x in texts if 60 < x['x'] < 90 and 55 < x['y'] < 70][0]; sc(titlenode, title)
    chipn = sorted([x for x in texts if 120 < x['y'] < 160 and x['x'] < 300], key=lambda x: x['x'])
    assert len(chipn) == 2, (name, len(chipn))
    for node, s in zip(chipn, chips): sc(node, s)
    lab = [x for x in texts if 185 < x['y'] < 195 and x['x'] < 60][0]; sc(lab, label)
    groups = sorted([c for c in t['children'] if c.get('type') == 'GROUP' and str(c.get('name', '')).startswith('Card')], key=lambda c: c['y'])
    assert len(groups) == 3, (name, len(groups))
    cardt = []; third = []
    for g in groups:
        gt = tree(nxt, g['id']); inner = []
        def w2(o):
            if isinstance(o, dict):
                if o.get('type') == 'TEXT' and (o.get('characters') or '').strip(): inner.append(o)
                for v in o.values(): w2(v)
            elif isinstance(o, list):
                for v in o: w2(v)
        imgs = []
        def w3(o):
            if isinstance(o, dict):
                if o.get('type') == 'RECTANGLE' and 'Image' in str(o.get('name', '')): imgs.append(o)
                for v in o.values(): w3(v)
            elif isinstance(o, list):
                for v in o: w3(v)
        w3(gt)
        if name in ('U44-sessions', 'U46-merchant-reviews'):
            for ch in gt.get('children', []):
                if ch.get('type') == 'GROUP' and 'Mask' in str(ch.get('name', '')):
                    cmds.append({"command": "edit.delete", "params": {"ids": [ch['id']]}})
                    cmds.append({"command": "node.create", "params": {"type": "rectangle", "x": 36, "y": g['y'] + 12, "width": 60, "height": 60, "parent": fid, "props": {"fill": "#EADFF7", "cornerRadius": 14}, "select": False}})
        w2(gt); inner.sort(key=lambda x: x['y']); left = sorted([x for x in inner if x['x'] < 200], key=lambda x: x['y']); right = [x for x in inner if x['x'] >= 200]; cardt += left; third.extend(right)
    flat = [c for pair in cards for c in pair]
    for node, s in zip(cardt, flat): sc(node, s)
    for node, s in zip(third, ['สำเร็จ', 'สำเร็จ', 'สำเร็จ']): sc(node, s if name.startswith('R33') else ('รออนุมัติ', 'อนุมัติแล้ว', 'ปฏิเสธ')[third.index(node)])
    extra = [x for x in texts if x['y'] > 545 and x['y'] < 700]
    for x in extra:
        if hint: sc(x, hint)
    res = run(cmds, nxt, 'mb-%d-done.figcraft' % k)
    print(name, fid, 'failures', len([r for r in res if not r.get('ok')]))
    ids[name] = fid; cur = 'mb-%d-done.figcraft' % k
json.dump(ids, open('mb-ids.json', 'w'))
subprocess.run(['cp', cur, dst]); print('wrote', dst)
