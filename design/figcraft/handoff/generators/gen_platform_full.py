# -*- coding: utf-8 -*-
"""Upgrade the platform operator frames (PL01-PL10, plus a new PL11 staff sign-in) from list clones to full layouts."""
import json, subprocess, sys
CLI = '/Users/cryptoclock/.local/bin/figcraft-cli'
src, dst = sys.argv[1], sys.argv[2]
ids = json.load(open('pl-ids.json'))
BG, WHITE, LINE, MUTED, DARK, PUR, TINT = '#F8F5FC', '#FFFFFF', '#E9E1F1', '#7B7088', '#29183F', '#64188A', '#EADFF7'
GREEN_BG, GREEN, AMBER_BG, AMBER, RED_BG, RED = '#E6F4EA', '#2A7D4F', '#FFF0DC', '#A94800', '#FDE7E9', '#B3261E'
TONES = {'ok': (GREEN_BG, GREEN), 'warn': (AMBER_BG, AMBER), 'bad': (RED_BG, RED), 'info': (TINT, PUR)}

class Frame:
    def __init__(self, fid): self.fid, self.cmds = fid, []
    def rect(self, x, y, w, h, fill=WHITE, stroke=LINE, r=16):
        p = {"fill": fill, "cornerRadius": r}
        if stroke: p.update({"stroke": stroke, "strokeWeight": 1})
        self.cmds.append({"command": "node.create", "params": {"type": "rectangle", "x": x, "y": y, "width": w, "height": h, "parent": self.fid, "props": p, "select": False}})
    def text(self, s, x, y, size=14, style='Regular', fill=DARK, width=None, align=None):
        p = {"fontFamily": "Noto Sans Thai", "fontStyle": style, "fontSize": size, "fill": fill}
        if align: p["textAlign"] = align
        c = {"text": s, "x": x, "y": y, "parent": self.fid, "props": p}
        if width: c["width"] = width
        self.cmds.append({"command": "text.create", "params": c})
    def card(self, x, y, w, h, title=None):
        self.rect(x, y, w, h)
        if title: self.text(title, x + 20, y + 16, 16, 'SemiBold')
    def chip(self, s, x, y, tone='info', w=None):
        bg, fg = TONES[tone]; w = w or (len(s) * 8 + 26)
        self.rect(x, y, w, 26, bg, None, 13); self.text(s, x, y + 4, 12, 'SemiBold', fg, w, 'center')
    def button(self, s, x, y, w, primary=True, h=44):
        self.rect(x, y, w, h, PUR if primary else WHITE, None if primary else LINE, 14)
        self.text(s, x, y + (h - 22) / 2, 14, 'SemiBold', WHITE if primary else PUR, w, 'center')
    def field(self, label, value, x, y, w, h=44):
        self.text(label, x, y, 12, 'Regular', MUTED); self.rect(x, y + 20, w, h, WHITE, LINE, 12); self.text(value, x + 14, y + 20 + (h - 20) / 2 - 2, 14, 'Regular', DARK)
    def trow(self, cells, xs, y, bold=False, tones=None):
        for i, (c, x) in enumerate(zip(cells, xs)):
            if tones and tones.get(i): self.chip(c, x, y - 4, tones[i])
            else: self.text(c, x, y, 13, 'SemiBold' if bold else 'Regular', PUR if bold else DARK)
    def table(self, x, y, w, heads, rows, xs, tones=None, rh=52):
        self.rect(x, y, w, 40 + rh * len(rows) + 8)
        self.rect(x + 8, y + 8, w - 16, 32, '#F0E8F7', None, 10)
        self.trow(heads, xs, y + 15, True)
        for i, r in enumerate(rows):
            yy = y + 56 + i * rh; self.trow(r, xs, yy + 4, False, tones)
            if i < len(rows) - 1: self.rect(x + 16, yy + rh - 14, w - 32, 1, LINE, None, 0)

def run(cmds, a, b):
    open('pf-run.json', 'w').write(json.dumps(cmds, ensure_ascii=False))
    out = subprocess.run([CLI, 'run', 'pf-run.json', '--in', a, '--out', b], capture_output=True, text=True).stdout.strip().split('\n')
    res = [json.loads(l) for l in out if l.startswith('{')]
    return [r for r in res if not r.get('ok')]

def footer_ids(a, fid):
    open('pf-get.json', 'w').write(json.dumps([{"command": "node.get", "params": {"id": fid, "depth": 30}}]))
    t = json.loads(subprocess.run([CLI, 'run', 'pf-get.json', '--in', a], capture_output=True, text=True).stdout.strip().split('\n')[-1])['result']
    out = []
    def w(o):
        if isinstance(o, dict):
            if o.get('type') == 'TEXT' and o.get('y', 0) > 800 and o.get('x', 0) > 280: out.append(o)
            for v in o.values(): w(v)
        elif isinstance(o, list):
            for v in o: w(v)
    w(t); out.sort(key=lambda x: x['y']); return out

L = 264; R = 1408
def build(name, fid, title, sub, note):
    f = Frame(fid)
    f.rect(232, 190, 1208, 610, BG, None, 0)           # clear the cloned list
    f.cmds.append({"command": "node.set", "params": {"ids": [fid]}})
    return f

specs = {}
def pl01(f):
    tools = [('จัดส่งและไรเดอร์', 'ภาพสถานะงานจัดส่งและนโยบายค้นหาอัตโนมัติ', 'ok', 'เปิดหน้า'), ('ตรวจสอบไรเดอร์', 'ใบสมัคร เอกสาร อนุมัติหรือปฏิเสธ', 'ok', 'เปิดหน้า'),
             ('เหตุและความช่วยเหลือ', 'เหตุระหว่างส่งอาหารและการรับทราบ', 'ok', 'เปิดหน้า'), ('ช่วยเหลือลูกค้า', 'คิวคำร้องและข้อความ', 'ok', 'เปิดหน้า'),
             ('ตรวจรีวิว', 'ตัดสินเผยแพร่หรือไม่เผยแพร่พร้อมเหตุผล', 'ok', 'เปิดหน้า'), ('รายได้ไรเดอร์', 'ใบรับคำสั่งบัญชีและรอบจ่าย', 'ok', 'เปิดหน้า'),
             ('งานเดินทาง', 'ประกาศอัตราค่าโดยสาร', 'ok', 'เปิดหน้า'), ('แผนที่ติดตามสด', 'ต้องมีผู้ให้บริการแผนที่ก่อนจึงเปิดได้', 'warn', 'ยังไม่เชื่อมต่อ')]
    for i, (t, d, tone, c) in enumerate(tools):
        x = L + (i % 4) * 290; y = 206 + (i // 4) * 196
        f.card(x, y, 270, 176); f.text(t, x + 20, y + 20, 17, 'SemiBold'); f.text(d, x + 20, y + 58, 13, 'Regular', MUTED, 230)
        f.chip(c, x + 20, y + 130, tone, 120 if tone == 'warn' else 90)
    f.card(L, 606, 1144, 96); f.text('เจ้าหน้าที่แยกจากบัญชีร้าน', L + 24, 624, 16, 'SemiBold')
    f.text('เมนูที่ลิงก์ได้คือหน้าที่มีอยู่จริง รายการที่ยังไม่เชื่อมต่อบอกสิ่งที่ต้องมีก่อน การเข้าสู่ระบบไม่ให้สิทธิ์อัตโนมัติ', L + 24, 654, 13, 'Regular', MUTED, 1090)
def pl02(f):
    f.field('ร้าน', 'รหัสร้านที่ได้รับสิทธิ์', L, 200, 300); f.field('สาขา', 'รหัสสาขา', L + 316, 200, 300); f.button('โหลดภาพสถานะล่าสุด', L + 632, 220, 220, False)
    f.table(L, 290, 800, ('งาน', 'สถานะ', 'ไรเดอร์', 'รุ่น'), [('#3cfed3ca', 'รับงานแล้ว', 'ไรเดอร์ #1a2b3c', '4'), ('#7a21b9e0', 'รอเสนองาน', '—', '2'), ('#b04c11d2', 'ถึงร้านแล้ว', 'ไรเดอร์ #5e6f7a', '6'), ('#c8d5e9f0', 'กำลังส่ง', 'ไรเดอร์ #9c0d1e', '8')], (L + 20, L + 200, L + 420, L + 660), {1: 'info'})
    f.card(1088, 290, 320, 290, 'ควบคุมงาน'); f.text('เลือกงานเพื่อเสนอ มอบหมาย หรือปล่อยงาน ทุกคำสั่งตรวจสิทธิ์และรุ่นใหม่', 1108, 326, 12, 'Regular', MUTED, 280)
    f.button('เสนองานให้ไรเดอร์', 1108, 392, 280); f.button('มอบหมายด้วยตนเอง', 1108, 446, 280, False); f.button('ปล่อยงาน', 1108, 500, 280, False)
    f.card(L, 600, 1144, 90, 'นโยบายค้นหาอัตโนมัติ'); f.text('ร่างจัดส่งรวมล่าสุด · บันทึกร่างแล้ว ยังไม่ได้เสนอหรือมอบหมายงานให้ไรเดอร์', L + 20, 640, 13, 'Regular', MUTED, 1000)
def pl03(f):
    f.card(L, 200, 520, 440, 'รายการตรวจสอบ'); f.text('เรียงตามรหัส แสดงครั้งละไม่เกิน 20 รายการ ทุกการอ่านถูกบันทึก', L + 20, 236, 12, 'Regular', MUTED, 480)
    rows = [('ไรเดอร์ #1a2b3c4d', 'มอเตอร์ไซค์ · รอตรวจ', 'warn', 'รอตรวจ'), ('ไรเดอร์ #5e6f7a8b', 'มอเตอร์ไซค์ · ตรวจแล้ว', 'ok', 'อนุมัติแล้ว'), ('ไรเดอร์ #9c0d1e2f', 'ทะเบียนรถหมดอายุ', 'bad', 'ต้องแก้ไข'), ('ไรเดอร์ #3b4c5d6e', 'จักรยานยนต์ · รอตรวจ', 'warn', 'รอตรวจ')]
    for i, (a, b, tone, c) in enumerate(rows):
        y = 268 + i * 82; f.rect(L + 16, y, 488, 70, BG, LINE, 12); f.text(a, L + 32, y + 12, 14, 'SemiBold'); f.text(b, L + 32, y + 38, 12, 'Regular', MUTED); f.chip(c, L + 380, y + 22, tone, 100)
    f.button('หน้าถัดไป', L + 16, 600, 150, False, 32)
    f.card(808, 200, 600, 440, 'รายละเอียดใบสมัคร'); f.text('รถ · ใบขับขี่หมดอายุ · ทะเบียนรถหมดอายุ แสดงจากข้อมูลที่ส่งมา', 828, 236, 12, 'Regular', MUTED, 560)
    f.field('รถ', 'มอเตอร์ไซค์ · กข 1234', 828, 270, 270); f.field('ใบขับขี่หมดอายุ', '14 ก.ค. 2028', 1118, 270, 270)
    f.field('เหตุผลที่ตรวจสอบย้อนกลับได้', 'เอกสารครบ ตรงกับบัตรประชาชน', 828, 346, 560); f.field('อ้างอิงหลักฐานภายนอก', 'KYC-2026-1042', 828, 422, 270); f.field('ตรวจสอบใช้ได้ถึง', '14 ก.ค. 2027', 1118, 422, 270)
    f.button('อนุมัติ', 828, 568, 270); f.button('ปฏิเสธ', 1118, 568, 270, False)
def pl04(f):
    f.card(L, 200, 520, 440, 'คิวตามร้านที่ได้รับสิทธิ์'); f.text('ข้อมูลประวัติที่ปลอดภัย ไม่ใช่สถานะงานปัจจุบัน', L + 20, 236, 12, 'Regular', MUTED, 480)
    rows = [('รายงาน #c91f04aa', 'ส่งไม่สำเร็จ · ลูกค้าไม่รับ', 'warn', 'รอรับทราบ'), ('รายงาน #d2e7881b', 'อาหารเสียหาย', 'info', 'รับทราบแล้ว'), ('รายงาน #e5a3c067', 'ไรเดอร์ขอเปลี่ยนผู้รับงาน', 'ok', 'อนุญาตต่อ'), ('รายงาน #f0b4d178', 'คืนอาหารที่ร้านแล้ว', 'ok', 'ปิดหน้าที่แล้ว')]
    for i, (a, b, tone, c) in enumerate(rows):
        y = 268 + i * 82; f.rect(L + 16, y, 488, 70, BG, LINE, 12); f.text(a, L + 32, y + 12, 14, 'SemiBold'); f.text(b, L + 32, y + 38, 12, 'Regular', MUTED); f.chip(c, L + 372, y + 22, tone, 112)
    f.card(808, 200, 600, 440, 'ตรวจเหตุของงาน')
    for i, (a, b) in enumerate((('รายงาน / รุ่น', '#c91f04aa / 3'), ('งานเดิม / รุ่นงานและสิทธิ์', '#3cfed3ca / 4 / 2'), ('รุ่นการส่งอาหารปัจจุบัน', '5'), ('ขั้นตอนทางกายภาพเดิม / สิทธิ์', 'ถึงปลายทาง / ถูกต้อง'))):
        f.text(a, 828, 250 + i * 44, 13, 'Regular', MUTED); f.text(b, 1130, 250 + i * 44, 13, 'SemiBold')
    f.rect(828, 440, 560, 70, AMBER_BG, None, 12); f.text('การรับทราบหรืออนุญาตให้ทำงานต่อ ไม่ใช่การส่งมอบ คืนเงิน หรือจ่ายเงิน', 844, 462, 13, 'Regular', AMBER, 530)
    f.button('รับทราบเหตุ', 828, 540, 270); f.button('อนุญาตให้ทำงานเดิมต่อ', 1118, 540, 270, False)
def pl05(f):
    f.card(L, 200, 400, 440, 'คิวคำร้อง')
    rows = [('#SP-1042', 'คำขอสำเนาข้อมูลบัญชี', 'info', 'เปิดคำร้อง'), ('#SP-1041', 'สอบถามการคืนเงิน', 'warn', 'รอข้อมูลลูกค้า'), ('#SP-1038', 'ปัญหาการชำระเงิน', 'ok', 'ปิดแล้ว'), ('#SP-1036', 'เรื่องทั่วไป', 'info', 'เปิดคำร้อง')]
    for i, (a, b, tone, c) in enumerate(rows):
        y = 244 + i * 86; f.rect(L + 16, y, 368, 74, BG, LINE, 12); f.text(a, L + 32, y + 12, 14, 'SemiBold'); f.text(b, L + 32, y + 38, 12, 'Regular', MUTED); f.chip(c, L + 250, y + 12, tone, 120)
    f.card(688, 200, 720, 440, 'คำขอสำเนาข้อมูลบัญชี · #SP-1042'); f.text('เหตุผลที่เข้าถึงข้อมูล: ตอบคำร้องของลูกค้า (บันทึกตรวจสอบ)', 708, 236, 12, 'Regular', MUTED, 680)
    f.rect(708, 270, 440, 62, BG, LINE, 14); f.text('ลูกค้า', 724, 280, 12, 'SemiBold', PUR); f.text('ขอสำเนาข้อมูลบัญชีและที่อยู่ที่บันทึกไว้', 724, 302, 13)
    f.rect(948, 346, 440, 62, TINT, None, 14); f.text('ทีมช่วยเหลือ', 964, 356, 12, 'SemiBold', PUR); f.text('รับเรื่องแล้ว กำลังตรวจสอบสิทธิ์ก่อนส่งข้อมูล', 964, 378, 13)
    f.field('ตอบลูกค้า', 'พิมพ์ข้อความ…', 708, 440, 680, 64); f.button('ส่งข้อความ', 708, 540, 200); f.button('ปิดคำร้อง', 924, 540, 200, False); f.button('โหลดข้อความใหม่', 1140, 540, 248, False)
def pl06(f):
    for i, (s, tone) in enumerate((('รอตรวจสอบ', 'warn'), ('เผยแพร่แล้ว', 'ok'), ('ไม่เผยแพร่', 'bad'), ('ลูกค้าถอนรีวิว', 'info'))): f.chip(s, L + i * 134, 200, tone, 124)
    f.card(L, 244, 440, 396)
    rows = [('รีวิว #r-2210', 'ร้านทดสอบ · 5 ดาว', 'warn', 'รอตรวจสอบ'), ('รีวิว #r-2209', 'ร้านทดสอบ · 3 ดาว', 'warn', 'รอตรวจสอบ'), ('รีวิว #r-2208', 'ร้านทดสอบ · 2 ดาว', 'ok', 'เผยแพร่แล้ว'), ('รีวิว #r-2203', 'ร้านทดสอบ · 4 ดาว', 'bad', 'ไม่เผยแพร่')]
    for i, (a, b, tone, c) in enumerate(rows):
        y = 262 + i * 86; f.rect(L + 16, y, 408, 74, BG, LINE, 12); f.text(a, L + 32, y + 12, 14, 'SemiBold'); f.text(b, L + 32, y + 38, 12, 'Regular', MUTED); f.chip(c, L + 296, y + 22, tone, 112)
    f.card(728, 244, 680, 396, 'รีวิว #r-2210'); f.text('รีวิวจากออเดอร์ที่รับอาหารแล้ว · ตรวจข้อความก่อนเผยแพร่', 748, 280, 12, 'Regular', MUTED, 640)
    f.rect(748, 312, 640, 76, BG, LINE, 14); f.text('กาแฟหอม ส่งเร็ว ไรเดอร์สุภาพมาก', 764, 328, 14); f.text('คะแนนไรเดอร์ 5 ดาว', 764, 358, 12, 'Regular', MUTED)
    f.field('เหตุผลการตัดสินใจ', 'ข้อความเหมาะสม ไม่มีข้อมูลส่วนตัว', 748, 408, 640, 56); f.text('หากไม่เผยแพร่ เหตุผลนี้จะแสดงให้เจ้าของรีวิวทราบ', 748, 492, 12, 'Regular', MUTED)
    f.button('เผยแพร่รีวิว', 748, 540, 310); f.button('ไม่เผยแพร่รีวิว', 1078, 540, 310, False)
def pl07(f):
    for i, (a, b) in enumerate((('โอนเงินแล้ว', '฿ 12,400'), ('รายได้ที่เป็นหนี้', '฿ 3,260'), ('ยอดจ่ายโทเคนตามนโยบายเดิม', '38.60 USDG'))):
        x = L + i * 290; f.card(x, 200, 270, 100); f.text(a, x + 20, 216, 13, 'Regular', MUTED, 230); f.text(b, x + 20, 244, 26, 'SemiBold', PUR)
    f.rect(L + 880, 200, 264, 100, AMBER_BG, None, 16); f.text('ใบรับคำสั่งบัญชี ไม่ใช่ใบยืนยันโอน', L + 896, 226, 14, 'SemiBold', AMBER, 232)
    f.table(L, 320, 780, ('ข้อเท็จจริงรายได้', 'ไรเดอร์', 'ยอด', 'สถานะ'), [('งาน #3cfed3ca', 'ไรเดอร์ #1a2b3c', '฿ 45', 'รอจ่าย'), ('งาน #b04c11d2', 'ไรเดอร์ #5e6f7a', '฿ 52', 'ในร่าง'), ('งาน #c8d5e9f0', 'ไรเดอร์ #9c0d1e', '฿ 38', 'จ่ายแล้ว')], (L + 20, L + 230, L + 440, L + 620), {3: 'info'})
    f.card(1068, 320, 340, 300, 'เตรียมรอบจ่าย'); f.text('ควบคุมร่างที่เลือก', 1088, 358, 13, 'Regular', MUTED); f.field('รหัสร้าน (UUID)', 'เซิร์ฟเวอร์ตรวจขอบเขตสิทธิ์', 1088, 392, 300)
    f.button('โหลดรายการปัจจุบัน', 1088, 480, 300, False); f.button('บันทึกร่างรอบจ่าย', 1088, 534, 300)
def pl08(f):
    f.card(L, 200, 480, 440, 'คิวตามร้านที่ได้รับสิทธิ์'); f.text('ประวัติล่าสุดไม่เกิน 50 รายการ ไม่มีรายละเอียดส่วนตัว', L + 20, 236, 12, 'Regular', MUTED, 440)
    rows = [('คำขอ #f1ebd040', 'สถานะเมื่อขอ: รับงานแล้ว', 'warn', 'รอตรวจสอบ'), ('คำขอ #a7c20e19', 'สถานะเมื่อขอ: เตรียมอาหาร', 'warn', 'รอตรวจสอบ'), ('คำขอ #0b9f3d55', 'สถานะเมื่อขอ: กำลังส่ง', 'ok', 'ตรวจสอบแล้ว')]
    for i, (a, b, tone, c) in enumerate(rows):
        y = 268 + i * 86; f.rect(L + 16, y, 448, 74, BG, LINE, 12); f.text(a, L + 32, y + 12, 14, 'SemiBold'); f.text(b, L + 32, y + 38, 12, 'Regular', MUTED); f.chip(c, L + 332, y + 22, tone, 116)
    f.card(768, 200, 640, 440, 'ตรวจคำขอ'); f.text('คำขอ / รุ่น  #f1ebd040 / 2        สถานะจัดส่งจริง / รุ่น  รับงานแล้ว / 4', 788, 240, 13, 'Regular', MUTED, 600)
    f.field('วัตถุประสงค์ก่อนอ่านรายละเอียดส่วนตัว (บันทึกตรวจสอบ)', 'ตรวจคำขอยกเลิกของลูกค้า', 788, 290, 600); f.button('อ่านรายละเอียดพร้อมบันทึกการเข้าถึง', 788, 380, 600, False)
    f.rect(788, 450, 600, 70, BG, LINE, 14); f.text('ซ่อนใน 30 วินาทีและเมื่อซ่อนหน้า ไม่เก็บรายละเอียดในเบราว์เซอร์', 804, 474, 13, 'Regular', MUTED, 570)
    f.rect(788, 540, 600, 56, GREEN_BG, None, 14); f.text('ผลการตรวจสอบ — ไม่ใช่ดำเนินการคืนเงิน', 804, 556, 14, 'SemiBold', GREEN, 570)
def pl09(f):
    f.card(L, 200, 560, 440, 'อัตราค่าโดยสาร'); f.field('สกุลเงิน', 'THB', L + 20, 250, 250); f.field('ตำแหน่งทศนิยม', '2', L + 290, 250, 250); f.field('ส่วนลดเดินทางร่วม (100 = 1%)', '1000', L + 20, 326, 250)
    f.text('ตัวเลือกเดินทางร่วมเปลี่ยนอัตราเท่านั้น ยังไม่มีระบบจับคู่ผู้โดยสารหลายคน', L + 20, 410, 12, 'Regular', MUTED, 520)
    f.button('ตรวจอัตรา', L + 20, 560, 250, False); f.button('ประกาศอัตรานี้', L + 290, 560, 250)
    f.card(848, 200, 560, 300, 'ประกาศล่าสุด'); f.text('ตรวจทานก่อนประกาศ', 868, 236, 12, 'Regular', MUTED)
    for i, (a, b) in enumerate((('สกุลเงิน', 'THB'), ('ทศนิยม', '2'), ('หน่วยย่อย', '100'), ('ส่วนลดร่วม', '10%'))): f.text(a, 868, 276 + i * 44, 13, 'Regular', MUTED); f.text(b, 1100, 276 + i * 44, 13, 'SemiBold')
    f.rect(848, 520, 560, 80, AMBER_BG, None, 14); f.text('ยังไม่มีการรับเงิน รายได้คนขับ การคืนเงิน หรือบทลงโทษจากหน้านี้', 868, 548, 13, 'Regular', AMBER, 520)
def pl10(f):
    f.table(L, 200, 780, ('เคส', 'ยอด', 'สถานะ', 'อัปเดตล่าสุด'), [('ออเดอร์ #3228f2da', 'USD 3.90 · USDG devnet', 'คืนเงินแล้ว', '28 ต.ค.'), ('ออเดอร์ #81c47e02', 'USD 1.00 · USDG devnet', 'กำลังคืนเงิน', '29 ต.ค.'), ('ออเดอร์ #b6d90f13', 'รอการตัดสิน', 'รอตัดสิน', '29 ต.ค.')], (L + 20, L + 230, L + 470, L + 650), {2: 'info'})
    f.card(1068, 200, 340, 380, 'ตรวจรายการเงินเข้าเพิ่ม'); f.text('เพิ่มภาระคืนเงินที่ขาด ไม่โอนเงิน', 1088, 238, 12, 'Regular', MUTED, 300)
    f.field('เหตุผลการตรวจรายการเพิ่ม', 'ยอดเงินเข้าไม่ครบ', 1088, 272, 300); f.button('โหลดสถานะก่อนตรวจเงินเข้า', 1088, 360, 300, False); f.button('เพิ่มภาระ', 1088, 414, 300)
    f.rect(L, 420, 780, 90, AMBER_BG, None, 14); f.text('ยังไม่ยืนยันโอนคืน ถ้าไม่ทราบผลให้กู้คำสั่งเดิม ไม่ส่งคำสั่งใหม่', L + 20, 450, 13, 'Regular', AMBER, 740)

PLAN = [('PL01-hub', pl01, 'สิทธิ์ตรวจโดยเซิร์ฟเวอร์ทุกคำสั่ง', 'การเข้าสู่ระบบเจ้าหน้าที่ไม่ให้สิทธิ์อัตโนมัติ และไม่ใช้สิทธิ์หรือคุกกี้ของร้าน'),
        ('PL02-dispatch', pl02, 'ภาพสถานะจากเซิร์ฟเวอร์', 'ไม่ใช่แผนที่ติดตามสด ทุกคำสั่งตรวจสิทธิ์และรุ่นใหม่ · เซิร์ฟเวอร์บันทึกคำสั่งแล้ว ไม่ใช่หลักฐานชำระเงิน ส่งอาหาร หรือโอนรายได้'),
        ('PL03-drivers', pl03, 'การอนุมัติแยกจากการสมัคร', 'สิทธิ์ส่วนกลางแยกจากเจ้าของร้าน การส่งใบสมัครไม่ใช่การอนุมัติ'),
        ('PL04-incidents', pl04, 'ข้อมูลประวัติที่ปลอดภัย', 'ไม่ใช่สถานะงานปัจจุบัน ทุกคำสั่งตรวจสิทธิ์และรุ่นใหม่อีกครั้ง'),
        ('PL05-support', pl05, 'ทุกการเข้าถึงข้อมูลถูกบันทึก', 'ต้องระบุเหตุผลที่เข้าถึงข้อมูลก่อนเปิดคำร้อง'),
        ('PL06-reviews', pl06, 'ทุกการตัดสินใจมีเหตุผลและประวัติ', 'หากไม่เผยแพร่ เหตุผลจะแสดงให้เจ้าของรีวิวทราบ'),
        ('PL07-driver-earnings', pl07, 'เจ้าหน้าที่การเงิน · เซสชันแยกจากร้าน', 'ไม่ใช้สิทธิ์หรือคุกกี้ร้านเพื่อสั่งการเงิน ผลคำสั่งเดิมยังไม่ทราบ ให้กู้คืนคำสั่งเดิมทุกไบต์'),
        ('PL08-cancel-reviews', pl08, 'ผลการตรวจสอบ ไม่ใช่ดำเนินการคืนเงิน', 'ภาพสถานะจากเซิร์ฟเวอร์ ไม่ใช่สตรีมสด ทุกคำสั่งตรวจสิทธิ์และรุ่นใหม่อีกครั้ง'),
        ('PL09-rides', pl09, 'ประกาศอัตราและตรวจเหตุระหว่างเดินทาง', 'ยังไม่มีการรับเงิน รายได้คนขับ การคืนเงิน หรือบทลงโทษจากหน้านี้'),
        ('PL10-refund-reconciliation', pl10, 'ตรวจเงินเข้าก่อนเพิ่มภาระ', 'บันทึกสำเร็จแล้วแต่โหลดสถานะล่าสุดไม่ได้ ให้โหลดสถานะอีกครั้ง ไม่ส่งคำสั่งใหม่')]
cur = src
for name, fn, ft, fs in PLAN:
    fid = ids[name]; f = Frame(fid); f.rect(232, 190, 1208, 610, BG, None, 0)
    fn(f)
    foot = footer_ids(cur, fid)
    cmds = f.cmds[:]
    cmds = [c for c in cmds if not (c['command'] == 'node.set' and len(c['params']) == 1)]
    if len(foot) >= 2:
        cmds.append({"command": "node.set", "params": {"ids": [foot[0]['id']], "characters": ft}})
        cmds.append({"command": "node.set", "params": {"ids": [foot[1]['id']], "characters": fs, "textAutoResize": "none", "width": 1080}})
    nxt = 'pf-%s.figcraft' % name
    bad = run(cmds, cur, nxt)
    print(name, len(cmds), 'commands, failures', len(bad), [str(b.get('error'))[:80] for b in bad[:1]])
    cur = nxt
subprocess.run(['cp', cur, dst]); print('wrote', dst)
