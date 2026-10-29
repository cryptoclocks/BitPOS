# -*- coding: utf-8 -*-
"""Make frames honest about what the app really has: patch wording (cover vector text, write new text) and add
"concept, not in the app" ribbons to frames of unbuilt features. Source: design/figcraft/handoff/comparison-20261029/."""
import json, subprocess, sys
CLI = '/Users/cryptoclock/.local/bin/figcraft-cli'
src, dst = sys.argv[1], sys.argv[2]
cmds = []
BG = '#F8F5FC'
def rect(p, x, y, w, h, fill, stroke=None, r=0):
    props = {"fill": fill, "cornerRadius": r}
    if stroke: props.update({"stroke": stroke, "strokeWeight": 1})
    cmds.append({"command": "node.create", "params": {"type": "rectangle", "x": x, "y": y, "width": w, "height": h, "parent": p, "props": props, "select": False}})
def text(p, s, x, y, size=14, style='Regular', fill='#29183F', width=None, align=None):
    props = {"fontFamily": "Noto Sans Thai", "fontStyle": style, "fontSize": size, "fill": fill}
    if align: props["textAlign"] = align
    q = {"text": s, "x": x, "y": y, "parent": p, "props": props}
    if width: q["width"] = width
    cmds.append({"command": "text.create", "params": q})
def setc(i, s): cmds.append({"command": "node.set", "params": {"ids": [i], "characters": s}})
def card_text(p, x, y, title, sub, tfill='#29183F'):
    rect(p, x, y - 4, 236, 54, '#FFFFFF'); text(p, title, x, y + 2, 15, 'SemiBold', tfill); text(p, sub, x, y + 26, 12, 'Regular', '#7B7088')

# U16 / W06 payment methods: only the Solana wallet is enabled in the app
for f, price in ((988, None), (8743, None)):
    card_text(f, 94, 218, 'PromptPay', 'ยังไม่เปิดใช้งาน', '#7B7088'); rect(f, 332, 224, 30, 32, '#FFFFFF')
    card_text(f, 94, 318, 'บัตรเครดิต / เดบิต', 'ยังไม่เปิดใช้งาน', '#7B7088'); rect(f, 332, 324, 30, 32, '#FFFFFF')
    card_text(f, 94, 418, 'กระเป๋า Solana', 'เปิดการชำระของออร์เดอร์เดิม')
    rect(f, 20, 536, 330, 46, BG); text(f, 'หน้านี้ไม่ยืนยันการชำระเงิน', 24, 541, 13, 'Regular', '#7B7088', 330)
# U24 cancel: a review request, not an instant cancel
text(1439, 'ส่งคำขอให้เจ้าหน้าที่ตรวจสอบเท่านั้น ยังไม่ยกเลิกออเดอร์ คืนเงิน หรือโอนเงิน', 24, 586, 12, 'Regular', '#7B7088', 342, 'center')
rect(1439, 24, 632, 342, 52, '#FDE8EA', None, 14); text(1439, 'ส่งคำขอตรวจสอบ — ไม่ใช่ยกเลิกทันที', 24, 646, 15, 'SemiBold', '#B3261E', 342, 'center')
# U25 refund: obligation recorded, no transfer proof yet
setc(1517, 'มีการบันทึกภาระคืนเงินไว้แล้ว'); setc(1518, 'ขณะนี้ยังไม่มีหลักฐานยืนยันการโอนคืน')
# U26 coupons: sample page, conditions come from the server
setc(1558, 'ตัวอย่างหน้าจอ · ยังไม่เชื่อมระบบจริง'); setc(1559, 'ตัวอย่างส่วนลด'); setc(1560, 'เงื่อนไขจะมาจากเซิร์ฟเวอร์')
def rows(f, a, b):
    card_text(f, 94, 371, a[0], a[1]); card_text(f, 94, 475, b[0], b[1]); rect(f, 332, 380, 30, 32, '#FFFFFF'); rect(f, 332, 484, 30, 32, '#FFFFFF')
    rect(f, 20, 560, 350, 90, BG)
rows(1532, ('ตัวอย่างคูปองส่วนลด', 'เงื่อนไขจะมาจากเซิร์ฟเวอร์'), ('ตัวอย่างคูปองส่งฟรีใกล้บ้าน', 'เงื่อนไขจะมาจากเซิร์ฟเวอร์'))
# U27 rewards: live points page, redeem is not available
setc(1615, '1 แต้มต่อเงิน 1 หน่วยเต็มของสกุลเงิน'); setc(1616, '0 แต้ม'); setc(1617, 'ยังไม่มีแต้ม · แลกรางวัลยังไม่เปิดใช้งาน'); setc(1618, 'แต้มตามสกุลเงิน')
rows(1589, ('THB', '0 แต้ม · 0 ออเดอร์'), ('แลกรางวัล', 'ยังไม่เปิดใช้งาน'))
# U31 review: what the app's review page has
setc(1854, 'มื้ออาหารนี้เสร็จสมบูรณ์แล้ว'); cmds.append({"command": "node.set", "params": {"ids": [1854], "x": 0, "width": 390, "textAlign": "center", "textAutoResize": "height"}})
rect(1826, 20, 478, 250, 20, BG); text(1826, 'บอกเล่ามื้ออาหารนี้ (ไม่บังคับ)', 24, 480, 13, 'Regular', '#7B7088')
rect(1826, 30, 706, 330, 28, '#FFFFFF'); text(1826, 'ไม่ให้คะแนนไรเดอร์', 24, 710, 15, 'SemiBold', '#64188A', 342, 'center')
# concept ribbons
def ribbon(f, x, y, label='ภาพแนวคิด · ยังไม่มีในแอป', w=190):
    rect(f, x, y, w, 22, '#FFF1D6', '#F0C36B', 11); text(f, label, x, y + 3, 11, 'SemiBold', '#8A5A00', w, 'center')
for f in (2260, 2330, 2404, 2467, 2524, 3990, 4059, 4107, 4139, 4193, 8986, 9257, 9300, 8596): ribbon(f, 100, 8)
for f in (3310, 3368, 3426): ribbon(f, 100, 8, 'ตัวเลขตัวอย่าง · ไม่ใช่ข้อมูลจริง')
for f in (8428, 11248, 11761): ribbon(f, 620, 6)
json.dump(cmds, open('hon-run.json', 'w'), ensure_ascii=False)
res = subprocess.run([CLI, 'run', 'hon-run.json', '--in', src, '--out', dst], capture_output=True, text=True).stdout.strip().split('\n')
bad = [l for l in res if l.startswith('{') and not json.loads(l).get('ok')]
print(len(cmds), 'commands, failures', len(bad)); print(bad[:3])
