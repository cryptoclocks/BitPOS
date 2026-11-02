# -*- coding: utf-8 -*-
"""Adds the "Regulars" membership-badge screens to a copy of the BitPOS UI master (FigCraft), 2026-11-01.
   U47 rewards + Regulars section, U48 wallet-verify sheet (User App page), W23/W24 /loyalty web page (Pay Mobile page),
   P42 POS settings "Regulars" (POS Desktop page). Mirrors apps/mobile-customer/lib/loyalty_section.dart,
   apps/web/src/components/LoyaltyBind.tsx and LoyaltySettings.tsx. Badges are Solana devnet only, non-transferable, no monetary value.
   usage: python3 gen_regulars.py <master.figcraft> <out.figcraft>"""
import json, subprocess, sys, tempfile, os
CLI = os.path.expanduser('~/.local/bin/figcraft-cli')
src, dst = sys.argv[1], sys.argv[2]
PAGES = {'user': 278, 'pos': 4237, 'paymobile': 8515}
INK, MUTED, BRAND, DEEP, GOLD, BG, WHITE, LINE = '#29183F', '#7B7088', '#64188A', '#3C0F5A', '#FFD36B', '#F8F5FC', '#FFFFFF', '#E9E1F1'
CARD = '#55157A'
FONT = 'Noto Sans Thai'

def run(cmds, a, b):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(cmds, f); path = f.name
    out = subprocess.run([CLI, 'run', path, '--in', a, '--out', b], capture_output=True, text=True)
    os.unlink(path)
    rows = [json.loads(l) for l in out.stdout.splitlines() if l.startswith('{')]
    bad = [r for r in rows if not r.get('ok')]
    if bad or out.returncode: raise SystemExit('figcraft failed: ' + json.dumps(bad[:2]) + out.stderr[:300])
    return rows

class Page:
    def __init__(self): self.cmds = []
    def rect(self, p, x, y, w, h, fill, r=0, opacity=None, stroke=None, name=None):
        props = {'fill': fill, 'cornerRadius': r}
        if opacity is not None: props['opacity'] = opacity
        if stroke: props.update({'stroke': stroke, 'strokeWeight': 1})
        self.cmds.append({'command': 'node.create', 'params': {'type': 'rectangle', 'x': x, 'y': y, 'width': w, 'height': h, 'parent': p, 'name': name, 'props': props, 'select': False}})
    def ring(self, p, x, y, d, fill, start=-90, sweep=360, inner=0.8, opacity=None):
        props = {'fill': fill, 'arcStart': start, 'arcSweep': sweep, 'arcInner': inner}
        if opacity is not None: props['opacity'] = opacity
        self.cmds.append({'command': 'node.create', 'params': {'type': 'ellipse', 'x': x, 'y': y, 'width': d, 'height': d, 'parent': p, 'props': props, 'select': False}})
    def dot(self, p, x, y, d, fill, opacity=None, stroke=None):
        props = {'fill': fill}
        if opacity is not None: props['opacity'] = opacity
        if stroke: props.update({'stroke': stroke, 'strokeWeight': 2})
        self.cmds.append({'command': 'node.create', 'params': {'type': 'ellipse', 'x': x, 'y': y, 'width': d, 'height': d, 'parent': p, 'props': props, 'select': False}})
    def text(self, p, s, x, y, size=14, style='Regular', fill=INK, width=None, align=None, spacing=None, underline=False, opacity=None, mono=False):
        props = {'fontFamily': 'Noto Sans Mono' if mono else FONT, 'fontStyle': style, 'fontSize': size, 'fill': fill}
        if align: props['textAlign'] = align
        if spacing: props['letterSpacing'] = spacing
        if underline: props['textDecoration'] = 'underline'
        if opacity is not None: props['opacity'] = opacity
        q = {'text': s, 'x': x, 'y': y, 'parent': p, 'props': props}
        if width: q['width'] = width; props['textAutoResize'] = 'height'
        self.cmds.append({'command': 'text.create', 'params': q})

def frames():
    c = []
    for page, name, w, h in (('user', 'U47-regulars', 390, 1050), ('user', 'U48-regulars-verify-wallet', 390, 844),
                             ('paymobile', 'W23-loyalty-bind', 390, 844), ('paymobile', 'W24-loyalty-bind-done', 390, 844),
                             ('pos', 'P42-regulars-settings', 1440, 1000)):
        c.append({'command': 'page.select', 'params': {'id': PAGES[page]}})
        c.append({'command': 'frame.create', 'params': {'width': w, 'height': h, 'name': name, 'props': {'fill': BG, 'clip': True}}})
    return c

def toggle(P, f, x, y, on=True):
    P.rect(f, x, y, 46, 26, GOLD if on else WHITE, 13, None if on else 0.27)
    P.dot(f, x + (22 if on else 3), y + 3, 20, DEEP if on else WHITE)

def shop_card(P, f, y, name, tier, points, frac, to_next, badge_held, wallet, h=330):
    P.rect(f, 24, y, 342, h, CARD, 28, name='card-' + name)
    P.text(f, name, 44, y + 20, 18, 'SemiBold', WHITE, 200)
    w = 78 if tier else 104
    P.rect(f, 346 - w, y + 18, w, 30, GOLD if tier else WHITE, 15, None if tier else 0.2)
    P.text(f, tier or 'ยังไม่มีระดับ', 346 - w, y + 24, 13, 'SemiBold', DEEP if tier else WHITE, w, 'center')
    P.ring(f, 40, y + 68, 112, WHITE, -90, 360, 0.82, 0.2)
    P.ring(f, 40, y + 68, 112, GOLD, -90, int(360 * frac), 0.82)
    P.text(f, str(points), 40, y + 98, 28, 'Bold', WHITE, 112, 'center')
    P.text(f, 'แต้มสะสม', 40, y + 132, 11, 'Regular', WHITE, 112, 'center', opacity=0.8)
    P.text(f, to_next, 172, y + 100, 15, 'Regular', WHITE, 178)
    if badge_held:
        P.rect(f, 44, y + 184, 52, 73, '#F4F7FF', 8); P.rect(f, 46, y + 186, 48, 69, '#3C0F5A', 6); P.rect(f, 50, y + 196, 40, 32, '#C58BE6', 4)
        P.dot(f, 61, y + 208, 18, '#FFF3E2'); P.rect(f, 60, y + 198, 20, 6, '#F0B429', 2); P.rect(f, 50, y + 236, 40, 4, '#FFD36B', 2); P.rect(f, 56, y + 244, 28, 3, WHITE, 1, 0.5)
    else:
        P.dot(f, 44, y + 196, 46, WHITE, 0.15)
        P.rect(f, 59, y + 216, 16, 12, WHITE, 3); P.ring(f, 61, y + 205, 12, WHITE, -180, 180, 0.62)
    P.text(f, 'ถือตราอยู่ในกระเป๋า (devnet)' if badge_held else 'ยังไม่มีตรา', 112, y + 208, 15, 'SemiBold', WHITE, 230)
    P.rect(f, 44, y + 272, 302, 1, WHITE, 0, 0.2)
    P.text(f, 'ส่งตราไปที่กระเป๋าของฉัน', 44, y + 286, 15, 'SemiBold', WHITE, 230)
    toggle(P, f, 300, y + 284, True)
    P.text(f, 'ข้อมูลที่ควรรู้ ⌄', 44, y + 316, 13, 'Regular', WHITE, 160, underline=True, opacity=0.8)
    if wallet:
        P.dot(f, 44, y + 338, 20, '#A5F3B4'); P.text(f, '✓', 44, y + 340, 12, 'Bold', DEEP, 20, 'center'); P.text(f, 'กระเป๋าที่ยืนยันแล้ว: 8fGR…5Sq8', 72, y + 337, 14, 'Regular', WHITE, 270)
    else:
        P.rect(f, 44, y + 336, 302, 48, GOLD, 14); P.text(f, 'ยืนยันกระเป๋า', 44, y + 350, 15, 'Bold', DEEP, 302, 'center')

def build(ids):
    P = Page(); u47, u48, w23, w24, p42 = ids
    # ---- U47 rewards + Regulars (matches loyalty_section.dart) ----
    f = u47
    P.rect(f, 0, 0, 390, 84, WHITE); P.rect(f, 24, 22, 40, 40, WHITE, 14, None, LINE); P.text(f, '‹', 38, 24, 28, 'Regular', BRAND)
    P.text(f, 'BitPOS Rewards', 84, 30, 20, 'SemiBold', INK, 240)
    P.text(f, 'Regulars', 24, 100, 22, 'SemiBold', INK, 200); P.text(f, 'ระดับสมาชิกของร้านที่คุณสั่งประจำ', 24, 130, 12, 'Regular', MUTED, 342)
    shop_card(P, f, 160, 'BitPOS Purple Cafe', 'Regular', 35, 0.5, 'อีก 15 แต้มถึงระดับ Gold', True, True, 380)
    shop_card(P, f, 560, 'Corner Roasters', None, 8, 0.4, 'อีก 12 แต้มถึงระดับ Regular', False, False, 410)
    P.text(f, 'ตราโอนให้คนอื่นไม่ได้ ไม่มีมูลค่าเงิน และอยู่บนเครือข่ายทดสอบ Solana devnet', 24, 990, 12, 'Regular', MUTED, 342)
    # ---- U48 verify-wallet sheet ----
    f = u48
    P.rect(f, 24, 90, 342, 260, CARD, 28); P.text(f, 'BitPOS Purple Cafe', 44, 110, 18, 'SemiBold', WHITE, 220); P.ring(f, 40, 158, 112, GOLD, -90, 180, 0.82); P.text(f, '35', 40, 188, 28, 'Bold', WHITE, 112, 'center'); P.rect(f, 0, 0, 390, 844, '#1B0B26', 0, 0.55)
    P.rect(f, 0, 420, 390, 424, '#FBF4FB', 28); P.rect(f, 165, 432, 60, 5, '#9A8FA6', 3)
    P.text(f, 'ยืนยันกระเป๋าของคุณ', 24, 456, 22, 'SemiBold', INK, 342)
    for i, s in enumerate(('เปิดลิงก์ด้านล่างในเบราว์เซอร์ของ Phantom', 'ใส่รหัสที่เห็นด้านล่าง', 'เซ็นข้อความ (ไม่ใช่การจ่ายเงิน และไม่เสียค่าธรรมเนียม)')):
        P.dot(f, 24, 504 + i * 32, 22, BRAND); P.text(f, str(i + 1), 24, 507 + i * 32, 12, 'Bold', WHITE, 22, 'center'); P.text(f, s, 56, 504 + i * 32, 14, 'Regular', INK, 310)
    P.text(f, 'SB9W-1WS7', 24, 612, 36, 'Bold', INK, 342, 'center', 4)
    P.text(f, 'https://pay.cashlessthailand.com/loyalty?code=SB9W-1WS7', 24, 668, 12, 'Regular', MUTED, 342, 'center')
    P.rect(f, 24, 700, 164, 40, WHITE, 12, None, LINE); P.text(f, 'คัดลอกรหัส', 24, 710, 14, 'SemiBold', BRAND, 164, 'center')
    P.rect(f, 202, 700, 164, 40, WHITE, 12, None, LINE); P.text(f, 'คัดลอกลิงก์', 202, 710, 14, 'SemiBold', BRAND, 164, 'center')
    P.ring(f, 24, 764, 16, BRAND, 0, 270, 0.7); P.text(f, 'รอการเซ็นจากกระเป๋า… รหัสใช้ได้ 10 นาที', 50, 764, 13, 'Regular', MUTED, 316)
    # ---- W23 / W24 public bind page (matches LoyaltyBind.tsx) ----
    for f, done in ((w23, False), (w24, True)):
        P.text(f, 'BitPOS', 24, 22, 15, 'Bold', BRAND, 120); P.rect(f, 322, 16, 44, 34, WHITE, 17, None, BRAND); P.text(f, 'ไทย', 322, 23, 13, 'SemiBold', BRAND, 44, 'center')
        P.rect(f, 20, 120, 350, 520 if not done else 440, WHITE, 28)
        P.dot(f, 140, 70, 110, GOLD); P.ring(f, 134, 64, 122, '#FFFFFF', -90, 360, 0.97, 0.9)
        P.text(f, '✓' if done else '★', 140, 98, 44, 'Bold', DEEP, 110, 'center')
        P.text(f, 'ยืนยันกระเป๋าแล้ว' if done else 'ยืนยันกระเป๋าสำหรับตราสมาชิก', 36, 196, 22, 'SemiBold', INK, 318, 'center')
        labels = ('รหัส', 'กระเป๋า', 'เซ็นยืนยัน', 'เสร็จ'); now = 3 if done else 0
        P.rect(f, 66, 254, 258, 3, BRAND, 2, 0.15)
        for i, l in enumerate(labels):
            cx = 52 + i * 86; st = 'past' if i < now else 'now' if i == now else 'next'
            P.dot(f, cx, 240, 28, '#2E9E55' if st == 'past' else BRAND if st == 'now' else '#EFE6F7')
            P.text(f, '✓' if st == 'past' else str(i + 1), cx, 246, 13, 'Bold', WHITE if st != 'next' else BRAND, 28, 'center')
            P.text(f, l, cx - 24, 274, 12, 'Regular', INK, 76, 'center')
        if not done:
            P.text(f, 'รหัสจากแอป BitPOS', 36, 318, 14, 'SemiBold', INK, 318)
            P.rect(f, 36, 344, 318, 64, WHITE, 16, None, BRAND); P.text(f, 'SB9W-1WS7', 36, 358, 28, 'Bold', INK, 318, 'center', 3)
            P.rect(f, 36, 428, 318, 52, BRAND, 16); P.text(f, 'ต่อไป', 36, 441, 16, 'Bold', WHITE, 318, 'center')
            P.text(f, 'เลือกกระเป๋า แล้วเซ็นข้อความหนึ่งข้อความ นี่ไม่ใช่การจ่ายเงิน ไม่มีค่าธรรมเนียม และไม่ให้สิทธิ์ใดๆ ในการโอนเงิน', 36, 500, 13, 'Regular', MUTED, 318)
        else:
            P.text(f, 'กลับไปที่แอป BitPOS ได้เลย — ตราจะถูกส่งเมื่อคุณถึงระดับและเปิดความยินยอมไว้', 36, 318, 14, 'Regular', MUTED, 318, 'center')
            P.text(f, '8fGR…5Sq8', 36, 392, 22, 'Bold', INK, 318, 'center', 1, mono=True)
        P.text(f, 'ตราไม่มีมูลค่าเงิน โอนให้ผู้อื่นไม่ได้ และบันทึกบนเครือข่ายทดสอบ Solana devnet', 36, 560 if not done else 480, 12, 'Regular', MUTED, 318, 'center')
    # ---- P42 POS settings Regulars (matches LoyaltySettings.tsx) ----
    f = p42
    P.rect(f, 0, 0, 280, 1000, WHITE); P.text(f, 'ตั้งค่า', 32, 32, 26, 'Bold', INK, 200)
    for i, (l, on) in enumerate((('ผังร้านและอุปกรณ์', 0), ('เมนูและราคา', 0), ('กระเป๋ารับเงิน', 0), ('ผู้ใช้งานและสิทธิ์', 0), ('ช่องทางเดลิเวอรี', 0), ('ลูกค้าประจำ', 1))):
        y = 96 + i * 64
        if on: P.rect(f, 16, y - 8, 248, 52, '#F1E7F8', 14)
        P.text(f, l, 40, y + 4, 15, 'SemiBold' if on else 'Regular', BRAND if on else INK, 210)
    P.rect(f, 304, 32, 1104, 936, WHITE, 24)
    P.text(f, 'Regulars · ลูกค้าประจำ', 336, 60, 24, 'Bold', INK, 700)
    P.rect(f, 336, 108, 1040, 52, '#EFE6F7', 12); P.text(f, 'ระดับสมาชิกคิดจากแต้มสะสมตลอดชีพ (ออเดอร์ที่จ่ายแล้วและไม่มีคืนเงิน) ตราบน Solana devnet โอนต่อไม่ได้ ไม่มีมูลค่าเงิน และลูกค้าต้องยินยอมก่อนจึงจะได้รับ', 352, 120, 13, 'Regular', INK, 1010)
    for i, (n, l) in enumerate((('48', 'ลูกค้าที่จ่ายแล้ว'), ('31', 'กลับมาซื้อซ้ำ'), ('65%', 'อัตราซื้อซ้ำ'), ('17', 'สมาชิกที่ยินยอม'), ('9', 'ตราที่ถืออยู่'))):
        x = 336 + i * 212
        P.rect(f, x, 184, 196, 96, CARD, 18); P.text(f, n, x + 18, 198, 32, 'Bold', WHITE, 160); P.text(f, l, x + 18, 244, 13, 'Regular', WHITE, 170, opacity=0.85)
        if n == '65%': P.rect(f, x + 18, 268, 160, 6, WHITE, 3, 0.2); P.rect(f, x + 18, 268, 104, 6, GOLD, 3)
    for i, (nm, mn, mint) in enumerate((('ประจำ · Regular', '5', True), ('ทอง · Gold', '20', False), ('', '', False))):
        y = 304 + i * 142
        P.rect(f, 336, y, 1040, 128, WHITE, 18, None, LINE); P.text(f, 'ระดับ %d' % (i + 1), 356, y + 14, 15, 'Bold', INK, 120)
        if mint: P.rect(f, 1220, y + 12, 140, 26, '#DDF3E4', 13); P.text(f, 'มีตราบนเชนแล้ว', 1220, y + 17, 12, 'SemiBold', '#1D7A40', 140, 'center')
        for j, (lab, val, w) in enumerate((('ชื่อ (ไทย)', nm.split(' · ')[0] if nm else '', 260), ('ชื่อ (อังกฤษ)', nm.split(' · ')[-1] if nm else '', 260), ('แต้มสะสมที่ต้องมี', mn, 220))):
            x = 356 + j * 290
            P.text(f, lab, x, y + 50, 12, 'Regular', INK, w); P.rect(f, x, y + 72, w, 40, WHITE, 12, None, '#CDBFDB'); P.text(f, val, x + 12, y + 82, 14, 'Regular', INK, w - 24)
        toggle(P, f, 1176, y + 78, bool(nm)); P.text(f, 'เปิดใช้', 1230, y + 82, 14, 'Regular', INK, 60)
        P.rect(f, 1290, y + 72, 70, 40, BRAND if nm else '#C9B2D8', 12); P.text(f, 'บันทึก', 1290, y + 82, 14, 'Bold', WHITE, 70, 'center')
    P.rect(f, 336, 738, 1040, 1, LINE)
    P.text(f, 'ตรวจตราสมาชิกจากเชน', 336, 758, 18, 'Bold', INK, 400); P.text(f, 'วางที่อยู่กระเป๋าของลูกค้า ระบบอ่านจาก Solana devnet โดยตรง ไม่ใช่จากฐานข้อมูลของเรา', 336, 788, 13, 'Regular', MUTED, 800)
    P.rect(f, 336, 824, 760, 44, WHITE, 12, None, '#CDBFDB'); P.text(f, '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 350, 836, 14, 'Regular', INK, 730, mono=True)
    P.rect(f, 1112, 824, 100, 44, BRAND, 12); P.text(f, 'ตรวจ', 1112, 836, 14, 'Bold', WHITE, 100, 'center')
    P.rect(f, 336, 884, 420, 56, '#FFE9B8', 16); P.dot(f, 352, 894, 36, GOLD); P.text(f, '★', 352, 899, 18, 'Bold', DEEP, 36, 'center')
    P.text(f, 'ทอง', 400, 894, 15, 'Bold', DEEP, 100); P.text(f, 'อ่านจาก solana:devnet finalized', 400, 916, 11, 'Regular', DEEP, 340, opacity=0.7)
    return P.cmds

tmp = tempfile.mkdtemp()
rows = run(frames(), src, os.path.join(tmp, 'f.figcraft'))
ids = [r['result'].get('id') or r['result'].get('ids', [None])[0] for r in rows if r['command'] == 'frame.create']
print('frames', ids, file=sys.stderr)
run(build(ids), os.path.join(tmp, 'f.figcraft'), dst)
# collectible card art (SVG -> editable frames) next to the User App frames
repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
imp = [{'command': 'page.select', 'params': {'id': PAGES['user']}}]
for n in (1, 2, 3):
    imp.append({'command': 'file.import', 'params': {'path': os.path.join(repo, 'apps', 'web', 'public', 'loyalty', 'card-%d.svg' % n), 'x': -2200 + (n - 1) * 560, 'y': -800}})
final = os.path.join(tmp, 'g.figcraft')
rows = run(imp, dst, final)
card_ids = [r['result'].get('id') or (r['result'].get('ids') or [None])[0] for r in rows if r['command'] == 'file.import']
ren = [{'command': 'node.set', 'params': {'ids': [i], 'name': 'A-regulars-card-%d' % (k + 1)}} for k, i in enumerate(card_ids)]
run(ren, final, dst)
print(json.dumps({'created': ids, 'cards': card_ids}))
