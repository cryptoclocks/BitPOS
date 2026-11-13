# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Adapted from the PayPal edition builder (paypal-hackathon/design/pp-edition/build/generators/72-74/lib.py):
# same SVG-as-source approach, new tokens, shells and components for the NEAR "Living Bill" edition.
"""SVG helper library for the BitPOS x NEAR FigCraft screens. Stdlib only (python3 -I)."""
import json
import math
import os
import random
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'widths.json'), encoding='utf-8') as _fh:
    _W = json.load(_fh)
FONT = 'Noto Sans Thai'
_ZERO = set('ัิีึืฺุู็่้๊๋์ํ๎')

# BitPOS's own palette for this edition (not NEAR's brand).
C = dict(
    ink='#0B1020', paper='#F6F7F2', card='#FFFFFF', line='#DDE2D8', mint='#00B37E', amber='#F2A93B',
    red='#C8443C', muted='#5E6B7A', violet='#6B4EFF',
    # derived tints / text-safe shades
    mintbg='#E3F6EE', minttext='#00704F', amberbg='#FDF1DA', ambertext='#7A4E00', redbg='#FAE7E5',
    violetbg='#EEEAFF', violettext='#4A2FD6', grey='#EEF0EA', ink2='#151C30', ink3='#232C45', ink4='#3A4563',
    onink='#FFFFFF', oninkmuted='#A9B3C6', white='#FFFFFF',
)

# The sample "Living Bill": 5.00 tUSD split four ways. Integer minor units (6 decimals on chain, shown with 2).
BILL_TOTAL = 500
SPLIT = [('owner', 355), ('tips', 50), ('tax', 35), ('supplier', 60)]
assert sum(v for _, v in SPLIT) == BILL_TOTAL, 'sample split must sum to the bill total'
SPLIT_COLOR = {'owner': C['ink'], 'tips': C['mint'], 'tax': C['amber'], 'supplier': C['muted']}
SPLIT_COLOR_DARK = {'owner': '#FFFFFF', 'tips': C['mint'], 'tax': C['amber'], 'supplier': '#8FA0BA'}
ACCT = dict(
    root='bitpos-near.testnet', shop='orbit.bitpos-near.testnet', tax='tax.orbit.bitpos-near.testnet',
    mai='mai.orbit.bitpos-near.testnet', ton='ton.orbit.bitpos-near.testnet',
    milk='milkfarm.bitpos-near.testnet', beans='beans.bitpos-near.testnet',
    bills='bills.bitpos-near.testnet', token='tusd.bitpos-near.testnet', relayer='relayer.bitpos-near.testnet',
    cfo='cfo.orbit.bitpos-near.testnet', alice='alice.bitpos-near.testnet',
)
BILL_ID = 'B-7K2M9Q'


def money(minor):
    return '%d.%02d' % (minor // 100, minor % 100)


def tw(s, size=14, weight=400):
    k = '400' if weight < 500 else ('600' if weight < 650 else '700')
    t = _W[k]
    return sum(0.0 if ch in _ZERO else t.get(ch, 62.0) for ch in s) * size / 100.0


def wrap(s, size, weight, maxw):
    words = s.split(' ')
    lines, cur = [], ''
    for w in words:
        cand = (cur + ' ' + w) if cur else w
        if tw(cand, size, weight) <= maxw or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def f(v):
    if isinstance(v, float):
        v = round(v, 2)
        if v == int(v):
            v = int(v)
    return str(v)


class Overflow(Exception):
    pass


class Doc:
    def __init__(self, name, w, h, bg=None):
        self.name, self.w, self.h = name, w, h
        self.out = []
        self.ids = {}
        self.hot = {}
        if bg:
            self.rect(0, 0, w, h, fill=bg, id='background')

    def uid(self, i):
        if i is None:
            return None
        if i in self.ids:
            self.ids[i] += 1
            return '%s-%d' % (i, self.ids[i])
        self.ids[i] = 1
        return i

    def _id(self, i):
        i = self.uid(i)
        return (' id="%s"' % i) if i else ''

    def rect(self, x, y, w, h, fill=None, rx=0, stroke=None, sw=1, dash=None, id=None, op=None):
        a = '<rect%s x="%s" y="%s" width="%s" height="%s"' % (self._id(id), f(x), f(y), f(w), f(h))
        if rx:
            a += ' rx="%s"' % f(rx)
        a += ' fill="%s"' % (fill or 'none')
        if op is not None:
            a += ' fill-opacity="%s"' % op
        if stroke:
            a += ' stroke="%s" stroke-width="%s"' % (stroke, f(sw))
            if dash:
                a += ' stroke-dasharray="%s"' % dash
        self.out.append(a + '/>')

    def circle(self, cx, cy, r, fill=None, stroke=None, sw=1, id=None, dash=None, op=None):
        a = '<circle%s cx="%s" cy="%s" r="%s" fill="%s"' % (self._id(id), f(cx), f(cy), f(r), fill or 'none')
        if op is not None:
            a += ' fill-opacity="%s"' % op
        if stroke:
            a += ' stroke="%s" stroke-width="%s"' % (stroke, f(sw))
            if dash:
                a += ' stroke-dasharray="%s"' % dash
        self.out.append(a + '/>')

    def line(self, x1, y1, x2, y2, stroke, sw=1, id=None, dash=None, cap=None):
        a = '<line%s x1="%s" y1="%s" x2="%s" y2="%s" stroke="%s" stroke-width="%s"' % (
            self._id(id), f(x1), f(y1), f(x2), f(y2), stroke, f(sw))
        if dash:
            a += ' stroke-dasharray="%s"' % dash
        if cap:
            a += ' stroke-linecap="%s"' % cap
        self.out.append(a + '/>')

    def path(self, d, fill=None, stroke=None, sw=1, id=None, cap='round', join='round', dash=None, op=None):
        a = '<path%s d="%s" fill="%s"' % (self._id(id), d, fill or 'none')
        if op is not None:
            a += ' fill-opacity="%s"' % op
        if stroke:
            a += ' stroke="%s" stroke-width="%s" stroke-linecap="%s" stroke-linejoin="%s"' % (stroke, f(sw), cap, join)
            if dash:
                a += ' stroke-dasharray="%s"' % dash
        self.out.append(a + '/>')

    def text(self, x, y, s, size=14, weight=400, fill=None, anchor=None, id=None, lh=None, maxw=None):
        """Single line (str) or pre-broken lines (list). maxw: raise at generation time if a line is wider."""
        fill = fill or C['ink']
        lines = list(s) if isinstance(s, (list, tuple)) else [s]
        widest = max(tw(ln, size, weight) for ln in lines)
        if maxw is not None and widest > maxw + 0.5:
            raise Overflow('%s: "%s" is %.0f wide, limit %.0f' % (self.name, max(lines, key=len)[:50], widest, maxw))
        x0 = x - widest if anchor == 'end' else (x - widest / 2 if anchor == 'middle' else x)
        if x0 < -0.5 or x0 + widest > self.w + 0.5:
            raise Overflow('%s: "%s" leaves the frame (x %.0f..%.0f of %d)' % (self.name, lines[0][:50], x0, x0 + widest, self.w))
        a = '<text%s x="%s" y="%s" font-family="%s" font-size="%s" font-weight="%s" fill="%s"' % (
            self._id(id), f(x), f(y), FONT, f(size), weight, fill)
        if anchor:
            a += ' text-anchor="%s"' % anchor
        a += '>'
        if len(lines) > 1:
            lh = lh or round(size * 1.45)
            a += ''.join('<tspan x="%s" dy="%s">%s</tspan>' % (f(x), 0 if i == 0 else lh, escape(ln))
                         for i, ln in enumerate(lines))
        else:
            a += escape(lines[0])
        self.out.append(a + '</text>')
        return widest

    def para(self, x, y, s, size, weight, fill, maxw, lh=None, anchor=None, id=None):
        """Wrap a paragraph to maxw and draw it; returns the y of the baseline after the last line."""
        lines = wrap(s, size, weight, maxw)
        lh = lh or round(size * 1.45)
        self.text(x, y, lines, size, weight, fill, anchor=anchor, id=id, lh=lh, maxw=maxw)
        return y + lh * len(lines)

    def g(self, id):
        self.out.append('<g%s>' % self._id(id))

    def end(self):
        self.out.append('</g>')

    def hotspot(self, target, x, y, w, h):
        n = self.hot.get(target, 0) + 1
        self.hot[target] = n
        hid = 'hotspot__%s' % target if n == 1 else 'hotspot__%s__%d' % (target, n)
        self.out.append('<rect id="%s" x="%s" y="%s" width="%s" height="%s" fill="#000000" fill-opacity="0"/>' % (
            hid, f(x), f(y), f(w), f(h)))

    def svg(self):
        head = '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">\n<title>%s</title>\n' % (
            self.w, self.h, self.w, self.h, self.name)
        return head + '\n'.join(self.out) + '\n</svg>\n'

    def save(self, folder):
        os.makedirs(folder, exist_ok=True)
        p = os.path.join(folder, self.name + '.svg')
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(self.svg())
        return p


# ------------------------------------------------------------------ components
CHIP = {
    'mint': (C['mintbg'], C['minttext'], None), 'amber': (C['amberbg'], C['ambertext'], None),
    'red': (C['redbg'], C['red'], None), 'violet': (C['violetbg'], C['violettext'], None),
    'grey': (C['grey'], C['muted'], None), 'outline': (C['card'], C['ink'], C['line']),
    'ink': (C['ink'], C['onink'], None), 'net': (C['card'], C['ink'], C['ink']),
    'darkline': (C['ink2'], C['oninkmuted'], C['ink4']), 'darkmint': ('#0E3B32', '#5EE6B8', None),
    'darkamber': ('#40300F', '#FFD27A', None), 'darkred': ('#43191A', '#FF9C94', None),
}


def chip(d, x, y, text, kind='grey', h=26, size=12, weight=600, id=None, anchor='start', pad=12, dot=None):
    fill, ink, stroke = CHIP[kind]
    iw = 14 if dot else 0
    w = tw(text, size, weight) + 2 * pad + iw
    x0 = x - w if anchor == 'end' else (x - w / 2 if anchor == 'middle' else x)
    d.g(id or 'chip')
    d.rect(x0, y, w, h, fill=fill, rx=h / 2, stroke=stroke)
    if dot:
        d.circle(x0 + pad + 4, y + h / 2, 4, fill=dot)
    d.text(x0 + pad + iw, y + h / 2 + size * 0.36, text, size, weight, ink)
    d.end()
    return w


def testnet(d, x, y, anchor='end', dark=False):
    """The marker every frame must carry."""
    return chip(d, x, y, 'NEAR testnet', 'darkline' if dark else 'net', h=24, size=11, weight=700, id='testnet-marker',
                anchor=anchor, pad=10, dot=C['amber'])


def button(d, x, y, w, h, label, kind='primary', id=None, size=15, target=None, anchor='start'):
    if w is None:
        w = tw(label, size, 600) + 48
    x0 = x - w if anchor == 'end' else x
    d.g(id or 'button')
    r = h / 2
    col = C['ink']
    if kind == 'primary':
        d.rect(x0, y, w, h, fill=C['mint'], rx=r)
    elif kind == 'dark':
        d.rect(x0, y, w, h, fill=C['ink'], rx=r)
        col = C['onink']
    elif kind == 'outline':
        d.rect(x0, y, w, h, fill=C['card'], rx=r, stroke=C['line'], sw=1.5)
    elif kind == 'danger':
        d.rect(x0, y, w, h, fill=C['card'], rx=r, stroke=C['red'], sw=1.5)
        col = C['red']
    elif kind == 'violet':
        d.rect(x0, y, w, h, fill=C['violet'], rx=r)
        col = C['onink']
    elif kind == 'darkoutline':
        d.rect(x0, y, w, h, fill=C['ink2'], rx=r, stroke=C['ink4'], sw=1.5)
        col = C['onink']
    elif kind == 'disabled':
        d.rect(x0, y, w, h, fill=C['grey'], rx=r)
        col = C['muted']
    if kind == 'text':
        d.text(x0, y + h / 2 + size * 0.36, label, size, 600, C['minttext'])
    else:
        d.text(x0 + w / 2, y + h / 2 + size * 0.36, label, size, 600, col, anchor='middle', maxw=w - 16)
    d.end()
    if target:
        d.hotspot(target, x0, y, w, h)
    return w


def link(d, x, y, label, target=None, size=13, anchor='start', color=None):
    """Text link with an arrow; y is the baseline."""
    s = label + ' →'
    w = d.text(x, y, s, size, 600, color or C['minttext'], anchor=anchor)
    x0 = x - w if anchor == 'end' else x
    if target:
        d.hotspot(target, x0 - 4, y - size - 4, w + 8, size + 12)
    return w


def card(d, x, y, w, h, id='card', r=12, fill=None, stroke=None, dash=None):
    d.rect(x, y, w, h, fill=fill or C['card'], rx=r, stroke=stroke or C['line'], id=id, dash=dash)


def footer(d, dark=False, x=None, anchor='end'):
    d.text(x if x is not None else d.w - 24, d.h - 12, 'FigCraft concept · sample data · NEAR testnet', 11, 400,
           C['oninkmuted'] if dark else C['muted'], anchor=anchor, id='footer')


def mark(d, x, y, s=32, dark=False):
    """BitPOS mark: our own rounded square with a B. No third-party logos anywhere."""
    d.g('bitpos-mark')
    d.rect(x, y, s, s, fill=C['mint'] if dark else C['ink'], rx=s * 0.28)
    d.text(x + s / 2, y + s * 0.72, 'B', s * 0.62, 700, C['ink'] if dark else C['onink'], anchor='middle')
    d.end()


# ------------------------------------------------------------------ icons (stroke, drawn as paths)
def ic_check(d, cx, cy, r, col, bg=None):
    if bg:
        d.circle(cx, cy, r, fill=bg)
    s = r * 0.5
    d.path('M%s %s L%s %s L%s %s' % (f(cx - s), f(cy), f(cx - s * 0.25), f(cy + s * 0.7), f(cx + s), f(cy - s * 0.6)),
           stroke=col, sw=max(2, r * 0.18))


def ic_cross(d, cx, cy, r, col, bg=None):
    if bg:
        d.circle(cx, cy, r, fill=bg)
    s = r * 0.4
    d.path('M%s %s L%s %s M%s %s L%s %s' % (f(cx - s), f(cy - s), f(cx + s), f(cy + s), f(cx + s), f(cy - s),
                                           f(cx - s), f(cy + s)), stroke=col, sw=max(2, r * 0.16))


def ic_spinner(d, cx, cy, r, col, track, bg=None):
    if bg:
        d.circle(cx, cy, r, fill=bg)
    rr = r * 0.55
    d.circle(cx, cy, rr, stroke=track, sw=max(2, r * 0.16))
    d.path('M%s %s A%s %s 0 0 1 %s %s' % (f(cx), f(cy - rr), f(rr), f(rr), f(cx + rr), f(cy)), stroke=col,
           sw=max(2, r * 0.16))


def ic_return(d, cx, cy, r, col, bg=None):
    """U-turn arrow: money coming back."""
    if bg:
        d.circle(cx, cy, r, fill=bg)
    s = r * 0.45
    d.path('M%s %s H%s A%s %s 0 0 0 %s %s H%s' % (f(cx - s), f(cy + s * 0.9), f(cx + s * 0.4), f(s * 0.7), f(s * 0.7),
                                                   f(cx + s * 0.4), f(cy - s * 0.5), f(cx - s)), stroke=col,
           sw=max(2, r * 0.16))
    d.path('M%s %s L%s %s L%s %s' % (f(cx - s * 0.45), f(cy - s * 1.1), f(cx - s * 1.05), f(cy - s * 0.5),
                                      f(cx - s * 0.45), f(cy + s * 0.1)), stroke=col, sw=max(2, r * 0.16))


def ic_shield(d, cx, cy, r, col, sw=1.8):
    d.path('M%s %s L%s %s V%s Q%s %s %s %s Q%s %s %s %s V%s Z' % (
        f(cx), f(cy - r), f(cx + r * 0.8), f(cy - r * 0.6), f(cy), f(cx + r * 0.8), f(cy + r * 0.7), f(cx), f(cy + r),
        f(cx - r * 0.8), f(cy + r * 0.7), f(cx - r * 0.8), f(cy), f(cy - r * 0.6)), stroke=col, sw=sw)
    d.path('M%s %s L%s %s L%s %s' % (f(cx - r * 0.32), f(cy), f(cx - r * 0.05), f(cy + r * 0.28), f(cx + r * 0.36),
                                      f(cy - r * 0.22)), stroke=col, sw=sw)


def ic_key(d, cx, cy, r, col, sw=1.8):
    d.circle(cx - r * 0.45, cy, r * 0.42, stroke=col, sw=sw)
    d.path('M%s %s H%s V%s M%s %s V%s' % (f(cx - r * 0.03), f(cy), f(cx + r * 0.9), f(cy + r * 0.38),
                                         f(cx + r * 0.45), f(cy), f(cy + r * 0.3)), stroke=col, sw=sw)


def ic_screen(d, cx, cy, r, col, sw=1.8):
    d.rect(cx - r, cy - r * 0.7, 2 * r, r * 1.3, rx=3, stroke=col, sw=sw)
    d.line(cx - r * 0.4, cy + r * 0.95, cx + r * 0.4, cy + r * 0.95, col, sw, cap='round')


def ic_spark(d, cx, cy, r, col):
    s = r
    d.path('M%s %s Q%s %s %s %s Q%s %s %s %s Q%s %s %s %s Q%s %s %s %s Z' % (
        f(cx), f(cy - s), f(cx + s * 0.15), f(cy - s * 0.15), f(cx + s), f(cy),
        f(cx + s * 0.15), f(cy + s * 0.15), f(cx), f(cy + s),
        f(cx - s * 0.15), f(cy + s * 0.15), f(cx - s), f(cy),
        f(cx - s * 0.15), f(cy - s * 0.15), f(cx), f(cy - s)), fill=col)


def ic_clock(d, cx, cy, r, col, sw=1.8):
    d.circle(cx, cy, r * 0.8, stroke=col, sw=sw)
    d.path('M%s %s V%s H%s' % (f(cx), f(cy - r * 0.45), f(cy), f(cx + r * 0.35)), stroke=col, sw=sw)


def ic_bolt(d, cx, cy, r, col):
    d.path('M%s %s L%s %s H%s L%s %s L%s %s H%s Z' % (
        f(cx + r * 0.15), f(cy - r), f(cx - r * 0.6), f(cy + r * 0.15), f(cx - r * 0.05), f(cx - r * 0.2), f(cy + r),
        f(cx + r * 0.6), f(cy - r * 0.2), f(cx + r * 0.05)), fill=col)


def ic_cup(d, cx, cy, r, col, sw=1.8):
    d.path('M%s %s H%s L%s %s H%s Z' % (f(cx - r * 0.7), f(cy - r * 0.5), f(cx + r * 0.5), f(cx + r * 0.3), f(cy + r * 0.8),
                                        f(cx - r * 0.5)), stroke=col, sw=sw)
    d.path('M%s %s Q%s %s %s %s' % (f(cx + r * 0.48), f(cy - r * 0.25), f(cx + r * 1.05), f(cy - r * 0.1), f(cx + r * 0.38),
                                    f(cy + r * 0.4)), stroke=col, sw=sw)


def qr(d, x, y, s, seed=7, id='qr-fixture', dark=None, light='#FFFFFF', pad=0):
    """Non-scannable fixture QR: finder squares + pseudo-random modules in one path."""
    dark = dark or C['ink']
    d.g(id)
    d.rect(x - pad, y - pad, s + 2 * pad, s + 2 * pad, fill=light, rx=pad * 0.8 if pad else 0)
    n = 25
    m = s / n
    rnd = random.Random(seed)
    parts = []
    for i in range(n):
        for j in range(n):
            if (i < 8 and j < 8) or (i < 8 and j >= n - 8) or (i >= n - 8 and j < 8):
                continue
            if rnd.random() < 0.45:
                parts.append('M%s %sh%sv%sh-%sz' % (f(x + j * m), f(y + i * m), f(m), f(m), f(m)))
    d.path(''.join(parts), fill=dark, cap='butt', join='miter')
    for (fx, fy) in ((0, 0), (n - 7, 0), (0, n - 7)):
        X, Y = x + fx * m, y + fy * m
        d.rect(X, Y, 7 * m, 7 * m, fill=dark)
        d.rect(X + m, Y + m, 5 * m, 5 * m, fill=light)
        d.rect(X + 2 * m, Y + 2 * m, 3 * m, 3 * m, fill=dark)
    d.end()


def arrow(d, pts, col, sw=2, dash=None, head=8, id=None):
    dd = 'M%s %s' % (f(pts[0][0]), f(pts[0][1])) + ''.join(' L%s %s' % (f(px), f(py)) for px, py in pts[1:])
    d.path(dd, stroke=col, sw=sw, dash=dash, id=id)
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    a = math.atan2(y2 - y1, x2 - x1)
    p1 = (x2 - head * math.cos(a - 0.45), y2 - head * math.sin(a - 0.45))
    p2 = (x2 - head * math.cos(a + 0.45), y2 - head * math.sin(a + 0.45))
    d.path('M%s %s L%s %s L%s %s Z' % (f(x2), f(y2), f(p1[0]), f(p1[1]), f(p2[0]), f(p2[1])), fill=col, cap='butt',
           join='miter')


def split_bar(d, x, y, w, h, dark=False, id='split-bar', gap=3):
    """The signature element: one bill, four destinations, widths proportional to the integer split."""
    d.g(id)
    cols = SPLIT_COLOR_DARK if dark else SPLIT_COLOR
    inner = w - gap * (len(SPLIT) - 1)
    cx = x
    out = []
    for i, (k, v) in enumerate(SPLIT):
        sw_ = inner * v / BILL_TOTAL
        d.rect(cx, y, sw_, h, fill=cols[k], rx=6 if h >= 14 else 3)
        out.append((k, cx, sw_))
        cx += sw_ + gap
    d.end()
    return out


def table(d, x, y, cols, header, rows, size=13, pad=14, head_h=36, row_h=48, id='table', dark=False):
    """cols: widths. cell: str | dict(t=, w=, col=, chip=, anchor='end')."""
    d.g(id)
    W = sum(cols)
    d.rect(x, y, W, head_h, fill=C['grey'], rx=8)
    cx = x
    for i, h_ in enumerate(header):
        end = isinstance(h_, dict)
        t = h_['t'] if end else h_
        if end:
            d.text(cx + cols[i] - pad, y + head_h / 2 + 4, t, 12, 600, C['muted'], anchor='end')
        else:
            d.text(cx + pad, y + head_h / 2 + 4, t, 12, 600, C['muted'])
        cx += cols[i]
    yy = y + head_h
    for row in rows:
        cx = x
        for i, cell in enumerate(row):
            if isinstance(cell, str):
                cell = dict(t=cell)
            if cell.get('chip'):
                chip(d, cx + pad, yy + (row_h - 24) / 2, cell['t'], cell['chip'], h=24, size=11, pad=9)
            elif cell.get('anchor') == 'end':
                d.text(cx + cols[i] - pad, yy + row_h / 2 + size * 0.36, cell['t'], size, cell.get('w', 400),
                       cell.get('col', C['ink']), anchor='end', maxw=cols[i] - 2 * pad)
            else:
                d.text(cx + pad, yy + row_h / 2 + size * 0.36, cell['t'], size, cell.get('w', 400),
                       cell.get('col', C['ink']), maxw=cols[i] - pad - 4)
            cx += cols[i]
        yy += row_h
        d.line(x, yy, x + W, yy, C['line'], 1)
    d.end()
    return yy


# ------------------------------------------------------------------ shells
NAV = [('NM-01', 'Overview'), ('NM-02', 'Split recipe'), ('NM-03', 'Team & shifts'), ('NM-04', 'Suppliers'),
       ('NM-06', 'Ledger'), ('NM-08', 'Devices & witness'), ('NM-09', 'Café CFO'), ('NM-11', 'Setup')]
NAV_GROUP = {'NM-05': 'NM-04', 'NM-07': 'NM-06', 'NM-10': 'NM-09'}
SIDE = 248
CX = SIDE + 32          # content left
CW = 1440 - CX - 32     # content width (1128)


def pos_shell(name, title, subtitle=None):
    """Merchant desktop 1440x1000: ink sidebar, paper canvas, top bar with shop account and the testnet marker."""
    d = Doc(name, 1440, 1000, C['paper'])
    d.g('sidebar')
    d.rect(0, 0, SIDE, 1000, fill=C['ink'])
    mark(d, 24, 24, 36, dark=True)
    d.text(72, 40, 'BitPOS', 16, 700, C['onink'])
    d.text(72, 58, 'Living Bill', 12, 400, C['oninkmuted'])
    d.text(24, 112, 'ORBIT CAFÉ', 11, 700, C['oninkmuted'])
    active = NAV_GROUP.get(name, name)
    y = 128
    for fid, label in NAV:
        on = fid == active
        if on:
            d.rect(12, y, SIDE - 24, 40, fill=C['ink3'], rx=10)
            d.rect(12, y + 10, 4, 20, fill=C['mint'], rx=2)
        if fid == 'NM-09':
            ic_spark(d, 36, y + 20, 7, C['violet'] if not on else '#B7A8FF')
        else:
            d.circle(36, y + 20, 3.5, fill=C['mint'] if on else C['ink4'])
        d.text(54, y + 25, label, 14, 600 if on else 400, C['onink'] if on else C['oninkmuted'])
        y += 44
    d.rect(16, 880, SIDE - 32, 96, fill=C['ink2'], rx=12, stroke=C['ink3'])
    d.text(32, 906, 'Signed in as Owner', 12, 600, C['onink'])
    d.text(32, 926, 'Keys the server holds can', 11, 400, C['oninkmuted'])
    d.text(32, 942, 'open or void a bill — never', 11, 400, C['oninkmuted'])
    d.text(32, 958, 'move the shop\'s money.', 11, 400, C['oninkmuted'])
    d.end()
    y = 128
    for fid, label in NAV:
        if fid != name:
            d.hotspot(fid, 12, y, SIDE - 24, 40)
        y += 44
    d.g('topbar')
    d.text(CX, 58, title, 28, 700, C['ink'], id='page-title')
    if subtitle:
        d.text(CX, 84, subtitle, 14, 400, C['muted'], id='page-subtitle', maxw=CW - 380)
    wn = testnet(d, 1440 - 32, 30)
    chip(d, 1440 - 32 - wn - 8, 30, ACCT['shop'], 'grey', h=24, size=11, weight=600, anchor='end', pad=10, id='account-chip')
    d.end()
    footer(d)
    return d


def phone(name, title=None, back=None, dark=False, sub='Orbit Café · Table 4', lang='en'):
    """Customer / staff phone 390x844."""
    d = Doc(name, 390, 844, C['ink'] if dark else C['paper'])
    fg = C['onink'] if dark else C['ink']
    d.g('status-bar')
    d.text(24, 30, '9:41', 14, 600, fg)
    d.rect(340, 19, 24, 12, rx=3, stroke=fg, sw=1.2)
    d.rect(342, 21, 16, 8, rx=1.5, fill=fg)
    d.end()
    d.g('header')
    if back:
        d.path('M30 70 L22 78 L30 86', stroke=fg, sw=2.2, id='back-chevron')
        mark(d, 44, 62, 32, dark=dark)
        d.text(86, 76, sub, 13, 600, fg)
        d.text(86, 92, 'BitPOS Living Bill', 11, 400, C['oninkmuted'] if dark else C['muted'])
    else:
        mark(d, 16, 62, 32, dark=dark)
        d.text(58, 76, sub, 13, 600, fg)
        d.text(58, 92, 'BitPOS Living Bill', 11, 400, C['oninkmuted'] if dark else C['muted'])
    testnet(d, 374, 66, dark=dark)
    d.end()
    if back:
        d.hotspot(back, 12, 58, 28, 40)
    if title:
        d.text(16, 140, title, 22, 700, fg, id='screen-title', maxw=358)
    footer(d, dark=dark, x=195, anchor='middle')
    return d


def mini(name, table_label='Table 4', right=None):
    """BitPOS Mini 480x320: dark ink, large type, high contrast."""
    d = Doc(name, 480, 320, C['ink'])
    d.g('mini-top')
    mark(d, 14, 10, 22, dark=True)
    d.text(44, 26, 'BitPOS Mini · ' + table_label, 13, 600, C['onink'])
    testnet(d, 466, 9, dark=True)
    d.end()
    d.line(0, 42, 480, 42, C['ink3'], 1, id='mini-rule')
    d.text(466, 311, 'FigCraft concept · sample data', 9, 400, '#6F7B92', anchor='end', id='footer')
    return d
