#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
"""BitPOS × Muse UI: the separate FigCraft design file for the Meta entry.

Covers meta-pay (customer: tap, Messenger, Stripe, table ordering), meta-pos (shop: orders, bookings, offers with
Allow All, evidence, menu, devices) and the BitPOS Mini screens. It uses a Meta-blue theme of its own with no
Meta logos, and has no crypto payment. The approach (SVG boards imported into a native .figcraft, hotspots turned
into prototype links) follows the pre-hackathon design/figcraft/source/build_ui.py; the screens, theme and helpers
here are new. All names, prices, orders and QR graphics are fictional fixtures.

Usage: python3 design/figcraft-meta/source/build_meta_ui.py   (writes the .figcraft, previews and handoff files)
"""
from pathlib import Path
from html import escape as E
import base64, json, hashlib, subprocess, zipfile, random, re
NOGLYPH = re.compile('[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE0F]')

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'design/figcraft-meta'
SCREENS = OUT / 'source/screens'
ASSETS = ROOT / 'design/figcraft/assets'
CLI = Path.home() / '.local/bin/figcraft-cli'
MASTER = OUT / 'BitPOS-Muse-UI.figcraft'
for d in [SCREENS, OUT / 'previews', OUT / 'handoff', OUT / 'reports']:
    d.mkdir(parents=True, exist_ok=True)

# Meta-blue theme (own values; no Meta logo or brand assets).
C = {'primary': '#0866FF', 'primaryDark': '#0450C8', 'ink': '#1C2B33', 'muted': '#65676B', 'bg': '#F0F2F5', 'white': '#FFFFFF',
     'line': '#DADDE1', 'tint': '#E7F0FF', 'tint2': '#F5F8FF', 'green': '#1E8E3E', 'greenbg': '#E6F4EA', 'red': '#D3203A', 'redbg': '#FDECEF',
     'amber': '#8A5A00', 'amberbg': '#FFF4D6', 'violet': '#7A3FF2', 'violetbg': '#F1EAFF', 'dark': '#0B1424', 'chat': '#E4E6EB'}
GRAD = ('#0866FF', '#7A3FF2')  # Muse accent: blue to violet
TOKENS = {'name': 'BitPOS × Muse', 'color': C, 'museGradient': list(GRAD), 'font': {'thai': 'Noto Sans Thai', 'latin': 'Noto Sans Thai'},
          'radius': {'control': 12, 'card': 16, 'sheet': 24, 'pill': 999}, 'spacing': [4, 8, 12, 16, 20, 24, 32, 40, 48],
          'mobile': {'width': 390, 'height': 844}, 'desktop': {'width': 1440, 'height': 1000, 'sidebar': 248},
          'mini': {'width': 480, 'height': 320}, 'tableScreen': {'width': 1024, 'height': 768},
          'status': 'design specification; all records are fictional fixtures; Stripe sandbox only; no crypto'}
(OUT / 'handoff/tokens.json').write_text(json.dumps(TOKENS, ensure_ascii=False, indent=2) + '\n')

def data_uri(p, mime):
    return f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode()
PHOTO = {n: data_uri(ASSETS / f'{n}.jpg', 'image/jpeg') for n in ['latte', 'espresso', 'iced-latte', 'croissant', 'matcha']}
LOGO = data_uri(ASSETS / 'bitpos-logo.png', 'image/png')

ICON = {
 'back': 'M15 5 8 12l7 7', 'chevron': 'm9 5 7 7-7 7', 'check': 'm5 12 4 4L20 5', 'cross': 'm6 6 12 12 M18 6 6 18', 'plus': 'M12 5v14 M5 12h14', 'minus': 'M5 12h14',
 'home': 'm3 10 9-7 9 7v10H3z M9 20v-7h6v7', 'orders': 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6', 'cart': 'M2 4h3l3 12h10l3-9H6 M10 21h.01 M18 21h.01',
 'chart': 'M3 3v18h18 M7 16v-5 M12 16V7 M17 16V4', 'settings': 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
 'user': 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a8 8 0 0 1 16 0v3', 'users': 'M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M2 21v-2a8 8 0 0 1 16 0v2 M17 4a4 4 0 0 1 0 7 M22 21v-2a6 6 0 0 0-4-6',
 'box': 'm3 7 9-4 9 4v13l-9 3-9-3z M3 7l9 4 9-4 M12 11v12', 'coffee': 'M4 8h13v10H4z M17 9h3v6h-3 M3 22h16 M7 2v3 M12 2v3', 'clock': 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 3',
 'calendar': 'M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4', 'tag': 'M3 3h9l9 9-9 9-9-9z M8 8h.01', 'spark': 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
 'shield': 'm12 2 8 4v7c0 4-8 9-8 9s-8-5-8-9V6z m-4 10 3 3 5-6', 'chat': 'M3 4h18v13H9l-6 4z M7 9h10 M7 13h6', 'card': 'M2 5h20v15H2z M2 10h20 M6 16h4',
 'nfc': 'M6 8a8 8 0 0 1 0 8 M10 6a12 12 0 0 1 0 12 M14 4a16 16 0 0 1 0 16', 'qr': 'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h3v3h3v3h-6z',
 'robot': 'M5 8h14v11H5z M9 13h.01 M15 13h.01 M12 4v4 M2 12v4 M22 12v4 M9 17h6', 'mic': 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
 'ledger': 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5', 'device': 'M3 5h18v12H3z M8 21h8 M12 17v4', 'table': 'M3 9h18 M5 9v10 M19 9v10 M8 9V5h8v4',
 'refresh': 'M20 7V2l-4 4 M20 7a9 9 0 1 0 1 9', 'logout': 'M10 3H3v18h7 M8 12h14 m-5-5 5 5-5 5', 'bell': 'M5 17h14l-2-4V8a5 5 0 0 0-10 0v5z M10 21h4',
 'search': 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', 'link': 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
 'wifi': 'M2 8a15 15 0 0 1 20 0 M5 12a10 10 0 0 1 14 0 M8.5 15.5a5 5 0 0 1 7 0 M12 19h.01', 'stripe': 'M4 6h16v12H4z M4 10h16 M8 15h3',
 'gift': 'M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8c-2-4-6-4-6-1s6 1 6 1 M12 8c2-4 6-4 6-1s-6 1-6 1', 'warn': 'M12 3 2 21h20z M12 10v5 M12 18h.01',
 'trash': 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14', 'download': 'M12 3v12 m-5-5 5 5 5-5 M4 21h16', 'printer': 'M6 9V3h12v6 M4 9h16v8H4z M7 14h10v7H7z',
}

class SVG:
    def __init__(self, w, h, bg=None):
        self.w, self.h, self.a, self.i, self.links = w, h, [], 0, []
        self.rect(0, 0, w, h, bg or C['bg'], r=0)
    def rect(self, x, y, w, h, fill=None, r=16, stroke=None, name=None, opacity=None):
        self.a.append('<rect' + (f' id="{E(name)}"' if name else '') + f' x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or C["white"]}"'
                      + (f' stroke="{stroke}" stroke-width="1"' if stroke else '') + (f' fill-opacity="{opacity}"' if opacity is not None else '') + '/>')
    def grad_rect(self, x, y, w, h, r=16, colors=GRAD, vertical=False):
        self.i += 1; k = f'g{self.i}'
        x2, y2 = ('0', '1') if vertical else ('1', '0')
        self.a.append(f'<defs><linearGradient id="{k}" x1="0" y1="0" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{colors[0]}"/><stop offset="1" stop-color="{colors[1]}"/></linearGradient></defs>'
                      f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="url(#{k})"/>')
    def circle(self, cx, cy, r, fill, stroke=None):
        self.a.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"' + (f' stroke="{stroke}" stroke-width="2"' if stroke else '') + '/>')
    def line(self, x, y, x2, y2, c=None, width=1):
        self.a.append(f'<path d="M{x} {y} L{x2} {y2}" fill="none" stroke="{c or C["line"]}" stroke-width="{width}"/>')
    def text(self, x, y, s, size=15, c=None, weight=400, anchor='start'):
        s = NOGLYPH.sub('', str(s)).rstrip()  # the bundled Thai font has no emoji or ✓ glyphs
        self.a.append(f'<text x="{x}" y="{y}" font-family="Noto Sans Thai" font-size="{size}" font-weight="{weight}" fill="{c or C["ink"]}" text-anchor="{anchor}">{E(str(s))}</text>')
    def wrap(self, x, y, s, maxchars=36, size=14, c=None, lines=4, weight=400, lh=1.6):
        out = []
        for para in str(s).split('\n'):
            while len(para) > maxchars:
                # Thai has no spaces between words: break at a space, else allow a little overflow before a hard cut.
                k = para.rfind(' ', 0, maxchars + 1)
                if k <= maxchars // 3:
                    k = para.find(' ', maxchars)
                    if k == -1 or k > maxchars * 1.3: k = len(para) if len(para) <= maxchars * 1.3 else maxchars
                if k >= len(para): break
                out.append(para[:k]); para = para[k:].lstrip()
            out.append(para)
        for n, t in enumerate(out[:lines]):
            self.text(x, y + n * size * lh, t, size, c or C['muted'], weight)
        return y + min(len(out), lines) * size * lh
    def icon(self, n, x, y, size=22, c=None, width=1.8):
        self.a.append(f'<g transform="translate({x} {y}) scale({size/24})"><path d="{ICON.get(n, ICON["box"])}" fill="none" stroke="{c or C["primary"]}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/></g>')
    def photo(self, n, x, y, w, h, r=14):
        self.i += 1; k = f'clip{self.i}'
        self.a.append(f'<defs><clipPath id="{k}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}"/></clipPath></defs>'
                      f'<image x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice" href="{PHOTO[n]}" clip-path="url(#{k})"/>')
    def logo(self, x, y, w=104, muse=True, dark=False):
        self.rect(x - 8, y - 6, w + 16, w / 3 + 12, C['white'], 10)
        self.a.append(f'<image x="{x}" y="{y}" width="{w}" height="{w/3}" href="{LOGO}"/>')
        if muse:
            self.text(x + w + 18, y + w / 6 + 6, '× Muse', 16 if w < 120 else 20, C['white'] if dark else C['primary'], 700)
    def hot(self, x, y, w, h, dest):
        if dest:
            self.rect(x, y, w, h, '#FFFFFF', 0, name=f'Hotspot → {dest}', opacity=0)
            self.links.append({'dest': dest, 'rect': [x, y, w, h]})
    def pill(self, x, y, s, tone='primary', w=None, h=28, size=12):
        w = w or max(56, len(s) * 7.2 + 26)
        bg, fg = {'primary': ('tint', 'primary'), 'green': ('greenbg', 'green'), 'red': ('redbg', 'red'), 'amber': ('amberbg', 'amber'),
                  'violet': ('violetbg', 'violet'), 'grey': ('bg', 'muted'), 'dark': ('ink', 'white')}[tone]
        self.rect(x, y, w, h, C[bg], h / 2); self.text(x + w / 2, y + h / 2 + 4.5, s, size, C[fg], 600, 'middle'); return w
    def muse(self, x, y, s='Muse Spark', w=None):
        w = w or len(s) * 7.4 + 40
        self.grad_rect(x, y, w, 28, 14); self.icon('spark', x + 9, y + 6, 16, C['white'], 1.6); self.text(x + 30, y + 18.5, s, 12, C['white'], 600); return w
    def btn(self, x, y, w, s, dest=None, style='primary', icon=None, h=52, size=16):
        fill = {'primary': C['primary'], 'secondary': C['tint'], 'outline': C['white'], 'danger': C['redbg'], 'dark': C['ink'], 'ghost': C['white']}[style]
        fg = {'primary': C['white'], 'secondary': C['primary'], 'outline': C['ink'], 'danger': C['red'], 'dark': C['white'], 'ghost': C['primary']}[style]
        self.a.append('<g>'); self.rect(x, y, w, h, fill, 12, C['line'] if style == 'outline' else None)
        tx = x + w / 2 + (13 if icon else 0)
        if icon: self.icon(icon, tx - len(s) * size * 0.27 - 30, y + h / 2 - 11, 22, fg)
        self.text(tx, y + h / 2 + size * 0.36, s, size, fg, 600, 'middle'); self.a.append('</g>')
        self.hot(x, y, w, h, dest)
    def card(self, x, y, w, h, fill=None, stroke=True, r=16):
        self.rect(x, y, w, h, fill or C['white'], r, C['line'] if stroke else None)
    def row(self, x, y, w, title, sub='', icon='box', right='', dest=None, photo=None, h=76, tone='primary', badge=None):
        self.card(x, y, w, h); ox = 16
        if photo: self.photo(photo, x + 12, y + (h - 52) / 2, 52, 52, 12); ox = 76
        elif icon: self.rect(x + 14, y + (h - 44) / 2, 44, 44, C['tint'] if tone == 'primary' else C[tone + 'bg'], 12); self.icon(icon, x + 25, y + h / 2 - 11, 22, C[tone]); ox = 72
        self.text(x + ox, y + h / 2 - (3 if sub else -5), title, 15, weight=600)
        if sub: self.text(x + ox, y + h / 2 + 18, sub, 12, C['muted'])
        if badge: self.pill(x + w - 16 - (len(badge[0]) * 7.2 + 26), y + h / 2 - 14, badge[0], badge[1])
        elif right: self.text(x + w - 16, y + h / 2 + 5, right, 15, C['ink'], 600, 'end')
        elif dest: self.icon('chevron', x + w - 32, y + h / 2 - 9, 18, C['muted'])
        self.hot(x, y, w, h, dest)
    def field(self, x, y, w, label, value='', hint='', icon=None):
        self.text(x, y, label, 13, C['muted'], 500); self.rect(x, y + 10, w, 50, C['white'], 12, C['line'])
        if icon: self.icon(icon, x + 14, y + 24, 20, C['muted'])
        self.text(x + (44 if icon else 16), y + 41, value or hint, 15, C['ink'] if value else C['muted'])
    def metric(self, x, y, w, label, value, sub='', tone='ink'):
        self.card(x, y, w, 112); self.text(x + 18, y + 30, label, 13, C['muted']); self.text(x + 18, y + 70, value, 30, C[tone], 700)
        if sub: self.text(x + 18, y + 95, sub, 12, C['muted'])
    def qr(self, x, y, size, seed=7):
        self.rect(x, y, size, size, C['white'], 12, C['line']); rnd = random.Random(seed); n = 25; cell = (size - 24) / n
        for i in range(n):
            for j in range(n):
                finder = (i < 7 and j < 7) or (i < 7 and j >= n - 7) or (i >= n - 7 and j < 7)
                on = ((i in (0, 6) or j in (0, 6) or (2 <= i <= 4 and 2 <= j <= 4)) if i < 7 and j < 7 else
                      (i in (0, 6) or j in (n - 7, n - 1) or (2 <= i <= 4 and n - 5 <= j <= n - 3)) if i < 7 and j >= n - 7 else
                      (i in (n - 7, n - 1) or j in (0, 6) or (n - 5 <= i <= n - 3 and 2 <= j <= 4)) if i >= n - 7 and j < 7 else rnd.random() < .45)
                if finder and not on: continue
                if on: self.rect(round(x + 12 + j * cell, 1), round(y + 12 + i * cell, 1), round(cell + .3, 1), round(cell + .3, 1), C['ink'], 0)
        self.text(x + size / 2, y + size + 18, 'QR ตัวอย่าง · ใช้จ่ายจริงไม่ได้', 11, C['muted'], 400, 'middle')
    def save(self, p):
        p.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">' + ''.join(self.a) + '</svg>')

# ---------------------------------------------------------------- inventory
SCREENS_LIST = []  # (id, slug, title, page, builder)
PAGES = {'start': '00 · เริ่มที่นี่', 'found': '01 · พื้นฐานการออกแบบ', 'pay': '10 · meta-pay · ลูกค้า (มือถือ)', 'chat': '11 · Messenger (มือถือ)',
         'paydesk': '12 · meta-pay · เดสก์ท็อป', 'pos': '20 · meta-pos · ร้าน (เดสก์ท็อป)', 'posm': '21 · meta-pos · มือถือ',
         'mini': '30 · BitPOS Mini (480×320)', 'tscreen': '31 · จอโต๊ะ (แท็บเล็ต)', 'states': '40 · สถานะพิเศษ', 'handoff': '50 · ส่งต่อทีมพัฒนา'}
def screen(code, slug, title, page, **meta):
    def deco(fn):
        SCREENS_LIST.append(dict(id=code, slug=slug, title=title, page=page, fn=fn, **meta)); return fn
    return deco

SHOP = 'Muse Café · ร้านเดโม'
MENU = [('latte', 'ลาเต้', 'Latte', '$5.00'), ('iced-latte', 'ลาเต้เย็น', 'Iced latte', '$5.50'), ('espresso', 'เอสเปรสโซ', 'Espresso', '$3.50'),
        ('matcha', 'มัทฉะลาเต้', 'Matcha latte', '$5.50'), ('croissant', 'ครัวซองต์', 'Croissant', '$4.00')]

# ---- mobile shell
def mobile(title, back=None, sub=None, bg=None, top=True):
    s = SVG(390, 844, bg or C['bg'])
    s.rect(0, 0, 390, 100 if top else 44, C['white'], 0); s.text(24, 29, '9:41', 13, weight=600); s.rect(332, 18, 28, 12, C['ink'], 4)
    if top:
        if back:
            s.rect(16, 50, 40, 40, C['bg'], 20); s.icon('back', 24, 58, 24, C['ink']); s.hot(16, 50, 40, 40, back)
            s.text(68, 77, title, 18, weight=700)
        else:
            s.logo(24, 54, 84); s.text(366, 77, title, 13, C['muted'], 500, 'end')
        s.line(0, 100, 390, 100)
    if sub: s.text(24, 136, sub, 13, C['muted'])
    return s
def home_bar(s, color=None): s.rect(137, 830, 116, 5, color or C['ink'], 3)
def stripe_badge(s, x, y): return s.pill(x, y, 'Stripe sandbox · ไม่ใช่เงินจริง', 'amber', 214)

# ---- desktop (meta-pos) shell
NAV = [('chart', 'ภาพรวม', 'MP02'), ('cart', 'ขายหน้าร้าน', 'MP03'), ('orders', 'ออเดอร์', 'MP05'), ('coffee', 'คิวครัว', 'MP22'), ('calendar', 'การจองโต๊ะ', 'MP08'),
       ('box', 'เมนูและสต็อก', 'MP10'), ('spark', 'โปรโมชัน', 'MP13'), ('users', 'ลูกค้า', 'MP15'), ('robot', 'Muse Connector', 'MP23'),
       ('ledger', 'หลักฐาน AI', 'MP17'), ('chart', 'รายงาน', 'MP18'), ('settings', 'ตั้งค่า', 'MP20')]
def desk(title, active, sub=None, actions=()):
    s = SVG(1440, 1000, C['bg'])
    s.rect(0, 0, 248, 1000, C['white'], 0); s.line(248, 0, 248, 1000); s.logo(28, 28, 110)
    for j, (ic, t, dest) in enumerate(NAV):
        y = 108 + j * 58
        if active == dest: s.rect(14, y - 6, 220, 46, C['tint'], 12)
        s.icon(ic, 30, y + 5, 22, C['primary'] if active == dest else C['muted']); s.text(66, y + 23, t, 15, C['primary'] if active == dest else C['ink'], 600 if active == dest else 400)
        s.hot(14, y - 6, 220, 46, dest)
    s.line(24, 832, 224, 832); s.circle(46, 870, 18, C['tint']); s.text(46, 876, 'น', 15, C['primary'], 700, 'middle')
    s.text(74, 866, 'นัท · เจ้าของร้าน', 14, weight=600); s.text(74, 888, SHOP, 12, C['muted'])
    s.icon('logout', 30, 930, 20, C['muted']); s.text(62, 946, 'ออกจากระบบ', 14, C['muted']); s.hot(16, 920, 216, 40, 'MP01')
    s.rect(248, 0, 1192, 72, C['white'], 0); s.line(248, 72, 1440, 72)
    s.text(280, 44, SHOP, 15, weight=600); s.pill(470, 22, 'Stripe sandbox', 'amber', 124); s.pill(602, 22, 'Muse Spark พร้อม', 'violet', 136)
    s.pill(1200, 22, 'ไทย / EN', 'grey', 84); s.icon('bell', 1300, 24, 22, C['muted']); s.pill(1340, 22, 'เปิดร้าน', 'green', 76)
    s.text(280, 128, title, 28, weight=700)
    if sub: s.text(280, 158, sub, 14, C['muted'])
    x = 1408
    for label, dest, style in reversed(actions):
        w = len(label) * 8.6 + 44; x -= w; s.btn(x, 100, w, label, dest, style, h=44, size=14); x -= 12
    return s
def table(s, x, y, w, heads, rows, widths=None, dests=None):
    widths = widths or [w / len(heads)] * len(heads); s.card(x, y, w, 52 + len(rows) * 60, r=14); s.rect(x, y, w, 48, C['tint2'], 14)
    xx = x
    for h, ww in zip(heads, widths): s.text(xx + 18, y + 30, h, 12, C['muted'], 600); xx += ww
    for j, row in enumerate(rows):
        yy = y + 48 + j * 60; s.line(x, yy, x + w, yy); xx = x
        for n, ww in zip(row, widths):
            if isinstance(n, tuple): s.pill(xx + 14, yy + 16, n[0], n[1])
            else: s.text(xx + 18, yy + 36, str(n), 14)
            xx += ww
        if dests and dests[j]: s.hot(x, yy, w, 60, dests[j])

# ---- BitPOS Mini 480×320: the firmware's dark layout (device/firmware/main/bitpos_meta.c render()), same grid and colours.
M = {'ink': '#0B1020', 'panel': '#18213A', 'line': '#2A3656', 'cream': '#F5F7FF', 'muted': '#A9B4CC', 'blue': '#3D8BFF',
     'green': '#31C48D', 'red': '#FF5A6A', 'violet': '#A98BFF', 'amber': '#FFB547', 'chip': '#24365E', 'chiptx': '#B9D3FF'}
MARGIN, BODY_Y, TEXT_X = 12, 52, 128
BODY_H = 320 - MARGIN - BODY_Y
def mini(table='Table 1', online=True):
    s = SVG(480, 320, M['ink'])
    s.rect(12, 4, 96, 36, '#FFF8F0', 8); s.a.append(f'<image x="18" y="9" width="84" height="26" href="{LOGO}"/>')
    s.text(120, 29, table, 18, M['cream'], 500)
    s.circle(304, 22, 4, M['green'] if online else M['amber']); s.text(314, 27, 'ONLINE' if online else 'OFFLINE', 13, M['muted'], 500)
    # Language button (English by default; it names the language it switches to, saved on the device).
    s.rect(406, 6, 62, 32, M['line'], 16); s.text(437, 28, 'ไทย', 16, M['cream'], 500, 'middle')
    return s
def mring(s, cy, tone, ic):
    s.a.append(f'<circle cx="{MARGIN + 12 + 43}" cy="{cy}" r="41" fill="{M["panel"]}" stroke="{M[tone]}" stroke-width="4"/>')
    s.icon(ic, MARGIN + 12 + 43 - 14, cy - 14, 28, M[tone], 2.4)
def mbtn(s, x, y, w, label, dest, fill=None):
    s.rect(x, y, w, 46, fill or M['blue'], 12); s.text(x + w / 2, y + 30, label, 17, '#FFFFFF', 500, 'middle'); s.hot(x, y, w, 46, dest)
def mstatus(s, tone, ic, title, big=None, join=None, lines=(), dests=()):
    """Ring + title (+ big value or the QR button) centred above a details card on the bottom margin, as the firmware does."""
    top = BODY_Y + BODY_H
    if lines:
        h = 20 + 32 * len(lines); top = BODY_Y + BODY_H - h
        s.rect(MARGIN, top, 480 - 2 * MARGIN, h, M['panel'], 12)
        for n, (t, c) in enumerate(lines): s.text(MARGIN + 16, top + 32 + n * 32, t, 17, M[c])
        top -= 12
    extra = 60 if big else 56 if join else 0; gh = max(86, 30 + extra)
    gy = BODY_Y + (top - BODY_Y - gh) // 2; mring(s, gy + gh // 2, tone, ic)
    ty = gy + (gh - 30 - extra) // 2
    s.text(TEXT_X, ty + 22, title, 18, M['cream'], 500)
    if big: s.text(TEXT_X, ty + 30 + 50, big, 48, M[tone], 500)
    if join: mbtn(s, TEXT_X, ty + 40, 220, 'Scan to chat', join, M[tone] if tone != 'cream' else None)
    for d in dests: s.hot(*d)
    return s
def mqr(s, x=MARGIN, y=BODY_Y, w=228, h=BODY_H, seed=11):
    s.rect(x, y, w, h, '#FFFFFF', 10); s.qr(x + 10, y + (h - (w - 20)) / 2, w - 20, seed); s.a.pop()  # drop the caption: the tile is the whole QR
def nfc_zone(s, x, y, label='แตะมือถือตรงนี้'):
    s.circle(x, y, 46, C['tint']); s.circle(x, y, 34, C['white'], C['primary']); s.icon('nfc', x - 14, y - 14, 28, C['primary'], 2.2); s.text(x, y + 68, label, 13, C['primary'], 600, 'middle')

# ---- table screen 1024×768
def tscreen(color, big, small, countdown=None, label=None, dest_next=None):
    s = SVG(1024, 768, color)
    s.text(512, 120, 'โต๊ะ 1 · Table 1', 26, C['white'], 600, 'middle'); s.text(512, 300, big, 64, C['white'], 700, 'middle')
    s.text(512, 360, small, 20, C['white'], 400, 'middle')
    if countdown:
        s.text(512, 440, label, 18, C['white'], 500, 'middle'); s.text(512, 540, countdown, 110, C['white'], 700, 'middle')
    s.text(512, 730, 'BitPOS × Muse · จอโต๊ะ · ไม่มีข้อมูลส่วนตัว', 14, C['white'], 400, 'middle')
    s.hot(0, 0, 1024, 768, dest_next)
    return s

# ---- Messenger mock (drawn here; not the Messenger app's own artwork)
def chat(title='BitPOS Muse Demo', back='C01'):
    s = SVG(390, 844, C['white'])
    s.text(24, 29, '9:41', 13, weight=600); s.rect(332, 18, 28, 12, C['ink'], 4)
    s.icon('back', 14, 56, 24, C['primary']); s.hot(10, 48, 40, 40, back)
    s.grad_rect(50, 50, 36, 36, 18); s.text(68, 74, 'M', 15, C['white'], 700, 'middle'); s.text(96, 66, title, 15, weight=700); s.text(96, 84, 'แชทของร้าน · ตัวอย่างหน้าจอ', 11, C['muted'])
    s.line(0, 100, 390, 100); s.pill(266, 60, 'Messenger (mock)', 'grey', 108, 24, 10)
    return s
def bubble(s, y, text, me=False, w=None, lines=1):
    w = w or min(290, max(80, len(text) * 7.4 + 30)) ; h = 22 * lines + 18; x = 366 - w if me else 24
    s.rect(x, y, w, h, C['primary'] if me else C['chat'], 18)
    for n, t in enumerate(text.split('\n')[:lines]): s.text(x + 14, y + 28 + n * 22, t, 14, C['white'] if me else C['ink'])
    return y + h + 10
def chips(s, y, items):
    x = 24
    for label, dest in items:
        w = len(label) * 7.6 + 30; s.rect(x, y, w, 36, C['white'], 18, C['primary']); s.text(x + w / 2, y + 23, label, 13, C['primary'], 600, 'middle'); s.hot(x, y, w, 36, dest); x += w + 8
def composer(s, menu=True):
    s.line(0, 770, 390, 770); s.rect(16, 780, 300, 40, C['bg'], 20); s.text(34, 805, 'พิมพ์ข้อความ…', 14, C['muted'])
    if menu: s.icon('orders', 332, 788, 24, C['primary']); s.hot(324, 780, 50, 40, 'C15')
    home_bar(s)

# ================================================================ 00 start / 01 foundations
DIRECTORY = [('meta-pay · ลูกค้า', 'แตะ → Messenger → โปร → Stripe', 'C01', 'nfc'), ('Messenger', 'สั่ง จองโต๊ะ ใบเสร็จ ในแชท', 'C08', 'chat'),
             ('สั่งที่โต๊ะ (QR)', 'เมนู ตะกร้า จ่ายด้วย Stripe', 'C18', 'qr'), ('meta-pay · เดสก์ท็อป', 'สั่งและจ่ายบนคอมพิวเตอร์', 'CD01', 'device'),
             ('meta-pos · ร้าน', 'ออเดอร์ การจอง โปร หลักฐาน', 'MP01', 'chart'), ('meta-pos · มือถือ', 'ดูออเดอร์และส่งมอบ', 'MPM01', 'orders'),
             ('BitPOS Mini', 'จอที่เคาน์เตอร์และโต๊ะ', 'B01', 'device'), ('จอโต๊ะ', 'นับถอยหลังการจอง', 'T01', 'calendar'),
             ('สถานะพิเศษ', 'ข้อผิดพลาด ออฟไลน์ สำรอง', 'S01', 'warn'), ('พื้นฐานการออกแบบ', 'สี ตัวอักษร คอมโพเนนต์', 'D01', 'settings'),
             ('ส่งต่อทีมพัฒนา', 'เส้นทาง URL และการเชื่อมโยง', 'H01', 'link'), ('รายงานความต่างจาก sol-', 'หน้าที่ต่าง เพิ่ม ตัดออก', 'A02', 'ledger')]
@screen('A00', 'start', 'เริ่มที่นี่', 'start')
def a00():
    s = SVG(1600, 1000, C['bg']); s.grad_rect(0, 0, 1600, 300, 0, (C['primary'], C['violet'])); s.logo(64, 56, 150, dark=True)
    s.text(64, 196, 'BitPOS × Muse · ไฟล์ออกแบบของงาน Meta', 40, C['white'], 700); s.text(64, 240, 'ร้านเล็กที่ลูกค้าแตะ คุยใน Messenger และจ่ายผ่าน Stripe · แยกจากไฟล์ sol- · ไม่มีคริปโต', 18, C['white'])
    for j, (t, sub, dest, ic) in enumerate(DIRECTORY):
        x = 64 + (j % 4) * 372; y = 340 + (j // 4) * 150
        s.card(x, y, 348, 128); s.rect(x + 20, y + 22, 48, 48, C['tint'], 14); s.icon(ic, x + 32, y + 34, 24, C['primary'])
        s.text(x + 84, y + 46, t, 18, weight=700); s.text(x + 84, y + 72, sub, 13, C['muted']); s.text(x + 84, y + 104, f'เริ่มที่ {dest} →', 13, C['primary'], 600); s.hot(x, y, 348, 128, dest)
    s.text(64, 820, 'ทุกชื่อ ราคา ออเดอร์ และ QR เป็นข้อมูลสมมติ · การจ่ายเงินเป็น Stripe sandbox · ไม่ใช้โลโก้หรือเครื่องหมายการค้าของ Meta', 15, C['muted'])
    s.text(64, 850, 'กดการ์ดเพื่อเข้าแต่ละส่วน · ทุกหน้ามีทางกลับ · ตรวจลิงก์ทั้งไฟล์ได้ที่ A01', 15, C['muted']); s.btn(64, 890, 260, 'ผลตรวจการเชื่อมโยง (A01)', 'A01', 'secondary', h=48, size=15)
    return s
@screen('A01', 'link-audit', 'ผลตรวจการเชื่อมโยง', 'start')
def a01():
    s = SVG(1600, 1000, C['white']); s.text(64, 90, 'ผลตรวจการเชื่อมโยงของต้นแบบ', 34, weight=700)
    s.text(64, 128, 'สร้างจาก reports/link-audit.json ทุกครั้งที่ build · กฎ: ปลายทางมีจริง · ทุกหน้าไปถึงได้จาก A00 · ทุกหน้ามีทางไปต่อหรือกลับ', 15, C['muted'])
    s.text(64, 180, '{{AUDIT}}', 16)
    s.btn(64, 900, 200, '← เริ่มที่นี่', 'A00', 'outline', h=48, size=15); return s
@screen('A02', 'diff-vs-sol', 'ความต่างจาก sol-', 'start')
def a02():
    s = SVG(1600, 1200, C['white']); s.text(64, 90, 'meta- ต่างจาก sol- อย่างไร', 34, weight=700)
    s.text(64, 128, 'รายละเอียดเต็มอยู่ใน reports/diff-vs-sol.md · sol- = BitPOS-Platform-UI.figcraft (ไฟล์ของฝั่ง Solana, อ่านอย่างเดียว)', 15, C['muted'])
    cols = [('ตัดออก (คริปโต / ไม่เกี่ยวกับงานนี้)', 'red', ['กระเป๋าเงิน Phantom / เลือกสินทรัพย์ (W07, WD03–WD07)', 'USDG / USDC / USDT-test, Solana devnet', 'x402 (WD21), PromptPay ที่ยังไม่เปิด (W08, WD17)',
             'ยอดโอนคริปโต (P38) → ยอดจาก Stripe', 'จัดส่ง/ไรเดอร์ (P32, P40, R01–R32) ไม่อยู่ในงานนี้', 'แอปลูกค้า Flutter (U01–U43) ไม่อยู่ในงานนี้']),
            ('เปลี่ยน', 'amber', ['ธีมม่วง → ฟ้า Meta + สีไล่ Muse', 'วิธีชำระ (W06) → Stripe Checkout อย่างเดียว', 'ศูนย์ออเดอร์ (P29) → แยกช่องทาง แตะ / แชท / AI / โต๊ะ / หน้าร้าน',
             'โปรโมชัน (P33–P34) → Muse Spark ร่าง + อนุมัติ + Allow All', 'โต๊ะและ BitPOS Mini (P35) → มีสติกเกอร์ NTAG + ลิงก์จอโต๊ะ', 'รายงาน 7 หน้า (P14–P20) → รวมเป็นหน้าเดียว แยกตามช่องทาง']),
            ('เพิ่มใหม่ (Meta)', 'green', ['แตะ NFC + ยินยอมใน Messenger (C01–C04, C16)', 'สั่ง/จองโต๊ะ/ใบเสร็จ ในแชท (C08–C15)', 'จอโต๊ะนับถอยหลัง (T01–T04) + Mini (B07–B09)',
             'หลักฐาน AI (MP17) · Muse Connector / MCP (MP23)', 'การจองโต๊ะ (MP08) · ลูกค้าที่ยินยอม (MP15–MP16)', 'สั่งด้วยเสียง (C11)'])]
    for j, (head, tone, items) in enumerate(cols):
        x = 64 + j * 500; s.card(x, 170, 476, 560); s.pill(x + 24, 196, head, tone, None, 32, 13)
        for n, t in enumerate(items): s.wrap(x + 24, 268 + n * 74, '• ' + t, 46, 15, C['ink'], 2)
    s.text(64, 790, 'หน้าที่คงเดิมจาก sol- (ปรับธีมและตัดคริปโต): ภาพรวม · หน้าขาย · คิวครัว · บิล/รายละเอียด · สินค้า · สต็อก · ลูกค้า · ผู้ใช้และสิทธิ์ · ตั้งค่า · คืนเงิน · เข้าสู่ระบบ', 15)
    s.text(64, 822, 'หน้าที่ sol- มีแต่ meta- รวมไว้ในหน้าอื่น: ปิดรอบขาย, รับเข้าสินค้า, ปรับสต็อก, สินค้าใกล้หมด, ซัพพลายเออร์, หมวดสินค้า, ประวัติใช้งาน, เครื่องพิมพ์, สาขา', 15)
    s.btn(64, 1100, 200, '← เริ่มที่นี่', 'A00', 'outline', h=48, size=15); return s
@screen('D01', 'foundations', 'พื้นฐานการออกแบบ', 'found')
def d01():
    s = SVG(1600, 1000, C['white']); s.text(64, 90, 'พื้นฐานการออกแบบ · BitPOS × Muse', 34, weight=700); s.text(64, 124, 'ธีมฟ้าแบบ Meta ของเราเอง · ไม่ใช้โลโก้ Meta · ตัวอักษร Noto Sans Thai', 15, C['muted'])
    for j, k in enumerate(['primary', 'primaryDark', 'ink', 'muted', 'bg', 'line', 'tint', 'green', 'red', 'amber', 'violet', 'dark']):
        x = 64 + (j % 6) * 236; y = 170 + (j // 6) * 150; s.rect(x, y, 212, 84, C[k], 14, C['line']); s.text(x, y + 108, k, 14, weight=600); s.text(x, y + 128, C[k], 13, C['muted'])
    s.grad_rect(64, 480, 420, 84, 14); s.text(64, 590, 'Muse gradient · ใช้กับป้าย AI เท่านั้น', 14, weight=600)
    for j, (t, size, wgt) in enumerate([('หัวข้อใหญ่ 34', 34, 700), ('หัวข้อหน้า 28', 28, 700), ('หัวข้อการ์ด 18', 18, 700), ('เนื้อความ 15', 15, 400), ('คำอธิบาย 13', 13, 400)]):
        s.text(560, 510 + j * 56, t, size, weight=wgt)
    s.btn(1000, 480, 260, 'ปุ่มหลัก', 'D02'); s.btn(1000, 548, 260, 'ปุ่มรอง', 'D02', 'secondary'); s.btn(1000, 616, 260, 'ปุ่มขอบ', 'D02', 'outline'); s.btn(1000, 684, 260, 'ปุ่มอันตราย', 'D02', 'danger')
    s.btn(64, 900, 200, '← เริ่มที่นี่', 'A00', 'outline', h=48, size=15); s.btn(280, 900, 220, 'คอมโพเนนต์ (D02) →', 'D02', 'secondary', h=48, size=15); return s
@screen('D02', 'components', 'คอมโพเนนต์', 'found')
def d02():
    s = SVG(1600, 1000, C['white']); s.text(64, 90, 'คอมโพเนนต์', 34, weight=700)
    x = 64
    for t, tone in [('แตะ NFC', 'primary'), ('แชท Messenger', 'violet'), ('AI agent (MCP)', 'dark'), ('สั่งที่โต๊ะ', 'green'), ('หน้าร้าน', 'grey'), ('จ่ายแล้ว', 'green'), ('รอจ่าย', 'amber'), ('ยกเลิก/คืนเงิน', 'red')]:
        x += s.pill(x, 130, t, tone) + 10
    s.muse(64, 182); stripe_badge(s, 220, 182)
    s.row(64, 240, 460, 'ลาเต้ × 1', 'แตะ NFC · #4464 · 12:30', photo='latte', badge=('จ่ายแล้ว', 'green'))
    s.row(64, 330, 460, 'โต๊ะ 1 · 19:00 · 2 คน', 'รอเช็กอิน · เหลือ 12 นาที', icon='calendar', badge=('รอเช็กอิน', 'amber'))
    s.row(64, 420, 460, 'Muse Spark ร่างโปร', 'ครัวซองต์ ลด 20% · 8 ชม.', icon='spark', tone='violet', dest='MP13')
    s.field(600, 240, 400, 'อีเมล', 'owner@muse-cafe.test', icon='user'); s.field(600, 330, 400, 'ค้นหา', hint='ค้นหาเมนูหรือออเดอร์', icon='search')
    s.metric(1060, 240, 260, 'ยอดวันนี้', '$184.50', '41 ออเดอร์ · Stripe sandbox', 'primary'); s.qr(1060, 380, 180)
    s.btn(64, 900, 200, '← เริ่มที่นี่', 'A00', 'outline', h=48, size=15); s.btn(280, 900, 220, '← พื้นฐาน (D01)', 'D01', 'secondary', h=48, size=15); return s

# ================================================================ 10 meta-pay mobile: tap → Messenger → offer → Stripe
@screen('C01', 'tap-first', 'แตะครั้งแรก', 'pay', route='/meta/t/:tag → m.me')
def c01():
    s = mobile('meta-pay'); s.rect(24, 132, 342, 300, C['white'], 24, C['line']); nfc_zone(s, 195, 250, '')
    s.text(195, 360, 'แตะแล้ว! ไปต่อใน Messenger', 20, weight=700, anchor='middle'); s.wrap(48, 392, 'เราจะถามก่อนว่าให้ร้านจำคุณได้ไหม กดไม่ยินยอมก็ได้', 32, 14, lines=2)
    s.row(24, 460, 342, 'ลิงก์นี้ใช้ได้ครั้งเดียว', 'ชิป NTAG 424 ตรวจลายเซ็นและตัวนับทุกครั้ง', icon='shield', h=72)
    s.btn(24, 676, 342, 'เปิด Messenger', 'C02', icon='chat'); s.btn(24, 740, 342, 'สั่งจาก QR บนโต๊ะแทน', 'C18', 'ghost'); home_bar(s); return s
@screen('C02', 'consent', 'ขอความยินยอมใน Messenger', 'chat', route='Messenger webhook (referral)')
def c02():
    s = chat(back='C01'); y = 130; y = bubble(s, y, 'เริ่มต้นใช้งาน', True)
    y = bubble(s, y, 'สวัสดีค่ะ Muse Café 👋\nให้ร้านจำคุณไว้ เพื่อส่งโปรเฉพาะคุณ\nและสั่ง/จองโต๊ะผ่านแชทได้ไหมคะ?', w=300, lines=3)
    s.wrap(24, y + 10, 'เก็บแค่ว่าคุณยินยอม · ไม่เก็บข้อความแชท · ลบได้ทุกเมื่อด้วย “เลิกเชื่อมต่อ”', 40, 12, lines=2)
    chips(s, y + 60, [('ยินยอม', 'C03'), ('ไม่ตอนนี้', 'C17')]); composer(s); return s
@screen('C03', 'connected', 'เชื่อมต่อแล้ว', 'pay', route='/meta/login?t=…')
def c03():
    s = mobile('เชื่อมต่อแล้ว', back='C02'); s.circle(195, 240, 56, C['greenbg']); s.icon('check', 167, 212, 56, C['green'], 2.6)
    s.text(195, 340, 'เชื่อมต่อแล้ว ✓', 26, weight=700, anchor='middle'); s.wrap(52, 380, 'ครั้งหน้าแค่แตะมือถือที่เครื่อง ร้านจะจำคุณได้ทันที', 30, 15, lines=2)
    s.row(24, 460, 342, 'โปรเฉพาะคุณ', 'Muse Spark เลือกจากโปรที่ร้านอนุมัติเท่านั้น', icon='spark', tone='violet')
    s.row(24, 548, 342, 'สั่งและจองผ่านแชท', 'พิมพ์ “ขอลาเต้” หรือ “จองโต๊ะ 2 คน”', icon='chat', dest='C08')
    s.btn(24, 676, 342, 'ดูโปรของฉัน', 'C04'); s.btn(24, 740, 342, 'เลิกเชื่อมต่อ / ลบข้อมูลฉัน', 'C16', 'danger'); home_bar(s); return s
@screen('C04', 'known-offer', 'ร้านจำคุณได้ + โปร', 'pay', route='/meta/t/:tag (known)')
def c04():
    s = mobile('สวัสดีค่ะ 👋', back='C01'); s.text(24, 140, 'ร้านจำคุณได้แล้ว', 22, weight=700); s.text(24, 166, 'Welcome back — โปรวันนี้สำหรับคุณ', 14, C['muted'])
    s.card(24, 190, 342, 400, r=20); s.photo('latte', 24, 190, 342, 190, 20); s.pill(40, 206, 'ลด 20%', 'red', 76)
    s.text(44, 412, 'ลาเต้ · Latte', 20, weight=700); s.text(44, 446, '$4.00', 28, C['primary'], 700); s.text(130, 446, '$5.00', 16, C['muted'])
    s.line(130, 441, 176, 441, C['muted']); s.muse(44, 470, 'Muse Spark เลือกให้'); s.wrap(44, 522, 'คุณสั่งลาเต้บ่อยตอนบ่าย วันนี้ร้านมีโปรลาเต้ที่เจ้าของอนุมัติไว้', 38, 13, lines=2)
    stripe_badge(s, 24, 612); s.btn(24, 676, 342, 'จ่าย $4.00 ด้วย Stripe', 'C05', icon='card'); s.btn(24, 740, 342, 'สั่งอย่างอื่นด้วยเสียง/พิมพ์', 'C11', 'ghost'); home_bar(s); return s
@screen('C05', 'stripe-checkout', 'Stripe Checkout', 'pay', route='checkout.stripe.com (sandbox)')
def c05():
    s = mobile('ชำระเงิน', back='C04', bg=C['white']); s.pill(24, 118, 'หน้าชำระของ Stripe (sandbox)', 'amber', 220)
    s.text(24, 182, 'Muse Café', 15, C['muted']); s.text(24, 222, '$4.00', 40, weight=700); s.row(24, 246, 342, 'ลาเต้ × 1', 'ลด 20% · ราคาจากเซิร์ฟเวอร์', photo='latte', right='$4.00')
    s.field(24, 360, 342, 'อีเมล', 'you@example.test'); s.field(24, 440, 342, 'ข้อมูลบัตร', '4242 4242 4242 4242', icon='card')
    s.field(24, 520, 168, 'วันหมดอายุ', '12 / 34'); s.field(198, 520, 168, 'CVC', '123')
    s.text(24, 600, 'ทดสอบบัตรถูกปฏิเสธ: 4000 0000 0000 9995 →', 12, C['red'], 600); s.hot(20, 586, 300, 22, 'C25')
    s.wrap(24, 628, 'บัตรทดสอบเท่านั้น · ร้านไม่เห็นเลขบัตร · ยืนยันการจ่ายจาก webhook ที่ตรวจลายเซ็นแล้ว', 44, 12, lines=2)
    s.btn(24, 676, 342, 'จ่าย $4.00', 'C06'); s.btn(24, 740, 342, 'ยกเลิก กลับไปที่ร้าน', 'C04', 'ghost'); home_bar(s); return s
@screen('C06', 'paid', 'จ่ายแล้ว', 'pay', route='/meta/paid')
def c06():
    s = mobile('จ่ายแล้ว', back='C04'); s.circle(195, 230, 60, C['greenbg']); s.icon('check', 165, 200, 60, C['green'], 2.6)
    s.text(195, 336, 'จ่ายแล้ว ✓', 28, weight=700, anchor='middle'); s.text(195, 366, 'Stripe ยืนยันแล้ว · ใบเสร็จส่งไปใน Messenger', 14, C['muted'], anchor='middle')
    s.card(24, 400, 342, 150, r=20); s.text(195, 440, 'รหัสรับสินค้า', 14, C['muted'], anchor='middle'); s.text(195, 500, '#4464', 52, C['primary'], 700, 'middle')
    s.text(195, 532, 'แสดงที่เคาน์เตอร์', 13, C['muted'], anchor='middle')
    s.row(24, 572, 342, 'ดูใบเสร็จในแชท', 'ลาเต้ × 1 · $4.00', icon='chat', dest='C10')
    s.btn(24, 676, 342, 'สั่งเพิ่ม', 'C11', 'secondary'); s.btn(24, 740, 342, 'กลับหน้าร้าน', 'C04', 'ghost'); home_bar(s); return s
@screen('C07', 'pending', 'กำลังตรวจสอบการชำระ', 'pay', route='/meta/paid (202)')
def c07():
    s = mobile('กำลังตรวจสอบ', back='C05'); s.circle(195, 240, 56, C['amberbg']); s.icon('clock', 167, 212, 56, C['amber'], 2.4)
    s.text(195, 340, 'รอ Stripe ยืนยัน', 24, weight=700, anchor='middle'); s.wrap(48, 380, 'ยังไม่นับว่าจ่ายจนกว่า Stripe จะยืนยัน หน้านี้ตรวจซ้ำให้เอง', 32, 15, lines=2)
    s.text(195, 600, 'ถ้าฟอร์มถูกส่งจากเว็บอื่นจะเห็นหน้า S04', 12, C['muted'], anchor='middle'); s.hot(60, 586, 270, 22, 'S04')
    s.btn(24, 676, 342, 'ตรวจอีกครั้ง', 'C06', icon='refresh'); s.btn(24, 740, 342, 'กลับไปหน้าชำระ', 'C05', 'ghost'); home_bar(s); return s

# ---- Messenger
@screen('C08', 'chat-order', 'สั่งผ่านแชท', 'chat', route='Messenger: text → Muse Spark step → quote')
def c08():
    s = chat(); y = 130; y = bubble(s, y, 'ขอลาเต้ 1 แก้วค่ะ', True); s.muse(24, y, 'Muse Spark · 1.4 s'); y += 40
    y = bubble(s, y, 'ได้เลยค่ะ ลาเต้ 1 แก้ว ราคาจากร้าน 👇', w=280)
    s.card(24, y, 280, 216, r=18); s.photo('latte', 24, y, 280, 110, 18); s.text(40, y + 140, 'ลาเต้ × 1 = $4.00', 16, weight=700); s.text(40, y + 162, 'โปร −20% · ราคาจากเซิร์ฟเวอร์', 12, C['muted'])
    s.rect(24, y + 176, 280, 40, C['white'], 0, C['line']); s.text(164, y + 202, 'จ่ายด้วย Stripe', 14, C['primary'], 600, 'middle'); s.hot(24, y + 176, 280, 40, 'C05')
    chips(s, 700, [('เมนู', 'C09'), ('ออเดอร์ของฉัน', 'C15'), ('จองโต๊ะ', 'C12')]); composer(s); return s
@screen('C09', 'chat-menu', 'เมนูการ์ดในแชท', 'chat', route='Messenger: persistent menu → Menu')
def c09():
    s = chat(back='C08'); y = bubble(s, 130, 'เมนู', True); y = bubble(s, y, 'เมนูวันนี้ เลื่อนดูได้เลยค่ะ', w=220)
    for j, (ph, th, en, price) in enumerate(MENU[:2]):
        x = 24 + j * 250; s.card(x, y, 236, 290, r=18); s.photo(ph, x, y, 236, 140, 18); s.text(x + 14, y + 168, f'{th} · {en}', 15, weight=700); s.text(x + 14, y + 192, price, 14, C['muted'])
        s.rect(x, y + 210, 236, 40, C['white'], 0, C['line']); s.text(x + 118, y + 236, 'สั่งอันนี้', 14, C['primary'], 600, 'middle'); s.hot(x, y + 210, 236, 40, 'C08')
        s.rect(x, y + 250, 236, 40, C['white'], 0, C['line']); s.text(x + 118, y + 276, 'รายละเอียด', 14, C['primary'], 600, 'middle'); s.hot(x, y + 250, 236, 40, 'C20')
    composer(s); return s
@screen('C10', 'chat-receipt', 'ใบเสร็จในแชท', 'chat', route='Messenger: receipt template')
def c10():
    s = chat(back='C06'); y = bubble(s, 130, 'จ่ายแล้ว ✓ รหัสรับสินค้า #C923', w=260)
    s.card(24, y, 300, 330, r=18); s.text(40, y + 34, 'ใบเสร็จ · Muse Café', 15, weight=700); s.text(40, y + 56, 'Stripe sandbox · 29 ต.ค. 18:51', 12, C['muted'])
    s.row(32, y + 72, 284, 'ลาเต้ × 1', 'รับที่เคาน์เตอร์', photo='latte', right='$4.00', h=70); s.line(40, y + 160, 308, y + 160)
    s.text(40, y + 190, 'ส่วนลด', 13, C['muted']); s.text(308, y + 190, '−$1.00', 13, C['muted'], anchor='end'); s.text(40, y + 222, 'รวม', 16, weight=700); s.text(308, y + 222, '$4.00', 16, weight=700, anchor='end')
    s.rect(24, y + 250, 300, 40, C['white'], 0, C['line']); s.text(174, y + 276, 'ดูออเดอร์ของฉัน', 14, C['primary'], 600, 'middle'); s.hot(24, y + 250, 300, 40, 'C15')
    composer(s); return s
@screen('C11', 'voice-order', 'สั่งด้วยเสียง/พิมพ์', 'pay', route='/meta/order')
def c11():
    s = mobile('สั่งด้วยเสียง', back='C04'); s.text(24, 140, 'พูดหรือพิมพ์สิ่งที่อยากสั่ง', 18, weight=700)
    s.circle(195, 260, 64, C['primary']); s.icon('mic', 171, 236, 48, C['white'], 2.2); s.text(195, 360, 'กดแล้วพูด · ภาษาไทยได้', 14, C['muted'], anchor='middle')
    s.field(24, 392, 342, 'หรือพิมพ์', 'ขอมัทฉะลาเต้เย็น 1 แก้ว'); s.text(24, 616, 'ถ้ายังไม่เชื่อมต่อ (S03) · ส่งถี่เกิน (S02)', 12, C['primary'], 600); s.hot(20, 602, 150, 22, 'S03'); s.hot(176, 602, 130, 22, 'S02'); s.text(24, 492, 'เสียงแปลงเป็นข้อความในเบราว์เซอร์ เซิร์ฟเวอร์ได้รับแค่ข้อความ', 12, C['muted'])
    s.row(24, 512, 342, 'มัทฉะลาเต้ × 1 = $5.50', 'Muse Spark เลือกขั้นตอน · ร้านคิดราคา', photo='matcha', h=80)
    s.btn(24, 676, 342, 'จ่าย $5.50 ด้วย Stripe', 'C05', icon='card'); s.btn(24, 740, 342, 'ส่งข้อความ', 'C11', 'ghost'); home_bar(s); return s
@screen('C12', 'chat-booking', 'จองโต๊ะในแชท', 'chat', route='Messenger: booking ask-back')
def c12():
    s = chat(back='C08'); y = bubble(s, 130, 'จองโต๊ะ 2 คนค่ะ', True); y = bubble(s, y, 'เลือกเวลาที่ว่างได้เลยค่ะ\n18:00 · 18:30 · 19:00 · 19:30', w=250, lines=2)
    y = bubble(s, y, '19:00', True); s.muse(24, y, 'Muse Spark · อ่านวันเวลา'); y += 40
    s.card(24, y, 300, 190, r=18); s.icon('calendar', 40, y + 18, 24); s.text(74, y + 38, 'จองแล้ว #97C8', 16, weight=700)
    s.text(40, y + 72, 'โต๊ะ 1 · วันนี้ 19:00 · 2 คน', 14); s.wrap(40, y + 100, 'แตะมือถือที่เครื่องบนโต๊ะ 18:55–19:15 เพื่อเช็กอิน ถ้าไม่มาโต๊ะจะว่าง', 34, 12, lines=2)
    s.rect(24, y + 150, 300, 40, C['white'], 0, C['line']); s.text(174, y + 176, 'ยกเลิกการจอง', 14, C['red'], 600, 'middle'); s.hot(24, y + 150, 300, 40, 'C15')
    chips(s, 712, [('ดูจอโต๊ะ', 'T03'), ('เช็กอินที่โต๊ะ', 'C14'), ('ออเดอร์ของฉัน', 'C15')]); composer(s); return s
@screen('C13', 'table-reserved', 'โต๊ะนี้จองไว้แล้ว', 'pay', route='/meta/t/:tag (reserved, 409)')
def c13():
    s = mobile('โต๊ะ 1 จองไว้แล้ว', back='C01'); s.circle(195, 230, 56, C['amberbg']); s.icon('calendar', 167, 202, 56, C['amber'], 2.2)
    s.text(195, 330, 'โต๊ะนี้มีคนจองไว้', 24, weight=700, anchor='middle'); s.wrap(44, 370, 'ถ้าผู้จองไม่มาเช็กอินภายใน 12 นาที (ถึง 19:15) โต๊ะจะว่าง หน้านี้รีเฟรชเอง', 34, 15, lines=3)
    s.btn(24, 612, 342, 'ฉันเป็นผู้จอง · เปิด Messenger', 'C02', 'secondary', icon='chat'); s.btn(24, 676, 342, 'นั่งโต๊ะอื่น · สั่งจาก QR', 'C18'); s.btn(24, 740, 342, 'ดูจอโต๊ะ', 'T03', 'ghost'); home_bar(s); return s
@screen('C14', 'checked-in', 'เช็กอินแล้ว', 'pay', route='/meta/t/:tag (booker)')
def c14():
    s = mobile('เช็กอินแล้ว', back='C01'); s.circle(195, 230, 56, C['tint']); s.icon('check', 167, 202, 56, C['primary'], 2.6)
    s.text(195, 330, 'เช็กอินโต๊ะ 1 แล้ว ✓', 24, weight=700, anchor='middle'); s.text(195, 364, 'ยินดีต้อนรับค่ะ โต๊ะนี้เป็นของคุณถึง 20:30', 14, C['muted'], anchor='middle')
    s.row(24, 410, 342, 'โปรสำหรับคุณวันนี้', 'ลาเต้ ลด 20% · Muse Spark เลือก', icon='spark', tone='violet', dest='C04')
    s.btn(24, 676, 342, 'สั่งจากโต๊ะนี้', 'C19'); s.btn(24, 740, 342, 'สั่งด้วยเสียง/พิมพ์', 'C11', 'ghost'); home_bar(s); return s
@screen('C15', 'my-orders', 'ออเดอร์ของฉัน', 'chat', route='Messenger: persistent menu → My orders')
def c15():
    s = chat(back='C08'); y = bubble(s, 130, 'ออเดอร์ของฉัน', True); y = bubble(s, y, 'รายการล่าสุดของคุณค่ะ', w=200)
    for j, (t, sub, b) in enumerate([('#C923 ลาเต้ × 1 · $4.00', 'จ่ายแล้ว · รับที่เคาน์เตอร์', ('จ่ายแล้ว', 'green')), ('#97C8 โต๊ะ 1 · 19:00', 'จองไว้ · เช็กอิน 18:45–19:15', ('จองไว้', 'amber')), ('#F846 ลาเต้ × 1', 'ยกเลิก · คืนเงินแล้ว', ('คืนเงิน', 'red'))]):
        s.row(24, y + j * 88, 342, t, sub, icon='orders' if j != 1 else 'calendar', badge=b, h=76)
    chips(s, y + 280, [('เมนู', 'C09'), ('จองโต๊ะ', 'C12'), ('เลิกเชื่อมต่อ', 'C16')]); composer(s, menu=False); return s
@screen('C16', 'forget-me', 'เลิกเชื่อมต่อแล้ว', 'pay', route='/meta/me/revoke · STOP')
def c16():
    s = mobile('เลิกเชื่อมต่อแล้ว', back='C03'); s.circle(195, 230, 56, C['bg']); s.icon('trash', 167, 202, 56, C['muted'], 2.2)
    s.text(195, 330, 'ร้านลืมคุณแล้ว', 24, weight=700, anchor='middle'); s.wrap(48, 370, 'ลบการเชื่อมต่อและเซสชันแล้ว ร้านจะไม่ส่งโปรหาคุณอีก แตะใหม่เมื่อไหร่ก็เริ่มใหม่ได้', 32, 15, lines=3)
    s.btn(24, 676, 342, 'แตะเพื่อเริ่มใหม่', 'C01'); s.btn(24, 740, 342, 'สั่งจาก QR โดยไม่เชื่อมต่อ', 'C18', 'ghost'); home_bar(s); return s
@screen('C17', 'tap-error', 'แตะไม่สำเร็จ', 'pay', route='/meta/t/:tag (replayed / invalid)')
def c17():
    s = mobile('แตะไม่สำเร็จ', back='C01'); s.circle(195, 230, 56, C['redbg']); s.icon('warn', 167, 202, 56, C['red'], 2.2)
    s.text(195, 330, 'กรุณาแตะใหม่อีกครั้ง', 24, weight=700, anchor='middle'); s.wrap(48, 370, 'ลิงก์นี้ใช้ไปแล้วหรือหมดอายุ (120 วินาที) แตะมือถือที่เครื่องอีกครั้ง หรือไม่ยินยอมก็สั่งจาก QR ได้', 32, 15, lines=3)
    s.btn(24, 676, 342, 'แตะอีกครั้ง', 'C01'); s.btn(24, 740, 342, 'สั่งจาก QR แทน', 'C18', 'ghost'); home_bar(s); return s

# ---- meta-pay table ordering (from sol- W01–W17, Stripe only)
@screen('C18', 'table-entry', 'สั่งที่โต๊ะ', 'pay', route='/table/:entry', sol='W01')
def c18():
    s = mobile('สั่งที่โต๊ะ'); s.photo('iced-latte', 0, 100, 390, 260, 0); s.rect(0, 300, 390, 60, C['white'], 0, opacity=.0)
    s.card(24, 330, 342, 170, r=20); s.text(44, 370, 'Muse Café · โต๊ะ 1', 22, weight=700); s.text(44, 398, 'สั่งจากมือถือ จ่ายด้วย Stripe', 14, C['muted'])
    s.pill(44, 420, 'เปิดอยู่ · 08:00–20:00', 'green', 168); s.pill(220, 420, 'ไม่ต้องสมัคร', 'grey', 104)
    s.row(24, 520, 342, 'แตะมือถือที่เครื่องเพื่อรับโปร', 'ไม่บังคับ · ต้องยินยอมใน Messenger', icon='nfc', dest='C01')
    s.btn(24, 676, 342, 'ดูเมนู', 'C19'); s.btn(24, 740, 342, 'ขอความช่วยเหลือ', 'C27', 'ghost'); home_bar(s); return s
@screen('C19', 'table-menu', 'เมนูของร้าน', 'pay', route='/table/:entry (menu)', sol='W02')
def c19():
    s = mobile('เมนู', back='C18'); x = 24
    for t, on in [('ทั้งหมด', 1), ('กาแฟ', 0), ('ชา', 0), ('เบเกอรี่', 0)]: x += s.pill(x, 116, t, 'primary' if on else 'grey', None, 32, 13) + 8
    for j, (ph, th, en, price) in enumerate(MENU):
        s.row(24, 164 + j * 92, 342, th, en + (' · โปร −20%' if ph == 'latte' else ''), photo=ph, right=price if ph != 'latte' else '$4.00', dest='C20', h=80)
    s.card(24, 668, 342, 64, C['primary'], False, 16); s.text(44, 706, 'ตะกร้า · 2 รายการ', 15, C['white'], 600); s.text(346, 706, '$9.50 →', 16, C['white'], 700, 'end'); s.hot(24, 668, 342, 64, 'C21')
    s.btn(24, 748, 342, 'สั่งด้วยเสียง/พิมพ์', 'C11', 'ghost', h=44, size=14); home_bar(s); return s
@screen('C20', 'product', 'รายละเอียดเมนู', 'pay', route='/table/:entry (item)', sol='W03')
def c20():
    s = mobile('ลาเต้', back='C19'); s.photo('latte', 0, 100, 390, 300, 0); s.text(24, 440, 'ลาเต้ · Latte', 24, weight=700); s.text(24, 476, '$4.00', 22, C['primary'], 700); s.pill(100, 458, 'โปร −20%', 'red', 84)
    s.wrap(24, 512, 'เอสเปรสโซช็อตคู่ นมสด ฟองนุ่ม · ราคาจากร้าน ส่วนลดคิดโดยเซิร์ฟเวอร์', 40, 14, lines=2)
    s.text(24, 590, 'จำนวน', 14, C['muted']); s.rect(220, 568, 146, 44, C['bg'], 22); s.icon('minus', 234, 579, 22, C['ink']); s.text(293, 597, '1', 17, weight=700, anchor='middle'); s.icon('plus', 330, 579, 22, C['primary'])
    s.btn(24, 676, 342, 'ใส่ตะกร้า · $4.00', 'C21'); s.btn(24, 740, 342, 'กลับไปเมนู', 'C19', 'ghost'); home_bar(s); return s
@screen('C21', 'cart-review', 'ตรวจรายการ', 'pay', route='/table/:entry (review)', sol='W04+W05')
def c21():
    s = mobile('ตรวจรายการ', back='C19'); s.row(24, 124, 342, 'ลาเต้ × 1', 'โปร −20%', photo='latte', right='$4.00'); s.row(24, 212, 342, 'มัทฉะลาเต้ × 1', 'หวานน้อย', photo='matcha', right='$5.50')
    s.card(24, 312, 342, 150); s.text(44, 348, 'ค่าอาหาร', 14, C['muted']); s.text(346, 348, '$10.50', 14, anchor='end'); s.text(44, 378, 'ส่วนลด', 14, C['muted']); s.text(346, 378, '−$1.00', 14, C['green'], anchor='end')
    s.line(44, 398, 346, 398); s.text(44, 436, 'รวม', 18, weight=700); s.text(346, 436, '$9.50', 22, C['primary'], 700, 'end')
    s.wrap(24, 496, 'ราคาล็อกไว้ 10 นาที (quote จากเซิร์ฟเวอร์) · ถ้าราคาเปลี่ยน ระบบจะถามก่อน', 42, 12, lines=2)
    s.text(24, 538, 'เกิน 10 นาที (C24) · ราคาเปลี่ยน (S05) · เมนูหมด (S06)', 12, C['primary'], 600); s.hot(20, 524, 100, 22, 'C24'); s.hot(124, 524, 110, 22, 'S05'); s.hot(238, 524, 110, 22, 'S06')
    stripe_badge(s, 24, 552); s.btn(24, 676, 342, 'จ่าย $9.50 ด้วย Stripe', 'C22', icon='card'); s.btn(24, 740, 342, 'แก้ไขรายการ', 'C19', 'ghost'); home_bar(s); return s
@screen('C22', 'pay-method', 'วิธีชำระ', 'pay', route='Stripe Checkout', sol='W06 (crypto removed)')
def c22():
    s = mobile('วิธีชำระ', back='C21'); s.text(24, 140, 'จ่ายอย่างปลอดภัยกับ Stripe', 20, weight=700); s.text(24, 166, 'ร้านไม่เห็นข้อมูลบัตรของคุณ', 14, C['muted'])
    s.row(24, 190, 342, 'บัตรเครดิต / เดบิต', 'Visa · Mastercard · ผ่านหน้า Stripe', icon='card', dest='C05')
    s.row(24, 278, 342, 'Apple Pay / Google Pay', 'แสดงเมื่อเครื่องรองรับ · ผ่าน Stripe', icon='stripe', dest='C05')
    s.row(24, 366, 342, 'จ่ายด้วย AI agent', 'Muse Connector · Shared Payment Token', icon='robot', dest='MP23')
    s.card(24, 470, 342, 96, C['amberbg'], False); s.wrap(44, 504, 'Sandbox สำหรับการแข่งขัน · ใช้บัตรทดสอบ 4242 · ไม่มีเงินจริง ไม่มีคริปโต', 40, 13, C['amber'], 2)
    s.btn(24, 676, 342, 'ไปหน้าชำระของ Stripe', 'C05'); s.btn(24, 740, 342, 'กลับไปตรวจรายการ', 'C21', 'ghost'); home_bar(s); return s
@screen('C23', 'receipt', 'ใบเสร็จ', 'pay', route='/meta/agent/paid', sol='W12')
def c23():
    s = mobile('ใบเสร็จ', back='C06'); s.card(24, 124, 342, 470, r=20); s.text(195, 172, 'Muse Café', 18, weight=700, anchor='middle'); s.text(195, 196, '29 ต.ค. 2026 · 18:51 · โต๊ะ 1', 13, C['muted'], anchor='middle')
    for j, (a, b) in enumerate([('ลาเต้ × 1', '$4.00'), ('มัทฉะลาเต้ × 1', '$5.50')]): s.text(48, 248 + j * 34, a, 15); s.text(342, 248 + j * 34, b, 15, anchor='end')
    s.line(48, 324, 342, 324); s.text(48, 360, 'รวม', 17, weight=700); s.text(342, 360, '$9.50', 17, weight=700, anchor='end')
    s.text(48, 404, 'ชำระด้วย', 13, C['muted']); s.text(342, 404, 'Stripe · Visa ••4242', 13, anchor='end'); s.text(48, 432, 'เลขอ้างอิง', 13, C['muted']); s.text(342, 432, 'pi_…7XQ (sandbox)', 13, anchor='end')
    s.text(195, 500, 'รหัสรับสินค้า', 13, C['muted'], anchor='middle'); s.text(195, 552, '#C923', 40, C['primary'], 700, 'middle')
    s.btn(24, 676, 342, 'ขอคืนเงิน', 'C26', 'outline'); s.btn(24, 740, 342, 'กลับหน้าร้าน', 'C18', 'ghost'); home_bar(s); return s
@screen('C24', 'expired', 'รายการหมดเวลา', 'pay', route='quote expired', sol='W14')
def c24():
    s = mobile('หมดเวลา', back='C21'); s.circle(195, 230, 56, C['amberbg']); s.icon('clock', 167, 202, 56, C['amber'], 2.2)
    s.text(195, 330, 'ราคานี้หมดเวลาแล้ว', 24, weight=700, anchor='middle'); s.wrap(48, 370, 'ราคาล็อกไว้ 10 นาที ไม่มีการตัดเงิน ขอราคาใหม่ได้เลย', 32, 15, lines=2)
    s.btn(24, 676, 342, 'ขอราคาใหม่', 'C21'); s.btn(24, 740, 342, 'กลับไปเมนู', 'C19', 'ghost'); home_bar(s); return s
@screen('C25', 'failed', 'ชำระไม่สำเร็จ', 'pay', route='Stripe decline', sol='W15')
def c25():
    s = mobile('ชำระไม่สำเร็จ', back='C21'); s.circle(195, 230, 56, C['redbg']); s.icon('cross', 167, 202, 56, C['red'], 2.4)
    s.text(195, 330, 'บัตรถูกปฏิเสธ', 24, weight=700, anchor='middle'); s.wrap(48, 370, 'Stripe แจ้งว่ายอดไม่พอ (insufficient_funds) ยังไม่มีการตัดเงิน ลองบัตรอื่นได้', 32, 15, lines=3)
    s.btn(24, 676, 342, 'ลองอีกครั้ง', 'C05'); s.btn(24, 740, 342, 'กลับไปตรวจรายการ', 'C21', 'ghost'); home_bar(s); return s
@screen('C26', 'refund', 'สถานะการคืนเงิน', 'pay', route='cancel_order / staff refund', sol='W17')
def c26():
    s = mobile('การคืนเงิน', back='C23'); s.text(24, 140, 'คืนเงิน #F846', 20, weight=700); s.text(24, 166, 'คืนเต็มจำนวนผ่าน Stripe · ก่อนร้านส่งมอบ', 14, C['muted'])
    for j, (t, sub, done) in enumerate([('ขอคืนเงิน', '18:52 · ลูกค้ายกเลิก', 1), ('Stripe รับคำขอ', 're_…4KD · idempotent', 1), ('คืนสต็อก', 'บันทึกใน meta_stock_movements', 1), ('เงินถึงบัตร', '5–10 วันทำการ (sandbox: ทันที)', 0)]):
        y = 200 + j * 92; s.circle(44, y + 20, 14, C['green'] if done else C['line']); s.icon('check', 36, y + 12, 16, C['white'], 2.4)
        s.text(72, y + 18, t, 16, weight=700); s.text(72, y + 42, sub, 13, C['muted'])
        if j < 3: s.line(44, y + 36, 44, y + 92, C['green'] if done else C['line'], 2)
    s.btn(24, 676, 342, 'ดูออเดอร์ของฉัน', 'C15', 'secondary'); s.btn(24, 740, 342, 'กลับหน้าร้าน', 'C18', 'ghost'); home_bar(s); return s
@screen('C27', 'help-offline', 'ช่วยเหลือ / ออฟไลน์', 'pay', route='offline / help', sol='W18+W21')
def c27():
    s = mobile('ช่วยเหลือ', back='C18'); s.card(24, 124, 342, 120, C['amberbg'], False); s.icon('wifi', 44, 148, 26, C['amber']); s.text(84, 166, 'การเชื่อมต่อขาดหาย', 16, C['amber'], 700)
    s.wrap(84, 192, 'ไม่มีการตัดเงินซ้ำ ระบบตรวจกับ Stripe เมื่อกลับมาออนไลน์', 30, 13, C['amber'], 2)
    s.row(24, 270, 342, 'จ่ายแล้วแต่ยังไม่ขึ้น', 'ตรวจกับ Stripe อีกครั้ง', icon='refresh', dest='C07'); s.row(24, 358, 342, 'ขอคืนเงิน', 'ก่อนร้านส่งมอบ', icon='card', dest='C26')
    s.row(24, 446, 342, 'คุยกับร้านใน Messenger', 'ต้องยินยอมก่อน', icon='chat', dest='C02')
    s.btn(24, 676, 342, 'ลองใหม่', 'C19'); s.btn(24, 740, 342, 'กลับหน้าร้าน', 'C18', 'ghost'); home_bar(s); return s

# ---- meta-pay desktop
def paydesk(title, back):
    s = SVG(1440, 1000, C['bg']); s.rect(0, 0, 1440, 76, C['white'], 0); s.line(0, 76, 1440, 76); s.logo(40, 22, 96)
    s.text(1400, 46, 'Muse Café · โต๊ะ 1', 15, weight=600, anchor='end'); s.text(80, 140, title, 30, weight=700)
    s.rect(40, 116, 30, 30, C['bg'], 15); s.icon('back', 43, 119, 24, C['ink']); s.hot(36, 112, 38, 38, back); return s
@screen('CD01', 'desk-menu', 'เมนู (เดสก์ท็อป)', 'paydesk', sol='WD02')
def cd01():
    s = paydesk('เมนู', 'C18')
    for j, (ph, th, en, price) in enumerate(MENU):
        x = 80 + (j % 3) * 300; y = 180 + (j // 3) * 330; s.card(x, y, 280, 310, r=18); s.photo(ph, x, y, 280, 170, 18)
        s.text(x + 18, y + 204, f'{th} · {en}', 16, weight=700); s.text(x + 18, y + 232, price, 15, C['muted']); s.btn(x + 18, y + 248, 244, 'ใส่ตะกร้า', 'CD02', 'secondary', h=44, size=14)
    s.card(1000, 180, 360, 420, r=18); s.text(1024, 220, 'ตะกร้า', 20, weight=700); s.text(1024, 264, 'ลาเต้ × 1', 15); s.text(1336, 264, '$4.00', 15, anchor='end')
    s.text(1024, 300, 'มัทฉะลาเต้ × 1', 15); s.text(1336, 300, '$5.50', 15, anchor='end'); s.line(1024, 330, 1336, 330); s.text(1024, 368, 'รวม', 18, weight=700); s.text(1336, 368, '$9.50', 18, C['primary'], 700, 'end')
    s.btn(1024, 520, 312, 'ตรวจรายการและชำระ', 'CD02'); return s
@screen('CD02', 'desk-checkout', 'ตรวจและชำระ (เดสก์ท็อป)', 'paydesk', sol='WD01 (crypto removed)')
def cd02():
    s = paydesk('ตรวจรายการและชำระ', 'CD01'); s.card(80, 180, 760, 520, r=18)
    for j, (ph, th, en, price) in enumerate([MENU[0], MENU[3]]): s.row(104, 210 + j * 96, 712, f'{th} × 1', en, photo=ph, right=price if j else '$4.00', h=80)
    s.text(104, 440, 'ส่วนลด (โปรที่ร้านอนุมัติ)', 15, C['muted']); s.text(816, 440, '−$1.00', 15, C['green'], anchor='end'); s.text(104, 486, 'รวม', 20, weight=700); s.text(816, 486, '$9.50', 26, C['primary'], 700, 'end')
    s.card(880, 180, 480, 520, r=18); s.text(904, 220, 'ชำระเงิน', 20, weight=700); stripe_badge(s, 904, 240)
    s.row(904, 290, 432, 'บัตร / Apple Pay / Google Pay', 'ไปหน้า Stripe Checkout', icon='card', h=72); s.wrap(904, 400, 'ร้านไม่เห็นเลขบัตร · จ่ายแล้วยืนยันจาก webhook ที่ตรวจลายเซ็น · ไม่มีคริปโต', 46, 13, lines=2)
    s.btn(904, 620, 432, 'จ่าย $9.50 ด้วย Stripe', 'CD03', icon='card'); return s
@screen('CD03', 'desk-paid', 'จ่ายแล้ว (เดสก์ท็อป)', 'paydesk', sol='WD09+WD10')
def cd03():
    s = paydesk('จ่ายแล้ว', 'CD02'); s.card(420, 180, 600, 560, r=24); s.circle(720, 300, 64, C['greenbg']); s.icon('check', 688, 268, 64, C['green'], 2.6)
    s.text(720, 420, 'จ่ายแล้ว ✓', 32, weight=700, anchor='middle'); s.text(720, 456, 'Stripe ยืนยันแล้ว · $9.50', 16, C['muted'], anchor='middle')
    s.text(720, 540, '#C923', 56, C['primary'], 700, 'middle'); s.text(720, 576, 'รหัสรับสินค้า', 14, C['muted'], anchor='middle')
    s.btn(500, 640, 210, 'ดูใบเสร็จ', 'C23', 'secondary'); s.btn(730, 640, 210, 'สั่งเพิ่ม', 'CD01'); return s

# ================================================================ 20 meta-pos desktop
@screen('MP01', 'login', 'เข้าสู่ระบบร้านค้า', 'pos', route='meta-pos /', sol='P39')
def mp01():
    s = SVG(1440, 1000, C['white']); s.grad_rect(0, 0, 640, 1000, 0, (C['primary'], C['violet']), True); s.logo(64, 64, 150, dark=True)
    s.photo('latte', 64, 200, 512, 420, 24); s.text(64, 700, 'ร้านเล็ก ที่ Muse ช่วยขาย', 36, C['white'], 700); s.wrap(64, 744, 'แตะเพื่อรู้จักลูกค้า คุยใน Messenger จ่ายผ่าน Stripe และให้ AI ร่างโปรที่คุณอนุมัติ', 40, 17, C['white'], 2)
    s.text(780, 230, 'ยินดีต้อนรับกลับ', 32, weight=700); s.text(780, 266, 'ใช้บัญชีเดียวกับ POS ของร้าน', 15, C['muted'])
    s.field(780, 320, 520, 'อีเมล', hint='owner@muse-cafe.test', icon='user'); s.field(780, 410, 520, 'รหัสผ่าน', hint='••••••••', icon='shield')
    s.btn(780, 510, 520, 'เข้าสู่ระบบ', 'MP02'); s.line(780, 600, 1300, 600); s.text(780, 640, 'ทางลัดเดโม (บัญชีทดสอบ)', 13, C['muted'])
    for j, (t, d) in enumerate([('เจ้าของ', 'MP02'), ('ผู้จัดการ', 'MP05'), ('พนักงาน', 'MP05')]): s.btn(780 + j * 176, 660, 164, t, d, 'secondary', h=46, size=15)
    s.text(780, 760, 'สิทธิ์ตรวจซ้ำทุกคำขอที่เซิร์ฟเวอร์ · ไม่มีคริปโต · Stripe sandbox', 13, C['muted']); return s
@screen('MP02', 'overview', 'ภาพรวม', 'pos', sol='P01')
def mp02():
    s = desk('ภาพรวมวันนี้', 'MP02', '29 ต.ค. 2026 · ข้อมูลตัวอย่าง', [('ขายหน้าร้าน', 'MP03', 'primary')])
    for j, (a, b, c, t) in enumerate([('ยอดขาย (Stripe)', '$184.50', '41 ออเดอร์', 'primary'), ('แตะ NFC', '17', 'ลูกค้าที่ยินยอม 9', 'ink'), ('แชท / เสียง', '12', 'Muse Spark 14 ครั้ง', 'violet'), ('การจองโต๊ะ', '5', 'เช็กอิน 3 · หลุดคิว 1', 'green')]):
        s.metric(280 + j * 284, 190, 268, a, b, c, t)
    s.card(280, 330, 700, 360); s.text(304, 368, 'ยอดขายตามช่องทาง', 18, weight=700)
    for j, (lab, v, tone) in enumerate([('แตะ NFC', .62, 'primary'), ('แชท Messenger', .44, 'violet'), ('AI agent (MCP)', .18, 'dark'), ('สั่งที่โต๊ะ', .52, 'green'), ('หน้าร้าน', .36, 'muted')]):
        y = 410 + j * 52; s.text(304, y + 20, lab, 14); s.rect(470, y + 4, 460, 22, C['bg'], 11); s.rect(470, y + 4, 460 * v, 22, C['ink'] if tone == 'dark' else C[tone], 11)
    s.text(304, 676, 'ดูรายงานเต็ม →', 14, C['primary'], 600); s.hot(296, 656, 160, 30, 'MP18')
    s.card(1004, 330, 404, 360); s.text(1028, 368, 'ต้องจัดการตอนนี้', 18, weight=700)
    s.row(1020, 392, 372, '3 ออเดอร์รอส่งมอบ', 'จ่ายแล้ว · แตะ / แชท', icon='orders', dest='MP05', h=68); s.row(1020, 470, 372, 'โต๊ะ 1 รอเช็กอิน', 'เหลือ 12 นาที', icon='calendar', dest='MP08', h=68)
    s.row(1020, 548, 372, 'Muse Spark ร่างโปรใหม่', 'รออนุมัติ 1 รายการ', icon='spark', tone='violet', dest='MP14', h=68)
    s.card(280, 714, 1128, 240); s.text(304, 752, 'ออเดอร์ล่าสุด', 18, weight=700); s.text(1384, 752, 'ทั้งหมด →', 14, C['primary'], 600, 'end'); s.hot(1300, 732, 100, 30, 'MP05')
    for j, (t, sub, b) in enumerate([('#4464 ลาเต้ × 1 · $4.00', 'แตะ NFC · 03:00', ('จ่ายแล้ว', 'green')), ('#C923 ลาเต้ × 1 · $4.00', 'แชท Messenger · 18:51', ('ส่งมอบแล้ว', 'grey'))]):
        s.row(296 + j * 556, 776, 540, t, sub, icon='orders', badge=b, dest='MP06', h=72)
    return s
@screen('MP03', 'counter-sale', 'ขายหน้าร้าน', 'pos', sol='P02')
def mp03():
    s = desk('ขายหน้าร้าน', 'MP03', 'เลือกเมนู → ให้ลูกค้าสแกน QR ของ Stripe บน BitPOS Mini')
    x = 280
    for t, on in [('ทั้งหมด', 1), ('กาแฟ', 0), ('ชา', 0), ('เบเกอรี่', 0)]: x += s.pill(x, 184, t, 'primary' if on else 'grey', None, 34, 14) + 10
    for j, (ph, th, en, price) in enumerate(MENU):
        x = 280 + (j % 3) * 250; y = 236 + (j // 3) * 280; s.card(x, y, 234, 264, r=18); s.photo(ph, x, y, 234, 150, 18)
        s.text(x + 16, y + 180, th, 16, weight=700); s.text(x + 16, y + 204, en, 13, C['muted']); s.text(x + 218, y + 242, price, 16, C['primary'], 700, 'end'); s.hot(x, y, 234, 264, 'MP03')
    s.card(1040, 184, 368, 770, r=18); s.text(1064, 224, 'บิลปัจจุบัน', 20, weight=700); s.pill(1300, 204, 'หน้าร้าน', 'grey', 84)
    for j, (t, q, p) in enumerate([('ลาเต้', 2, '$10.00'), ('ครัวซองต์', 1, '$4.00')]):
        y = 252 + j * 76; s.text(1064, y + 28, t, 16, weight=600); s.text(1064, y + 52, f'× {q}', 13, C['muted']); s.text(1384, y + 40, p, 16, anchor='end'); s.line(1064, y + 70, 1384, y + 70)
    s.text(1064, 460, 'ส่วนลด', 14, C['muted']); s.text(1384, 460, '$0.00', 14, anchor='end'); s.text(1064, 504, 'รวม', 20, weight=700); s.text(1384, 504, '$14.00', 26, C['primary'], 700, 'end')
    stripe_badge(s, 1064, 540); s.btn(1064, 800, 320, 'เก็บเงินด้วย Stripe QR', 'MP04', icon='qr'); s.btn(1064, 868, 320, 'ล้างบิล', 'MP03', 'outline', h=48, size=15); return s
@screen('MP04', 'counter-checkout', 'รอลูกค้าจ่าย (QR)', 'pos', sol='P02 (pay step)')
def mp04():
    s = desk('รอลูกค้าจ่าย', 'MP03', 'QR นี้แสดงบน BitPOS Mini ด้วย (B04)', [('← กลับไปบิล', 'MP03', 'outline')])
    s.card(280, 190, 560, 640, r=20); s.qr(400, 230, 320, 11); s.text(560, 620, 'ลูกค้าสแกนเพื่อจ่ายบน Stripe Checkout', 16, weight=600, anchor='middle'); s.text(560, 650, 'ลิงก์ใช้ได้ 30 นาที · ราคาล็อกตาม quote', 13, C['muted'], anchor='middle')
    s.card(864, 190, 544, 640, r=20); s.text(888, 232, 'บิล #K-0182 · $14.00', 20, weight=700); s.pill(888, 252, 'รอจ่าย', 'amber', 74)
    for j, (t, sub, done) in enumerate([('สร้าง quote ที่เซิร์ฟเวอร์', 'ราคาเป็นจำนวนเต็มหน่วยย่อย', 1), ('เปิด Stripe Checkout', 'cs_test_…', 1), ('รอ webhook ที่ตรวจลายเซ็น', 'ไม่เชื่อหน้าจอ redirect', 0), ('ตัดสต็อกครั้งเดียว', 'meta_stock_movements', 0)]):
        y = 310 + j * 90; s.circle(906, y + 20, 14, C['green'] if done else C['line']); s.icon('check', 898, y + 12, 16, C['white'], 2.4); s.text(934, y + 18, t, 16, weight=600); s.text(934, y + 42, sub, 13, C['muted'])
    s.btn(888, 740, 240, 'จ่ายแล้ว (ตัวอย่าง)', 'MP06', 'primary', h=48, size=15); s.btn(1144, 740, 240, 'ยกเลิกบิล', 'MP03', 'danger', h=48, size=15); return s
@screen('MP05', 'orders', 'ศูนย์ออเดอร์', 'pos', route='/meta/staff', sol='P29 (+P03 bills)')
def mp05():
    s = desk('ศูนย์ออเดอร์', 'MP05', 'ทุกช่องทาง · รีเฟรชทุก 10 วินาที · จ่ายแล้วจาก Stripe webhook เท่านั้น')
    x = 280
    for t, tone in [('ทั้งหมด 12', 'primary'), ('แตะ NFC 5', 'grey'), ('แชท 4', 'grey'), ('AI agent 1', 'grey'), ('สั่งที่โต๊ะ 1', 'grey'), ('หน้าร้าน 1', 'grey')]: x += s.pill(x, 184, t, tone, None, 34, 14) + 10
    rows = [('#4464', 'ลาเต้ × 1', ('แตะ NFC', 'primary'), '$4.00', ('จ่ายแล้ว', 'green'), '03:00'), ('#C923', 'ลาเต้ × 1', ('แชท', 'violet'), '$4.00', ('ส่งมอบแล้ว', 'grey'), '18:51'),
            ('#6BCC', 'ลาเต้ × 1', ('AI agent', 'dark'), '$4.00', ('จ่ายแล้ว', 'green'), '13:52'), ('#T7A1', 'มัทฉะ × 1, ครัวซองต์ × 1', ('สั่งที่โต๊ะ', 'green'), '$9.50', ('จ่ายแล้ว', 'green'), '12:10'),
            ('#K-0182', 'ลาเต้ × 2, ครัวซองต์ × 1', ('หน้าร้าน', 'grey'), '$14.00', ('รอจ่าย', 'amber'), '12:02'), ('#F846', 'ลาเต้ × 1', ('AI agent', 'dark'), '$4.00', ('คืนเงินแล้ว', 'red'), '11:40')]
    table(s, 280, 236, 1128, ['รหัส', 'รายการ', 'ช่องทาง', 'ยอด', 'สถานะ', 'เวลา'], rows, [130, 330, 190, 140, 200, 138], ['MP06'] * 6)
    s.text(280, 900, 'ไม่แสดงรหัส Messenger ของลูกค้า · ราคาและสถานะจากเซิร์ฟเวอร์', 13, C['muted']); return s
@screen('MP06', 'order-detail', 'รายละเอียดออเดอร์', 'pos', sol='P04 / P31')
def mp06():
    s = desk('ออเดอร์ #4464', 'MP05', 'แตะ NFC · ลูกค้าที่ยินยอม · 29 ต.ค. 03:00', [('← ศูนย์ออเดอร์', 'MP05', 'outline')])
    s.card(280, 190, 700, 500, r=18); s.row(304, 214, 652, 'ลาเต้ × 1', 'โปร −20% (อนุมัติโดยเจ้าของ)', photo='latte', right='$4.00', h=80)
    s.text(304, 340, 'การชำระ', 16, weight=700); s.text(304, 372, 'Stripe Checkout · pi_…Q2 (sandbox) · webhook ตรวจลายเซ็นแล้ว', 14); s.text(304, 400, 'สต็อก: ตัด 1 · บันทึกใน meta_stock_movements', 14, C['muted'])
    s.text(304, 448, 'Muse Spark', 16, weight=700); s.muse(304, 466, 'เลือกโปรนี้ · 1.2 s'); s.wrap(304, 520, 'เหตุผล (ไม่มีตัวเลข): ลูกค้าชอบเครื่องดื่มนมร้อนช่วงบ่าย', 60, 14, lines=2)
    s.text(304, 600, 'ดูหลักฐานของคำขอนี้ →', 14, C['primary'], 600); s.hot(296, 580, 220, 30, 'MP17')
    s.card(1004, 190, 404, 500, r=18); s.text(1206, 250, 'รหัสรับสินค้า', 14, C['muted'], anchor='middle'); s.text(1206, 320, '#4464', 56, C['primary'], 700, 'middle')
    s.pill(1158, 344, 'จ่ายแล้ว', 'green', 96); s.btn(1028, 540, 356, 'ส่งมอบแล้ว', 'MP05', icon='check'); s.btn(1028, 604, 356, 'คืนเงิน', 'MP07', 'danger', h=48, size=15); return s
@screen('MP07', 'refund', 'คืนเงิน', 'pos', sol='P37 / P41')
def mp07():
    s = desk('คืนเงิน · ออเดอร์ #4464', 'MP05', 'คืนเต็มจำนวนผ่าน Stripe ก่อนส่งมอบ · ทำได้ครั้งเดียว', [('← กลับ', 'MP06', 'outline')])
    s.card(280, 190, 760, 520, r=18); s.text(304, 236, 'ยอดคืน', 15, C['muted']); s.text(304, 290, '$4.00', 44, weight=700)
    s.field(304, 340, 712, 'เหตุผล (บันทึกในหลักฐาน)', 'ลูกค้าเปลี่ยนใจก่อนรับ'); s.wrap(304, 450, 'ระบบส่งคำขอคืนเงินไป Stripe ด้วย idempotency key ของออเดอร์ คืนสต็อกครั้งเดียว และแจ้งลูกค้าใน Messenger ถ้ายินยอมไว้', 80, 14, lines=2)
    s.btn(304, 620, 340, 'ยืนยันคืนเงิน $4.00', 'MP05', 'danger'); s.btn(660, 620, 200, 'ยกเลิก', 'MP06', 'outline'); return s
@screen('MP08', 'bookings', 'การจองโต๊ะ', 'pos', route='/meta/staff (bookings)', meta_only=True)
def mp08():
    s = desk('การจองโต๊ะ', 'MP08', 'จองผ่านแชท · ล็อกโต๊ะ -5/+15 นาที · เตือนใน Messenger · หลุดคิวอัตโนมัติ', [('เวลารับจอง', 'MP24', 'outline'), ('จอโต๊ะทั้งหมด', 'MP09', 'secondary')])
    rows = [('#97C8', 'โต๊ะ 1', 'วันนี้ 19:00', '2', ('รอเช็กอิน · 12 นาที', 'amber')), ('#A1B2', 'โต๊ะ 2', 'วันนี้ 18:30', '4', ('เช็กอินแล้ว', 'green')),
            ('#C3D4', 'โต๊ะ 1', 'วันนี้ 17:00', '2', ('หลุดคิว', 'red')), ('#E5F6', 'โต๊ะ 3', 'พรุ่งนี้ 12:00', '3', ('จองไว้', 'primary'))]
    table(s, 280, 190, 1128, ['รหัส', 'โต๊ะ', 'เวลา', 'คน', 'สถานะ'], rows, [160, 200, 280, 120, 368], ['MP08'] * 4)
    s.card(280, 520, 1128, 200, r=18); s.text(304, 560, 'จอโต๊ะ', 18, weight=700); s.text(304, 588, 'เปิดบนแท็บเล็ต/มือถือที่ตั้งบนโต๊ะ · ลิงก์มีกุญแจของแต่ละโต๊ะ', 13, C['muted'])
    for j, t in enumerate(['โต๊ะ 1', 'โต๊ะ 2', 'โต๊ะ 3']): s.btn(304 + j * 180, 620, 164, t, ['T03', 'T04', 'T01'][j], 'secondary', h=46, size=15)
    s.btn(860, 620, 220, 'ยกเลิกการจอง #97C8', 'MP08', 'danger', h=46, size=14)
    s.text(304, 760, 'หน้าที่ลูกค้าเห็น:', 14, C['muted'])
    for j, (t, d) in enumerate([('คนอื่นแตะโต๊ะที่จองไว้ (C13)', 'C13'), ('ผู้จองเช็กอิน (C14)', 'C14'), ('จองในแชท (C12)', 'C12')]): s.btn(430 + j * 270, 736, 256, t, d, 'outline', h=42, size=13)
    return s
@screen('MP09', 'tables-devices', 'โต๊ะ อุปกรณ์ และสติกเกอร์', 'pos', sol='P35')
def mp09():
    s = desk('โต๊ะ อุปกรณ์ และสติกเกอร์', 'MP20', 'BitPOS Mini ต่อโต๊ะ · สติกเกอร์ NTAG 424 DNA · เฟิร์มแวร์ Meta', [('← ตั้งค่า', 'MP20', 'outline')])
    rows = [('โต๊ะ 1', 'BitPOS Mini · meta 0.4.0', ('ออนไลน์', 'green'), 'NTAG …04A1 · counter 37', 'จอโต๊ะ →'), ('โต๊ะ 2', 'BitPOS Mini · meta 0.4.0', ('ออนไลน์', 'green'), 'NTAG …04B7 · counter 12', 'จอโต๊ะ →'),
            ('เคาน์เตอร์', 'BitPOS Mini · meta 0.4.0', ('ออฟไลน์ 2 นาที', 'amber'), 'NTAG …04C2 · counter 5', 'จอโต๊ะ →')]
    table(s, 280, 190, 1128, ['โต๊ะ', 'อุปกรณ์', 'สถานะ', 'สติกเกอร์', ''], rows, [180, 300, 220, 300, 128], ['T01', 'T04', 'B10'])
    s.card(280, 450, 1128, 230, r=18); s.text(304, 490, 'ดูหน้าจอของเครื่อง', 18, weight=700)
    for j, (t, d) in enumerate([('รอแตะ', 'B01'), ('ลูกค้าใหม่', 'B02'), ('ลูกค้าเก่า+โปร', 'B03'), ('QR Stripe', 'B04'), ('รอยืนยัน', 'B05'), ('จ่ายแล้ว', 'B06'),
                                ('รอเช็กอิน', 'B07'), ('จองไว้', 'B08'), ('เช็กอินแล้ว', 'B09'), ('ออฟไลน์', 'B10'), ('พร้อมรับ', 'B11'), ('QR เข้าแชท', 'B12')]):
        s.btn(304 + (j % 6) * 182, 512 + (j // 6) * 56, 170, f'{t} ({d})', d, 'secondary', h=46, size=13)
    s.text(304, 660, 'เฟิร์มแวร์ Meta แยกจาก sol- (ชื่อ เวอร์ชัน ปลายทาง API และ OTA ของตัวเอง) · ไม่แสดงคริปโต', 14, C['muted']); return s
@screen('MP10', 'menu-stock', 'เมนูและสต็อก', 'pos', sol='P06 + P08')
def mp10():
    s = desk('เมนูและสต็อก', 'MP10', 'ราคาเป็น USD หน่วยย่อย · สต็อกที่ Meta ตัดมีบันทึกทุกครั้ง', [('เพิ่มเมนู', 'MP11', 'primary')])
    rows = [(f'{th} · {en}', price, str(40 - j * 6), ('โปร −20%', 'red') if ph == 'latte' else ('ปกติ', 'grey'), 'แก้ไข') for j, (ph, th, en, price) in enumerate(MENU)]
    table(s, 280, 190, 1128, ['เมนู', 'ราคา', 'สต็อก', 'โปร', ''], rows, [400, 160, 160, 260, 148], ['MP11'] * 5)
    s.card(280, 560, 1128, 280, r=18); s.text(304, 600, 'ความเคลื่อนไหวสต็อก (Meta)', 18, weight=700)
    table(s, 304, 620, 1080, ['เวลา', 'เมนู', 'จำนวน', 'เหตุผล', 'ออเดอร์'], [('03:00', 'ลาเต้', '−1', ('tap_paid', 'primary'), '#4464'), ('18:52', 'ลาเต้', '+1', ('agent_refunded', 'red'), '#F846')], [160, 240, 140, 300, 240], ['MP06', 'MP06'])
    return s
@screen('MP11', 'product-edit', 'แก้ไขเมนู', 'pos', sol='P07')
def mp11():
    s = desk('แก้ไขเมนู · ลาเต้', 'MP10', None, [('← เมนู', 'MP10', 'outline')])
    s.card(280, 190, 700, 640, r=18); s.photo('latte', 304, 214, 200, 200, 16)
    s.field(540, 230, 416, 'ชื่อไทย', 'ลาเต้'); s.field(540, 320, 416, 'ชื่ออังกฤษ', 'Latte'); s.field(304, 450, 300, 'ราคา (USD)', '5.00'); s.field(630, 450, 326, 'หมวด', 'กาแฟ')
    s.field(304, 540, 300, 'สต็อก', '40'); s.wrap(304, 650, 'ราคาเก็บเป็นจำนวนเต็มหน่วยย่อย · Stripe ขั้นต่ำ $0.50 · เปลี่ยนราคาแล้ว quote เก่าหมดอายุเอง', 70, 13, lines=2)
    s.btn(304, 740, 260, 'บันทึก', 'MP10'); s.btn(580, 740, 200, 'ยกเลิก', 'MP10', 'outline')
    s.card(1004, 190, 404, 640, r=18); s.text(1028, 230, 'ตัวอย่างในแชท', 16, weight=700); s.card(1028, 250, 356, 330, r=18); s.photo('latte', 1028, 250, 356, 180, 18); s.text(1044, 460, 'ลาเต้ · Latte', 16, weight=700); s.text(1044, 486, '$5.00', 14, C['muted'])
    return s
@screen('MP13', 'promotions', 'โปรโมชัน', 'pos', route='/meta/staff/offers', sol='P33')
def mp13():
    s = desk('โปรโมชัน + Allow All', 'MP13', 'Muse Spark ร่าง · เจ้าของอนุมัติ · ราคาคิดโดยเซิร์ฟเวอร์', [('ให้ Muse Spark ร่างโปร', 'MP14', 'primary')])
    s.card(280, 190, 1128, 150, C['violetbg'], False, 18); s.muse(304, 214, 'Allow All · ทำงานอยู่'); s.text(304, 280, 'หมวดเบเกอรี่ · ลดไม่เกิน 20% · นานไม่เกิน 8 ชม. · วันละไม่เกิน 3 โปร', 17, weight=600)
    s.text(304, 310, 'อนุมัติอัตโนมัติวันนี้ 1 รายการ · หยุดได้ทันที', 14, C['muted']); s.btn(1200, 254, 184, 'ยกเลิก Allow All', 'MP13', 'danger', h=46, size=14)
    for j, (t, sub, b) in enumerate([('ครัวซองต์ ลด 20% · 8 ชม.', 'Muse Spark · อนุมัติอัตโนมัติด้วย Allow All', ('ใช้งานอยู่', 'green')), ('ลาเต้ ลด 20% · ถึง 4 พ.ย. 23:59', 'เจ้าของอนุมัติเอง', ('ใช้งานอยู่', 'green')),
                                ('มัทฉะ ลด 15% · 4 ชม.', 'Muse Spark · รอเจ้าของอนุมัติ', ('รออนุมัติ', 'amber')), ('ครัวซองต์ ลด 20%', 'หยุดแล้วโดยเจ้าของ', ('หยุดแล้ว', 'grey'))]):
        s.row(280, 364 + j * 92, 1128, t, sub, icon='spark', tone='violet', badge=b, dest='MP14', h=80)
    s.text(280, 760, 'โปรเขียนผ่านคำสั่งโปรเดิมของ POS · ทุกการตัดสินใจอยู่ในหลักฐาน AI', 13, C['muted']); s.text(280, 790, 'ดูหลักฐาน →', 14, C['primary'], 600); s.hot(272, 772, 120, 28, 'MP17'); return s
@screen('MP14', 'draft-review', 'ตรวจร่างโปร', 'pos', sol='P34')
def mp14():
    s = desk('ตรวจร่างโปรจาก Muse Spark', 'MP13', None, [('← โปรโมชัน', 'MP13', 'outline')])
    s.card(280, 190, 700, 600, r=18); s.photo('matcha', 304, 214, 220, 220, 16); s.muse(548, 220, 'Muse Spark ร่าง · 2.1 s')
    s.text(548, 290, 'มัทฉะลาเต้ ลด 15%', 24, weight=700); s.text(548, 324, 'นาน 4 ชั่วโมง · เลือกจากรายการของเซิร์ฟเวอร์', 14, C['muted'])
    s.text(548, 380, '$5.50 → $4.68', 22, C['primary'], 700); s.wrap(304, 480, 'เหตุผล: ช่วงบ่ายลูกค้าสั่งเครื่องดื่มเย็นมากขึ้น ช่วยดึงลูกค้าใหม่ให้ลองเมนูชา', 70, 15, C['ink'], 2)
    s.btn(304, 700, 200, 'อนุมัติ', 'MP13'); s.btn(520, 700, 260, 'อนุมัติ + Allow All แบบนี้', 'MP13', 'secondary'); s.btn(796, 700, 160, 'ไม่อนุมัติ', 'MP13', 'outline')
    s.card(1004, 190, 404, 600, r=18); s.text(1028, 230, 'ขอบเขต Allow All', 18, weight=700)
    for j, (a, b) in enumerate([('ขอบเขต', 'หมวดชา'), ('ส่วนลดสูงสุด', '15%'), ('นานสูงสุด', '4 ชม.'), ('วันละไม่เกิน', '3 โปร')]): s.field(1028, 270 + j * 90, 356, a, b)
    return s
@screen('MP15', 'customers', 'ลูกค้าที่ยินยอม', 'pos', sol='P22')
def mp15():
    s = desk('ลูกค้าที่ยินยอม', 'MP15', 'เชื่อมต่อผ่าน Messenger · ไม่แสดงรหัส Messenger · ลบได้เมื่อลูกค้าขอ')
    rows = [('ลูกค้า #L-07', '29 ต.ค.', '6', ('ยินยอม', 'green'), 'ลาเต้'), ('ลูกค้า #L-12', '28 ต.ค.', '2', ('ยินยอม', 'green'), 'มัทฉะ'), ('ลูกค้า #L-03', '27 ต.ค.', '0', ('เลิกเชื่อมต่อ', 'grey'), '—')]
    table(s, 280, 190, 1128, ['ลูกค้า', 'มาล่าสุด', 'ออเดอร์', 'สถานะ', 'ชอบ'], rows, [260, 200, 160, 260, 248], ['MP16'] * 3); return s
@screen('MP16', 'customer-detail', 'โปรไฟล์ลูกค้า', 'pos', sol='P23')
def mp16():
    s = desk('ลูกค้า #L-07', 'MP15', 'ยินยอม 27 ต.ค. · เวอร์ชันความยินยอม bitpos-meta-offers-v1', [('← ลูกค้า', 'MP15', 'outline')])
    s.card(280, 190, 560, 420, r=18); s.text(304, 230, 'ประวัติ (เฉพาะที่ยินยอม)', 18, weight=700)
    for j, (t, sub) in enumerate([('ลาเต้ × 1 · $4.00', 'แตะ NFC · 29 ต.ค.'), ('จองโต๊ะ 1 · 19:00', 'เช็กอินแล้ว · 28 ต.ค.'), ('โปรที่ได้รับ 3 ครั้ง', 'ใช้ 2 ครั้ง')]): s.row(296, 254 + j * 88, 528, t, sub, icon='orders', h=76)
    s.card(864, 190, 544, 420, r=18); s.text(888, 230, 'ความเป็นส่วนตัว', 18, weight=700); s.wrap(888, 266, 'ไม่เก็บข้อความแชท ไม่ใช้ใบหน้า ไม่ดึงข้อมูลโซเชียล ลูกค้าพิมพ์ STOP หรือกดเลิกเชื่อมต่อได้ทุกเมื่อ', 50, 14, lines=3)
    s.btn(888, 520, 300, 'ลบข้อมูลลูกค้าคนนี้', 'MP15', 'danger', h=48, size=15); return s
@screen('MP17', 'evidence', 'หลักฐาน AI และการจ่าย', 'pos', route='/meta/staff/ledger', meta_only=True)
def mp17():
    s = desk('หลักฐาน AI และการจ่าย', 'MP17', 'ทุกการเรียก Muse Spark · การแตะ · เหตุการณ์ Stripe · การตัดสินใจโปร')
    x = 280
    for t, tone in [('ทั้งหมด', 'primary'), ('AI', 'grey'), ('แตะ', 'grey'), ('Stripe', 'grey'), ('โปร', 'grey')]: x += s.pill(x, 184, t, tone, None, 34, 14) + 10
    rows = [('18:51', ('AI', 'violet'), 'agent_order · muse-spark-1.3', '1.4 s · 812 tokens', ('ok', 'green')), ('18:52', ('Stripe', 'amber'), 'checkout.session.completed', 'evt_…9A · ลายเซ็นถูก', ('PAID', 'green')),
            ('03:00', ('แตะ', 'primary'), 'sim-counter-01 · counter 37', 'SUN ถูกต้อง · ใช้ครั้งเดียว', ('ok', 'green')), ('12:44', ('โปร', 'violet'), 'Allow All อนุมัติอัตโนมัติ', 'ครัวซองต์ 20% · 8 ชม.', ('applied', 'green')),
            ('12:40', ('AI', 'violet'), 'offer_selection · fallback', 'model ไม่ว่าง · ใช้ตัวสำรอง', ('fallback', 'amber'))]
    table(s, 280, 236, 1128, ['เวลา', 'ประเภท', 'อะไร', 'รายละเอียด', 'ผล'], rows, [120, 160, 360, 320, 168], ['MP06', 'MP06', 'MP06', 'MP13', 'S01'])
    s.text(280, 620, 'เก็บ hash ของ input/output · ไม่เก็บข้อความแชท · ตรวจย้อนหลังได้ทุกคำตัดสินใจ', 13, C['muted']); return s
@screen('MP18', 'reports', 'รายงาน', 'pos', sol='P14–P20 combined')
def mp18():
    s = desk('รายงาน', 'MP18', 'แยกตามช่องทาง · จาก meta_order_feed()', [('ส่งออก CSV', 'MP18', 'outline'), ('ยอดจาก Stripe', 'MP19', 'secondary')])
    for j, (a, b, c) in enumerate([('ยอดสัปดาห์นี้', '$1,284.00', '+12% จากสัปดาห์ก่อน'), ('ออเดอร์', '286', 'เฉลี่ย $4.49'), ('คืนเงิน', '$12.00', '3 รายการ'), ('โปรที่ใช้', '41', 'Allow All 9')]): s.metric(280 + j * 284, 190, 268, a, b, c)
    s.card(280, 330, 1128, 380, r=18); s.text(304, 370, 'ยอดขายรายวันตามช่องทาง', 18, weight=700)
    for j in range(7):
        x0 = 340 + j * 150; tot = 0
        for k, (tone, v) in enumerate([('primary', .3 + .05 * (j % 3)), ('violet', .2), ('green', .15 + .03 * (j % 2)), ('ink', .08)]):
            h = v * 220; s.rect(x0, 660 - tot - h, 60, h, C[tone], 4); tot += h
        s.text(x0 + 30, 690, ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'][j], 12, C['muted'], anchor='middle')
    s.card(280, 734, 1128, 200, r=18); s.text(304, 774, 'สินค้าขายดี', 18, weight=700)
    for j, (ph, th, en, price) in enumerate(MENU[:4]): s.row(296 + j * 278, 796, 264, th, f'{60 - j * 11} แก้ว', photo=ph, h=80)
    return s
@screen('MP19', 'stripe-payouts', 'ยอดจาก Stripe', 'pos', sol='P38 (crypto → Stripe)')
def mp19():
    s = desk('ยอดและรอบโอนจาก Stripe', 'MP18', 'Stripe sandbox · บัญชีร้านค้าทดสอบ (US)', [('← รายงาน', 'MP18', 'outline')])
    for j, (a, b, c) in enumerate([('ยอดรอโอน', '$184.50', 'วันนี้'), ('ค่าธรรมเนียม Stripe', '$8.12', 'โดยประมาณ'), ('โอนครั้งถัดไป', '31 ต.ค.', 'sandbox')]): s.metric(280 + j * 376, 190, 360, a, b, c)
    rows = [('31 ต.ค.', '$1,102.40', ('กำลังโอน', 'amber'), 'po_…1'), ('24 ต.ค.', '$986.10', ('โอนแล้ว', 'green'), 'po_…0')]
    table(s, 280, 330, 1128, ['รอบ', 'ยอด', 'สถานะ', 'อ้างอิง'], rows, [260, 300, 300, 268], [None, None]); s.text(280, 520, 'ไม่มีการโอนคริปโต · ข้อมูลตัวอย่าง', 13, C['muted']); return s
@screen('MP20', 'settings', 'ตั้งค่าร้าน', 'pos', sol='P28')
def mp20():
    s = desk('ตั้งค่า', 'MP20', SHOP)
    items = [('หน้าตาร้าน', 'ปก โลโก้ คำโปรย สีธีม', 'spark', 'MP25'), ('เวลารับจองโต๊ะ', 'เวลาเปิดปิด · ช่องเวลา · รับจองถึงก่อนปิด', 'calendar', 'MP24'), ('โต๊ะ อุปกรณ์ และสติกเกอร์', 'BitPOS Mini 3 เครื่อง · NTAG 424 DNA', 'device', 'MP09'), ('ผู้ใช้และสิทธิ์', 'เจ้าของ · ผู้จัดการ · พนักงาน', 'users', 'MP21'),
             ('Messenger', 'เพจ BitPOS Muse Demo · เชื่อมต่อแล้ว · ข้อความยินยอม v1', 'chat', 'C02'), ('Stripe', 'Sandbox · webhook ตรวจลายเซ็น · ห้ามคีย์จริง', 'stripe', 'MP19'),
             ('Muse Spark', 'muse-spark-1.3 · จำกัด 10 ครั้ง/ชม./ลูกค้า · มีตัวสำรอง', 'spark', 'MP17'), ('Muse Connector (MCP)', 'meta-pay/meta/mcp/<ร้าน>', 'robot', 'MP23')]
    for j, (t, sub, ic, d) in enumerate(items): s.row(280 + (j % 2) * 572, 190 + (j // 2) * 100, 556, t, sub, icon=ic, dest=d, h=84)
    return s
@screen('MP25', 'shop-look', 'หน้าตาร้าน', 'pos', route='/meta/staff/settings/look', meta_only=True)
def mp25():
    s = desk('หน้าตาร้าน', 'MP20', 'ปก โลโก้ คำโปรย และสีของหน้าร้านลูกค้า (meta-pay)', [('← ตั้งค่า', 'MP20', 'outline')])
    s.card(280, 190, 640, 720, r=18)
    s.text(304, 228, 'ภาพปกร้าน', 15, weight=700); s.photo('iced-latte', 304, 244, 300, 150, 12); s.btn(624, 300, 180, 'เปลี่ยนรูป', 'MP25', 'secondary', h=42, size=14)
    s.text(304, 432, 'โลโก้', 15, weight=700); s.rect(304, 446, 64, 64, C['tint'], 14); s.text(336, 486, 'M', 26, C['violet'], 700, 'middle'); s.btn(388, 456, 160, 'เปลี่ยนโลโก้', 'MP25', 'secondary', h=42, size=14)
    s.text(304, 548, 'คำโปรยบนภาพปก', 15, weight=700); s.rect(304, 562, 592, 44, C['white'], 10, C['line']); s.text(320, 590, 'กาแฟช้าๆ ริมแม่น้ำ · Slow coffee by the river', 15)
    s.text(304, 644, 'สีธีม', 15, weight=700)
    for j, (c, t) in enumerate([('#0866FF', 'ฟ้า'), ('#6D28D9', 'ม่วง'), ('#15803D', 'เขียว'), ('#C2410C', 'ส้มอิฐ'), ('#BE185D', 'ชมพู'), ('#7C4A2D', 'กาแฟ'), ('#1F2937', 'ดำ')]):
        x = 304 + j * 84; s.circle(x + 14, 676, 13, c); s.text(x + 38, 681, t, 13)
        if j == 1: s.circle(x + 14, 676, 17, 'none', c)
    s.text(304, 724, 'ระบบตรวจว่าตัวหนังสือสีขาวบนสีนี้อ่านได้ (contrast 4.5 ขึ้นไป) · สีอ่อนเกินไปจะบันทึกไม่ได้', 13, C['muted'])
    s.btn(304, 840, 200, 'บันทึก', 'MP25', h=48, size=15)
    # Preview of the customer home with the chosen look.
    s.card(944, 190, 464, 720, r=18); s.text(968, 228, 'ตัวอย่างหน้าร้าน', 15, weight=700)
    s.photo('iced-latte', 968, 248, 416, 220, 16); s.rect(968, 418, 416, 50, '#000000', 0, opacity=.35); s.text(984, 450, 'กาแฟช้าๆ ริมแม่น้ำ', 16, C['white'], 600)
    s.rect(968, 488, 40, 40, C['tint'], 10); s.text(988, 515, 'M', 18, '#6D28D9', 700, 'middle'); s.text(1020, 515, 'Muse Café', 18, weight=700)
    s.text(968, 556, 'สั่งจากมือถือ จ่ายด้วย Stripe', 14, C['muted']); s.pill(968, 572, 'เปิดอยู่ · 10:00–22:00', 'green', None, 28, 13)
    s.rect(968, 760, 416, 52, '#6D28D9', 12); s.text(1176, 792, 'ดูเมนู / Menu', 16, C['white'], 600, 'middle'); s.hot(968, 760, 416, 52, 'C18')
    s.text(968, 850, 'ใช้กับหัวเว็บ ปุ่ม ภาพปก ชื่อร้าน และการ์ดต้อนรับใน Messenger', 13, C['muted'])
    return s
@screen('MP21', 'users', 'ผู้ใช้และสิทธิ์', 'pos', sol='P25')
def mp21():
    s = desk('ผู้ใช้และสิทธิ์', 'MP20', 'ตรวจสิทธิ์ใหม่ทุกคำขอที่เซิร์ฟเวอร์', [('← ตั้งค่า', 'MP20', 'outline')])
    rows = [('นัท', 'owner@muse-cafe.test', ('เจ้าของ', 'primary'), 'ทุกอย่าง + Allow All'), ('มายด์', 'manager@muse-cafe.test', ('ผู้จัดการ', 'violet'), 'อนุมัติโปร · คืนเงิน'), ('ก้อง', 'staff@muse-cafe.test', ('พนักงาน', 'grey'), 'ออเดอร์ · ส่งมอบ')]
    table(s, 280, 190, 1128, ['ชื่อ', 'อีเมล', 'บทบาท', 'ทำได้'], rows, [200, 360, 240, 328], [None] * 3); return s
@screen('MP22', 'kitchen-queue', 'คิวครัว', 'pos', sol='P30')
def mp22():
    s = desk('คิวครัว', 'MP22', 'เรียงตามเวลาที่จ่าย · ทุกช่องทาง · สั่งล่วงหน้าเข้าคิวเมื่อเช็กอิน')
    # Pre-orders for booked tables wait above the lanes until the customer taps in at the table.
    s.card(280, 190, 1128, 96, C['white'], True, 18); s.pill(300, 206, 'สั่งล่วงหน้า 2', 'violet', None, 30, 14)
    s.text(440, 227, 'เข้าคิวครัวเมื่อลูกค้าแตะเช็กอินที่โต๊ะ · จองหลุด/ยกเลิก ไม่คืนเงิน', 13, C['muted'])
    for k, (t, sub, tone, lbl) in enumerate([('#B7E2 · ลาเต้ × 2, ครัวซองต์ × 1', 'โต๊ะ 1 · 19:00', 'amber', 'รอเช็กอิน'), ('#D41F · มัทฉะ × 1', 'โต๊ะ 2 · 17:30', 'red', 'จองหลุด · ไม่คืนเงิน')]):
        x = 300 + k * 540; s.text(x, 266, t, 14, weight=600); s.text(x + 240, 266, sub, 13, C['muted']); s.pill(x + 340, 249, lbl, tone, None, 26, 12); s.hot(x - 8, 246, 520, 30, 'MP06')
    lanes = [('ต้องทำ', 'amber', [('#4464', 'ลาเต้ × 1', 'แตะ NFC · 2 นาที'), ('#T7A1', 'มัทฉะ × 1, ครัวซองต์ × 1', 'โต๊ะ 1 · 4 นาที')]), ('กำลังทำ', 'primary', [('#6BCC', 'ลาเต้ × 1', 'AI agent · 6 นาที')]), ('พร้อมรับ', 'green', [('#C923', 'ลาเต้ × 1', 'แชท · รอลูกค้า')])]
    for j, (head, tone, cards) in enumerate(lanes):
        x = 280 + j * 382; s.card(x, 302, 364, 608, C['white'], True, 18); s.pill(x + 20, 322, head, tone, None, 32, 14)
        for k, (code, items, sub) in enumerate(cards): s.row(x + 12, 374 + k * 100, 340, f'{code} · {items}', sub, icon='coffee', dest='MP06', h=88)
    return s
@screen('MP24', 'booking-hours', 'เวลารับจองโต๊ะ', 'pos', route='/meta/staff/bookings/hours', meta_only=True)
def mp24():
    s = desk('เวลารับจองโต๊ะ', 'MP08', 'ลูกค้าเห็นเฉพาะเวลาที่ร้านเปิดและโต๊ะว่าง · เจ้าของ/ผู้จัดการแก้ได้', [('← การจองโต๊ะ', 'MP08', 'outline')])
    s.card(280, 190, 1128, 520, r=18); s.text(304, 228, 'เวลาเปิด–ปิดร้าน', 18, weight=700)
    s.text(304, 256, 'ใช้ตารางเวลาเปิดปิดเดียวกับ POS · เว้นว่างทั้งแถว = ร้านปิดวันนั้น · ช่วงที่ 2 สำหรับร้านที่ปิดพักกลางวัน', 13, C['muted'])
    days = [('จันทร์', ('10:00', '22:00'), None), ('อังคาร', None, None), ('พุธ', ('10:00', '22:00'), None), ('พฤหัสบดี', ('10:00', '22:00'), None),
            ('ศุกร์', ('11:00', '14:00'), ('17:00', '23:00')), ('เสาร์', ('09:00', '23:00'), None), ('อาทิตย์', ('09:00', '21:00'), None)]
    for k, (d, w1, w2) in enumerate(days):
        y = 290 + k * 56; s.text(304, y + 30, d, 15, weight=600)
        for n, w in enumerate((w1, w2)):
            x = 470 + n * 360
            for m, t in enumerate(w or ('', '')):
                s.rect(x + m * 160, y + 8, 130, 38, C['white'], 8, C['line']); s.text(x + m * 160 + 16, y + 33, t or '--:--', 15, C['ink'] if t else C['muted'])
            s.text(x + 138, y + 33, '–', 15, C['muted'])
        if not w1: s.pill(1220, y + 14, 'ปิด', 'grey', None, 26, 12)
    s.card(280, 730, 552, 120, r=18); s.text(304, 768, 'ระยะห่างระหว่างช่องเวลา', 15, weight=700)
    for j, t in enumerate(['15 นาที', '30 นาที', '60 นาที']): s.pill(304 + j * 110, 790, t, 'primary' if j == 1 else 'grey', 100, 34, 14)
    s.card(856, 730, 552, 120, r=18); s.text(880, 768, 'รับจองถึงก่อนปิดกี่นาที', 15, weight=700)
    s.rect(880, 788, 120, 40, C['white'], 8, C['line']); s.text(900, 814, '90', 16); s.text(1016, 814, 'ร้านปิด 22:00 จองได้ถึง 20:30', 13, C['muted'])
    s.btn(280, 870, 200, 'บันทึก', 'MP08', h=48, size=15); s.text(500, 900, 'ตัวอย่าง: วันอังคารร้านปิด แชทตอบ “วันนั้นร้านปิด” · พิมพ์ 21:00 วันศุกร์ แชทบอกช่วงที่จองได้', 13, C['muted'])
    return s
@screen('MP23', 'mcp-connector', 'Muse Connector (MCP)', 'pos', route='/meta/mcp/:merchant', meta_only=True)
def mp23():
    s = desk('Muse Connector (MCP)', 'MP23', 'ให้ AI agent สั่งจากร้านได้ · agent ไม่เห็นเลขบัตร และตั้งราคาเองไม่ได้')
    s.card(280, 190, 1128, 150, r=18); s.text(304, 230, 'ปลายทาง', 15, C['muted']); s.rect(304, 248, 860, 50, C['bg'], 12); s.text(324, 280, 'https://meta-pay.cashlessthailand.com/meta/mcp/<merchant-id>', 15)
    s.btn(1180, 248, 204, 'คัดลอก', 'MP23', 'secondary', h=50, size=15)
    for j, (t, sub) in enumerate([('list_menu', 'เมนูและราคาจากเซิร์ฟเวอร์'), ('get_quote', 'quote เป็นหน่วยย่อย อายุ 10 นาที'), ('complete_checkout', 'Stripe Shared Payment Token'), ('order_status', 'สถานะและรหัสรับ'), ('cancel_order', 'คืนเงินก่อนส่งมอบ')]):
        s.row(280 + (j % 3) * 380, 364 + (j // 3) * 96, 364, t, sub, icon='robot', tone='violet', h=80)
    s.card(280, 576, 1128, 220, r=18); s.text(304, 614, 'ออเดอร์จาก agent ล่าสุด', 18, weight=700); s.row(296, 636, 540, '#6BCC ลาเต้ × 1 · $4.00', 'complete_checkout · 13:52', icon='robot', badge=('จ่ายแล้ว', 'green'), dest='MP06', h=72)
    s.row(852, 636, 540, '#F846 ลาเต้ × 1', 'cancel_order · คืนเงินแล้ว', icon='robot', badge=('คืนเงิน', 'red'), dest='MP06', h=72); return s

# meta-pos mobile
def posm(title, back=None):
    s = mobile(title, back=back); s.rect(0, 758, 390, 86, C['white'], 0); s.line(0, 758, 390, 758)
    for i, (ic, label, dest) in enumerate([('orders', 'ออเดอร์', 'MPM01'), ('calendar', 'การจอง', 'MPM03'), ('chart', 'เดสก์ท็อป', 'MP02')]):
        x = 65 + i * 130; s.icon(ic, x - 11, 774, 22, C['primary'] if i == 0 else C['muted']); s.text(x, 815, label, 11, C['muted'], 500, 'middle'); s.hot(i * 130, 758, 130, 70, dest)
    home_bar(s); return s
@screen('MPM01', 'm-orders', 'ออเดอร์ (มือถือ)', 'posm', sol='S11')
def mpm01():
    s = posm('ออเดอร์'); x = 24
    for t, on in [('จ่ายแล้ว 3', 1), ('รอจ่าย 1', 0), ('ส่งมอบแล้ว', 0)]: x += s.pill(x, 120, t, 'primary' if on else 'grey', None, 32, 13) + 8
    for j, (t, sub, b) in enumerate([('#4464 ลาเต้ × 1', 'แตะ NFC · $4.00 · 2 นาที', ('จ่ายแล้ว', 'green')), ('#T7A1 มัทฉะ × 1, ครัวซองต์', 'โต๊ะ 1 · $9.50', ('จ่ายแล้ว', 'green')), ('#6BCC ลาเต้ × 1', 'AI agent · $4.00', ('จ่ายแล้ว', 'green')), ('#K-0182', 'หน้าร้าน · $14.00', ('รอจ่าย', 'amber'))]):
        s.row(24, 168 + j * 90, 342, t, sub, icon='orders', badge=b, dest='MPM02', h=78)
    return s
@screen('MPM02', 'm-order-detail', 'ส่งมอบ (มือถือ)', 'posm', sol='S12')
def mpm02():
    s = posm('#4464', back='MPM01'); s.row(24, 124, 342, 'ลาเต้ × 1', 'แตะ NFC · โปร −20%', photo='latte', right='$4.00')
    s.card(24, 220, 342, 190, r=20); s.text(195, 266, 'รหัสรับสินค้า', 14, C['muted'], anchor='middle'); s.text(195, 336, '#4464', 52, C['primary'], 700, 'middle'); s.pill(147, 360, 'จ่ายแล้ว', 'green', 96)
    s.btn(24, 600, 342, 'ส่งมอบแล้ว', 'MPM01', icon='check'); s.btn(24, 664, 342, 'คืนเงิน', 'MP07', 'danger', h=48, size=15); return s
@screen('MPM03', 'm-bookings', 'การจอง (มือถือ)', 'posm', meta_only=True)
def mpm03():
    s = posm('การจองวันนี้')
    for j, (t, sub, b, d) in enumerate([('โต๊ะ 1 · 19:00 · 2 คน', '#97C8 · เหลือ 12 นาที', ('รอเช็กอิน', 'amber'), 'T03'), ('โต๊ะ 2 · 18:30 · 4 คน', '#A1B2', ('เช็กอินแล้ว', 'green'), 'T04'), ('โต๊ะ 1 · 17:00', '#C3D4', ('หลุดคิว', 'red'), 'MP08')]):
        s.row(24, 124 + j * 90, 342, t, sub, icon='calendar', badge=b, dest=d, h=78)
    return s

# ================================================================ 30 BitPOS Mini (480×320) — matches the firmware screenshots (META_SHOT)
@screen('B01', 'mini-idle', 'รอแตะ', 'mini', fw='idle')
def b01():
    s = mini(); mstatus(s, 'blue', 'wifi', 'Muse Café', join='B12', lines=[('Tap your phone here or scan to open Messenger', 'cream'), ('Offers, ordering and Stripe payment in chat', 'muted')])
    s.hot(MARGIN, 60, 100, 120, 'B02'); s.hot(MARGIN, 240, 456, 70, 'B13'); return s
@screen('B02', 'mini-tap-new', 'แตะแล้ว (ลูกค้าใหม่)', 'mini', fw='tap.new')
def b02():
    s = mini(); mstatus(s, 'blue', 'chevron', 'Continue on your phone', join='B12', lines=[('Accept in Messenger so the shop remembers you', 'cream'), ('Or order from the table QR without it', 'muted')])
    s.hot(MARGIN, 60, 100, 120, 'C02'); s.hot(MARGIN, 230, 456, 80, 'B03'); return s
@screen('B03', 'mini-welcome', 'ยินดีต้อนรับกลับ + โปร', 'mini', fw='tap.known')
def b03():
    s = mini(); s.photo('latte', MARGIN, BODY_Y + 8, 240, 240, 0)
    s.a.append(f'<circle cx="200" cy="104" r="34" fill="{GRAD[0]}" stroke="#fff" stroke-width="3"/>'); s.text(200, 112, '−20%', 20, '#FFFFFF', 700, 'middle')
    s.text(MARGIN + 12, 286, 'Latte', 17, '#FFFFFF', 600)
    x = MARGIN + 252; s.rect(x, 60, 204, 240, M['panel'], 16); s.rect(x + 14, 74, 92, 30, M['chip'], 15); s.text(x + 60, 95, 'Today', 15, M['chiptx'], 500, 'middle')
    s.text(x + 14, 136, 'Welcome back', 16, M['cream'], 500); s.text(x + 14, 176, 'Your offer is in', 15, M['muted']); s.text(x + 14, 200, 'Messenger', 15, M['muted'])
    mbtn(s, x + 12, 240, 180, 'See on phone', 'C04'); return s
@screen('B04', 'mini-stripe-qr', 'QR ชำระ (Stripe)', 'mini', fw='pay.qr')
def b04():
    s = mini(); mqr(s); x = MARGIN + 240; w = 480 - MARGIN - x
    s.rect(x, BODY_Y, w, BODY_H, M['panel'], 12); s.text(x + 14, BODY_Y + 34, 'Scan to pay', 18, M['blue'], 500)
    s.text(x + 14, BODY_Y + 66, 'TOTAL', 12, M['muted'], 500); s.text(x + 14, BODY_Y + 104, '$9.45', 32, M['cream'], 500); s.line(x + 14, BODY_Y + 116, x + w - 14, BODY_Y + 116, M['line'])
    s.text(x + 14, BODY_Y + 150, 'Latte x1, Croissant x1', 15, M['cream']); s.text(x + 14, BODY_Y + BODY_H - 40, 'Stripe sandbox -', 15, M['muted']); s.text(x + 14, BODY_Y + BODY_H - 16, 'not real money', 15, M['muted'])
    s.hot(MARGIN, BODY_Y, 228, BODY_H, 'B05'); return s
@screen('B05', 'mini-waiting', 'รอ Stripe ยืนยัน', 'mini', fw='pay.waiting')
def b05():
    s = mini(); return mstatus(s, 'amber', 'clock', 'Waiting for Stripe…', lines=[('Not paid until the Stripe webhook confirms', 'muted')], dests=[(0, 44, 480, 276, 'B06')])
@screen('B06', 'mini-paid', 'จ่ายแล้ว', 'mini', fw='pay.paid')
def b06():
    s = mini(); return mstatus(s, 'green', 'check', 'Paid - thank you', big='#A1B2', lines=[('Pickup code - confirmed by Stripe', 'cream')], dests=[(0, 44, 480, 276, 'B11')])
@screen('B07', 'mini-reserved', 'จองไว้ · รอเช็กอิน', 'mini', fw='table.check_in')
def b07():
    s = mini(); return mstatus(s, 'red', 'bell', 'Reserved - tap to check in', big='08:56', lines=[('2 guests - 18:30 - table frees at 18:45', 'cream')], dests=[(0, 44, 480, 276, 'B09')])
@screen('B08', 'mini-upcoming', 'จองไว้ (ยังไม่ถึงเวลา)', 'mini', fw='table.upcoming')
def b08():
    s = mini(); return mstatus(s, 'violet', 'bell', 'Reserved 19:00 - 4 guests', big='1:24:56', lines=[('Check-in opens at 18:45', 'cream')], dests=[(0, 44, 480, 276, 'B07')])
@screen('B09', 'mini-seated', 'เช็กอินแล้ว', 'mini', fw='table.seated')
def b09():
    s = mini(); return mstatus(s, 'blue', 'check', 'Checked in - welcome', join='B12', lines=[('This table is yours until 20:30', 'cream'), ('Order from your phone or the table QR', 'muted')], dests=[(MARGIN, 230, 456, 80, 'C19')])
@screen('B10', 'mini-offline', 'ออฟไลน์', 'mini', fw='net.offline')
def b10():
    s = mini(online=False); return mstatus(s, 'amber', 'warn', 'Reconnecting…', lines=[('Open orders are kept - no double charges', 'muted')], dests=[(0, 44, 480, 276, 'B01')])
@screen('B11', 'mini-ready', 'พร้อมรับ', 'mini', fw='order.ready')
def b11():
    s = mini(); return mstatus(s, 'green', 'coffee', 'Ready for pickup', big='#A1B2', lines=[('Latte x2, Croissant x1', 'cream')], dests=[(0, 44, 480, 276, 'B01')])
@screen('B12', 'mini-join-qr', 'สแกน QR เข้า Messenger', 'mini', fw='join')
def b12():
    s = mini(); mqr(s, seed=23); x = MARGIN + 240; w = 480 - MARGIN - x
    s.rect(x, BODY_Y, w, BODY_H, M['panel'], 12); s.text(x + 14, BODY_Y + 34, 'Open Messenger', 18, M['blue'], 500)
    for n, (t, c) in enumerate([('1. Scan the QR', 'cream'), ('2. Accept in chat', 'cream'), ('Offers + menu in chat', 'muted')]): s.text(x + 14, BODY_Y + 72 + n * 32, t, 17, M[c])
    s.text(x + 14, BODY_Y + 176, 'QR expires in 2:23', 17, M['muted']); mbtn(s, x + 14, BODY_Y + BODY_H - 60, w - 28, 'Back', 'B01', M['line'])
    s.hot(MARGIN, BODY_Y, 228, BODY_H, 'C02'); return s
@screen('B13', 'mini-offer-anim', 'โปรเคลื่อนไหว (โปรคู่)', 'mini', fw='idle.anim')
def b13():
    s = mini(); s.photo('latte', MARGIN, 60, 120, 240, 0); s.photo('croissant', MARGIN + 120, 60, 120, 240, 0); s.rect(MARGIN + 119, 60, 2, 240, '#FFFFFF', 0)
    s.circle(MARGIN + 120, 160, 15, '#FFFFFF'); s.text(MARGIN + 120, 167, '+', 22, GRAD[0], 700, 'middle')
    s.a.append(f'<circle cx="200" cy="104" r="34" fill="{GRAD[0]}" stroke="#fff" stroke-width="3"/>'); s.text(200, 112, '−10%', 20, '#FFFFFF', 700, 'middle')
    s.text(MARGIN + 12, 286, 'Latte + Croissant', 16, '#FFFFFF', 600)
    x = MARGIN + 252; s.rect(x, 60, 204, 240, M['panel'], 16); s.rect(x + 14, 74, 92, 30, M['chip'], 15); s.text(x + 60, 95, 'Today', 15, M['chiptx'], 500, 'middle')
    s.text(x + 14, 136, 'Muse Cafe', 17, M['cream'], 500); s.text(x + 14, 176, 'Tap your phone here', 15, M['muted']); s.text(x + 14, 200, 'or scan the QR', 15, M['muted'])
    # The animation opens with both real menu photos, then loops into the Muse Image picture (anim.ts).
    mbtn(s, x + 12, 240, 180, 'Scan to chat', 'B12'); s.hot(MARGIN, 60, 240, 240, 'B03'); return s

# ================================================================ 31 table screen
@screen('T01', 'tscreen-free', 'ว่าง', 'tscreen', route='/meta/screen/:tag')
def t01(): return tscreen(C['green'], 'ว่าง', 'แตะมือถือที่เครื่องเพื่อรับโปรและสั่ง', dest_next='T02')
@screen('T02', 'tscreen-upcoming', 'จองไว้', 'tscreen', route='/meta/screen/:tag')
def t02(): return tscreen(C['violet'], 'จองไว้ 19:00', '2 คน · เช็กอินได้ตั้งแต่ 18:55', '41:30', 'เปิดเช็กอินใน', 'T03')
@screen('T03', 'tscreen-checkin', 'รอเช็กอิน', 'tscreen', route='/meta/screen/:tag')
def t03(): return tscreen(C['red'], 'รอผู้จองเช็กอิน', 'แตะเพื่อเช็กอิน · ไม่มาภายใน 19:15 โต๊ะจะว่าง', '12:04', 'โต๊ะจะว่างใน', 'T04')
@screen('T04', 'tscreen-seated', 'เช็กอินแล้ว', 'tscreen', route='/meta/screen/:tag')
def t04(): return tscreen(C['primary'], 'เช็กอินแล้ว ✓', '2 คน · จองถึง 20:30', dest_next='T01')

# ================================================================ 40 states
STATE_NEXT = {'S01': 'S02', 'S02': 'S03', 'S03': 'S04', 'S04': 'S05', 'S05': 'S06', 'S06': 'S01'}
def state(code, title, sub, ic, tone, primary, secondary):
    s = mobile(title, back=secondary[1]); s.text(366, 136, f'สถานะถัดไป ({STATE_NEXT[code]}) →', 12, C['primary'], 600, 'end'); s.hot(220, 120, 150, 24, STATE_NEXT[code]); s.circle(195, 240, 56, C[tone + 'bg']); s.icon(ic, 167, 212, 56, C[tone], 2.2)
    s.text(195, 340, title, 24, weight=700, anchor='middle'); s.wrap(48, 380, sub, 32, 15, lines=3)
    s.btn(24, 676, 342, primary[0], primary[1]); s.btn(24, 740, 342, secondary[0], secondary[1], 'ghost'); home_bar(s); return s
@screen('S01', 'model-fallback', 'Muse Spark ไม่ว่าง', 'states')
def s01(): return state('S01', 'ใช้ตัวช่วยสำรอง', 'Muse Spark ไม่ตอบหรือเกินโควตา 10 ครั้ง/ชม. ร้านยังทำงานต่อด้วยตัวจับคำสำรอง และบันทึกในหลักฐาน', 'spark', 'violet', ('ดูหลักฐาน', 'MP17'), ('กลับไปแชท', 'C08'))
@screen('S02', 'rate-limited', 'ส่งคำสั่งถี่เกินไป', 'states', route='/meta/order (429)')
def s02(): return state('S02', 'รอสักครู่', 'ส่งคำสั่งเกิน 30 ครั้งต่อนาที รอสักครู่แล้วลองใหม่', 'clock', 'amber', ('ลองใหม่', 'C11'), ('กลับหน้าร้าน', 'C18'))
@screen('S03', 'not-connected', 'ยังไม่ได้เชื่อมต่อ', 'states', route='/meta/order (401)')
def s03(): return state('S03', 'ยังไม่ได้เชื่อมต่อ', 'แตะมือถือที่เครื่องในร้านเพื่อเริ่ม หรือสั่งจาก QR บนโต๊ะโดยไม่ต้องเชื่อมต่อ', 'nfc', 'primary' if False else 'amber', ('แตะเพื่อเริ่ม', 'C01'), ('สั่งจาก QR', 'C18'))
@screen('S04', 'same-origin', 'คำขอไม่ถูกต้อง', 'states', route='403 same-origin')
def s04(): return state('S04', 'คำขอไม่ถูกต้อง', 'ฟอร์มต้องส่งจากหน้าของร้านเอง (ป้องกันการกดแทน) เปิดหน้าใหม่แล้วลองอีกครั้ง', 'shield', 'red', ('เปิดหน้าร้านใหม่', 'C18'), ('กลับ', 'C04'))
@screen('S05', 'price-changed', 'ราคาเปลี่ยน', 'states', sol='S07')
def s05(): return state('S05', 'ราคาเปลี่ยนแล้ว', 'ร้านปรับราคาหรือโปรหมดเวลา ระบบคิดราคาใหม่ก่อนจ่ายเสมอ ยังไม่มีการตัดเงิน', 'tag', 'amber', ('ดูราคาใหม่', 'C21'), ('กลับไปเมนู', 'C19'))
@screen('S06', 'sold-out', 'สินค้าหมด', 'states', sol='S09')
def s06(): return state('S06', 'เมนูนี้หมดแล้ว', 'ถ้าจ่ายไปแล้วแต่สต็อกหมด พนักงานจะเห็นป้ายสต็อกไม่พอ และคืนเงินให้ได้', 'box', 'red', ('เลือกเมนูอื่น', 'C19'), ('ช่วยเหลือ', 'C27'))

# ================================================================ 50 handoff
@screen('H01', 'routes', 'เส้นทางและการเชื่อมโยง', 'handoff')
def h01():
    s = SVG(1600, 1100, C['white']); s.text(64, 90, 'ส่งต่อทีมพัฒนา · เส้นทางจริง', 34, weight=700)
    rows = [('meta-pay', 'https://meta-pay.cashlessthailand.com', 'C01–C27, CD01–CD03, T01–T04, MCP'), ('meta-pos', 'https://meta-pos.cashlessthailand.com', 'MP01–MP23, MPM01–MPM03'),
            ('BitPOS Mini', 'เฟิร์มแวร์ Meta (product bitpos_terminal_meta)', 'B01–B13'), ('Messenger', 'webhook: meta-pay/meta/messenger/webhook', 'C02, C08–C10, C12, C15'), ('Stripe', 'webhook: meta-pay/meta/stripe/webhook (sandbox)', 'C05–C07, C22–C26, MP04, MP07, MP19')]
    for j, (a, b, c) in enumerate(rows):
        y = 150 + j * 110; s.card(64, y, 1472, 92); s.text(90, y + 38, a, 18, weight=700); s.text(300, y + 38, b, 15); s.text(300, y + 66, c, 13, C['muted'])
    s.text(64, 760, 'ไฟล์ประกอบ: handoff/screen-map.json · handoff/interaction-map.json · handoff/tokens.json · reports/link-audit.json · reports/diff-vs-sol.md', 15, C['muted'])
    s.btn(64, 1000, 200, '← เริ่มที่นี่', 'A00', 'outline', h=48, size=15); return s

# ================================================================ build
ORDER = ['start', 'found', 'pay', 'chat', 'paydesk', 'pos', 'posm', 'mini', 'tscreen', 'states', 'handoff']

def audit(manifest, links):
    ids = {d['id'] for d in manifest}; out = {d['id']: set() for d in manifest}; incoming = {d['id']: set() for d in manifest}; missing = []
    for l in links:
        if l['dest'] not in ids: missing.append(l)
        else: out[l['source']].add(l['dest']); incoming[l['dest']].add(l['source'])
    seen, stack = {'A00'}, ['A00']
    while stack:
        for n in out[stack.pop()]:
            if n not in seen: seen.add(n); stack.append(n)
    unreachable = sorted(ids - seen); dead_ends = sorted(i for i in ids if not out[i])
    only_from_directory = sorted(i for i in ids if i != 'A00' and incoming[i] <= {'A00'})
    return {'screens': len(ids), 'links': len(links), 'missing_destinations': missing, 'unreachable_from_A00': unreachable, 'dead_ends': dead_ends,
            'reachable_only_from_directory': only_from_directory, 'pass': not missing and not unreachable and not dead_ends}

def build():
    manifest, links, built = [], [], {}
    for d in SCREENS_LIST:
        if d['id'] in ('A01',): continue
        s = d['fn'](); built[d['id']] = s
        links.extend({'source': d['id'], **l} for l in s.links)
    a01_screen = a01(); built['A01'] = a01_screen; links.extend({'source': 'A01', **l} for l in a01_screen.links)
    pre = [{'id': d['id']} for d in SCREENS_LIST]; result = audit(pre, links)
    lines = [f"หน้าทั้งหมด {result['screens']} · ลิงก์ {result['links']} · ผล: {'ผ่าน ✓' if result['pass'] else 'ไม่ผ่าน'}",
             f"ปลายทางที่ไม่มีจริง: {len(result['missing_destinations'])}", f"หน้าที่ไปไม่ถึงจาก A00: {len(result['unreachable_from_A00'])} {' '.join(result['unreachable_from_A00'])}",
             f"หน้าทางตัน (ไม่มีปุ่มไปต่อ): {len(result['dead_ends'])} {' '.join(result['dead_ends'])}",
             f"หน้าที่เข้าได้จากสารบัญอย่างเดียว: {len(result['reachable_only_from_directory'])} {' '.join(result['reachable_only_from_directory'])}"]
    i = next(n for n, a in enumerate(a01_screen.a) if '{{AUDIT}}' in a); a01_screen.a.pop(i)
    for n, t in enumerate(lines): a01_screen.text(64, 200 + n * 40, t, 18, C['green'] if (n == 0 and result['pass']) else C['ink'], 600 if n == 0 else 400)
    commands = [{'command': 'file.new', 'params': {'name': 'BitPOS × Muse UI'}}]
    first = True
    for key in ORDER:
        commands.append({'command': 'page.rename' if first else 'page.add', 'params': {'name': PAGES[key]}}); first = False
        group = [d for d in SCREENS_LIST if d['page'] == key]
        for j, d in enumerate(group):
            s = built[d['id']]; p = SCREENS / f"{d['id']}-{d['slug']}.svg"; s.save(p)
            cols = 6 if s.w <= 480 else 4 if s.w <= 1024 else 2
            x = (j % cols) * (s.w + 120); y = (j // cols) * (s.h + 140)
            commands.append({'command': 'file.import', 'params': {'path': str(p), 'x': x, 'y': y}})
            manifest.append({k: v for k, v in d.items() if k != 'fn'} | {'page': PAGES[key], 'width': s.w, 'height': s.h, 'source': str(p.relative_to(OUT)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'fixture': True})
    (OUT / 'reports/import-commands.json').write_text(json.dumps(commands, ensure_ascii=False, indent=1))
    with (OUT / 'reports/import-results.jsonl').open('w') as log:
        subprocess.run([str(CLI), 'run', str(OUT / 'reports/import-commands.json'), '--out', str(MASTER)], stdout=log, check=True)
    # Prototype links: every hotspot rectangle navigates to its destination frame.
    doc = json.loads(zipfile.ZipFile(MASTER).read('document.json')); nodes = doc['nodes']
    frames = {n['name'].split('-')[0]: int(k) for k, n in nodes.items() if n.get('type') == 'frame' and nodes.get(str(n.get('parent')), {}).get('type') == 'page'}
    proto, wired = [], 0
    for k, n in nodes.items():
        name = n.get('name') or ''
        if n.get('type') == 'rectangle' and name.startswith('Hotspot → '):
            dest = name.split('→ ', 1)[1]
            if dest in frames: proto.append({'command': 'proto.interaction.add', 'params': {'id': int(k), 'dest': frames[dest]}}); wired += 1
    proto.append({'command': 'proto.settings', 'params': {'device': 'None'}})
    (OUT / 'reports/prototype-commands.json').write_text(json.dumps(proto, ensure_ascii=False))
    with (OUT / 'reports/prototype-results.jsonl').open('w') as log:
        subprocess.run([str(CLI), 'run', str(OUT / 'reports/prototype-commands.json'), '--in', str(MASTER), '--out', str(MASTER)], stdout=log, check=True)
    final = audit(manifest, links); final['prototype_links_wired'] = wired; final['frames_in_file'] = len(frames)
    (OUT / 'reports/link-audit.json').write_text(json.dumps(final, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'handoff/screen-map.json').write_text(json.dumps({'version': '1.0.0', 'name': 'BitPOS × Muse UI', 'screens': manifest, 'count': len(manifest), 'pages': PAGES}, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'handoff/interaction-map.json').write_text(json.dumps(links, ensure_ascii=False, indent=1) + '\n')
    print(f"{len(manifest)} screens, {len(links)} links, {wired} prototype links wired, audit pass={final['pass']}")
    if not final['pass']: print(json.dumps({k: final[k] for k in ('missing_destinations', 'unreachable_from_A00', 'dead_ends')}, ensure_ascii=False)[:2000])

if __name__ == '__main__':
    build()
