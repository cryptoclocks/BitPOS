# -*- coding: utf-8 -*-
import json, subprocess, sys
sys.argv = [sys.argv[0], sys.argv[1], sys.argv[2]]
CLI = '/Users/cryptoclock/.local/bin/figcraft-cli'
src, dst = sys.argv[1], sys.argv[2]
ids = json.load(open('pl-ids.json'))
def run(cmds, a, b):
    open('p11-run.json', 'w').write(json.dumps(cmds, ensure_ascii=False))
    out = subprocess.run([CLI, 'run', 'p11-run.json', '--in', a, '--out', b], capture_output=True, text=True).stdout.strip().split('\n')
    return [json.loads(l) for l in out if l.startswith('{')]
fid = run([{"command": "edit.duplicate", "params": {"ids": [ids['PL01-hub']]}}], src, 'p11-a.figcraft')[0]['result']['ids'][0]
c = [{"command": "node.set", "params": {"ids": [fid], "name": "PL11-staff-login"}}]
def rect(x, y, w, h, fill, stroke=None, r=16):
    p = {"fill": fill, "cornerRadius": r}
    if stroke: p.update({"stroke": stroke, "strokeWeight": 1})
    c.append({"command": "node.create", "params": {"type": "rectangle", "x": x, "y": y, "width": w, "height": h, "parent": fid, "props": p, "select": False}})
def text(s, x, y, size=14, style='Regular', fill='#29183F', width=None, align=None):
    p = {"fontFamily": "Noto Sans Thai", "fontStyle": style, "fontSize": size, "fill": fill}
    if align: p["textAlign"] = align
    q = {"text": s, "x": x, "y": y, "parent": fid, "props": p}
    if width: q["width"] = width
    c.append({"command": "text.create", "params": q})
rect(0, 0, 1440, 1000, '#F8F5FC', None, 0)
rect(460, 150, 520, 640, '#FFFFFF', '#E9E1F1', 24)
text('BitPOS Platform', 460, 190, 14, 'SemiBold', '#64188A', 520, 'center')
text('เข้าสู่ระบบเจ้าหน้าที่', 460, 224, 28, 'SemiBold', '#29183F', 520, 'center')
text('ไม่ใช้สิทธิ์หรือคุกกี้ร้านเพื่อสั่งการเงิน', 460, 272, 13, 'Regular', '#7B7088', 520, 'center')
def field(label, value, y):
    text(label, 500, y, 12, 'Regular', '#7B7088'); rect(500, y + 20, 440, 48, '#FFFFFF', '#E9E1F1', 12); text(value, 516, y + 34, 14)
def btn(s, y, primary):
    rect(500, y, 440, 48, '#64188A' if primary else '#FFFFFF', None if primary else '#E9E1F1', 14); text(s, 500, y + 13, 14, 'SemiBold', '#FFFFFF' if primary else '#64188A', 440, 'center')
field('โทรศัพท์', '+66 81 234 5678', 330); btn('ขอ OTP', 420, True)
field('ยืนยัน OTP', '6 หลัก', 510); btn('ยืนยัน OTP', 600, False)
text('เจ้าหน้าที่แยกจากบัญชีร้าน การเข้าสู่ระบบไม่ให้สิทธิ์อัตโนมัติ', 460, 690, 12, 'Regular', '#7B7088', 520, 'center')
text('เปลี่ยนหมายเลข', 460, 724, 13, 'SemiBold', '#64188A', 520, 'center')
bad = [r for r in run(c, 'p11-a.figcraft', dst) if not r.get('ok')]
print('PL11', fid, len(c), 'failures', len(bad))
ids['PL11-staff-login'] = fid; json.dump(ids, open('pl-ids.json', 'w'))
