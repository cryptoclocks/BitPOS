# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
"""N00-flow-map (1600x1000): every screen of the NEAR edition, one click away."""
from lib import C, Doc, mark, testnet, chip, arrow, footer, split_bar

NODE_H = 64


def node(d, x, y, w, fid, label, kind='light'):
    fill, ink, sub, stroke = {
        'light': (C['card'], C['ink'], C['muted'], C['line']),
        'dark': (C['ink'], C['onink'], C['oninkmuted'], C['ink']),
        'amber': (C['amberbg'], C['ink'], C['ambertext'], C['amber']),
        'red': (C['redbg'], C['ink'], C['red'], C['red']),
        'mint': (C['mintbg'], C['ink'], C['minttext'], C['mint']),
        'violet': (C['violetbg'], C['ink'], C['violettext'], C['violet']),
    }[kind]
    d.g('node-' + fid)
    d.rect(x, y, w, NODE_H, fill=fill, rx=12, stroke=stroke, sw=1.5)
    d.text(x + 14, y + 26, fid, 13, 700, ink)
    d.text(x + 14, y + 46, label, 12, 400, sub, maxw=w - 24)
    d.end()
    d.hotspot(fid, x, y, w, NODE_H)


def lane(d, y, h, title, sub):
    d.rect(24, y, 1552, h, fill=C['card'], rx=16, stroke=C['line'], id='lane')
    d.text(48, y + 34, title, 15, 700)
    for i, ln in enumerate(sub):
        d.text(48, y + 56 + i * 17, ln, 12, 400, C['muted'], maxw=150)


def n00():
    d = Doc('N00-flow-map', 1600, 1000, C['paper'])
    mark(d, 24, 22, 40)
    d.text(78, 42, 'BitPOS Living Bill · NEAR edition', 22, 700)
    d.text(78, 62, 'One coffee payment. Everyone is paid in the same second, once the table screen bears witness.', 13, 400,
           C['muted'])
    testnet(d, 1576, 30)
    chip(d, 1446, 30, 'Click any box to open its screen', 'grey', h=24, size=11, anchor='end', id='hint-chip')

    X0 = 216

    # customer lane
    lane(d, 88, 196, 'Customer phone', ['Order, see where the', 'money goes, pay without', 'holding NEAR.'])
    w, gap = 190, 32
    xs = [X0 + i * (w + gap) for i in range(6)]
    main = [('NC-01', 'Table menu', 'light'), ('NC-02', 'Bill + where money goes', 'light'), ('NC-03', 'Choose how to pay', 'light'),
            ('NC-04', 'Wallet approve (concept)', 'light'), ('NC-05', 'Waiting for the witness', 'amber'),
            ('NC-06', 'Paid + split receipt', 'mint')]
    for (fid, lb, k), x in zip(main, xs):
        node(d, x, 108, w, fid, lb, k)
    for i in range(5):
        arrow(d, [(xs[i] + w + 4, 140), (xs[i + 1] - 4, 140)], C['ink'], sw=1.8, head=7)
    node(d, xs[2], 200, w, 'NC-08', 'Another chain (preview)', 'light')
    arrow(d, [(xs[2] + w / 2, 172 + 2), (xs[2] + w / 2, 200 - 4)], C['muted'], sw=1.6, head=6, dash='4 4')
    node(d, xs[4], 200, w, 'NC-07', 'Money bounced back', 'red')
    arrow(d, [(xs[4] + w / 2, 172 + 2), (xs[4] + w / 2, 200 - 4)], C['red'], sw=1.6, head=6, dash='4 4')
    arrow(d, [(xs[3] + w / 2, 172 + 2), (xs[3] + w / 2, 232), (xs[4] - 4, 232)], C['red'], sw=1.6, head=6, dash='4 4')

    # mini lane
    lane(d, 300, 112, 'BitPOS Mini', ['Reads the chain itself', 'and signs as witness.'])
    w2, gap2 = 164, 26
    xm = [X0 + i * (w2 + gap2) for i in range(7)]
    minis = [('ND-01', 'Idle', 'dark'), ('ND-02', 'Pay QR', 'dark'), ('ND-03', 'Checking the chain', 'dark'),
             ('ND-04', 'Paid + split', 'dark'), ('ND-05', 'Refunded', 'dark'), ('ND-06', 'Offline', 'dark'), ('ND-07', 'Setup · device key', 'dark')]
    for (fid, lb, k), x in zip(minis, xm):
        node(d, x, 324, w2, fid, lb, k)
    for i in range(3):
        arrow(d, [(xm[i] + w2 + 3, 356), (xm[i + 1] - 3, 356)], C['ink'], sw=1.8, head=6)

    # merchant lane
    lane(d, 428, 204, 'Merchant POS', ['Set the recipe once.', 'Watch every bill split,', 'with proof.'])
    xr = [X0 + i * (w + gap) for i in range(6)]
    row1 = [('NM-01', 'Overview', 'light'), ('NM-02', 'Split recipe', 'light'), ('NM-03', 'Team & shifts', 'light'),
            ('NM-04', 'Suppliers & invoices', 'light'), ('NM-05', 'Invoice detail', 'light'), ('NM-06', 'Ledger + CSV', 'light')]
    row2 = [('NM-07', 'Evidence timeline', 'light'), ('NM-08', 'Devices & witness', 'light'), ('NM-09', 'Café CFO', 'violet'),
            ('NM-10', 'Review CFO proposal', 'violet'), ('NM-11', 'Setup · least-power keys', 'light')]
    for (fid, lb, k), x in zip(row1, xr):
        node(d, x, 448, w, fid, lb, k)
    for (fid, lb, k), x in zip(row2, xr):
        node(d, x, 544, w, fid, lb, k)
    arrow(d, [(xr[3] + w + 4, 480), (xr[4] - 4, 480)], C['ink'], sw=1.8, head=7)
    arrow(d, [(xr[2] + w + 4, 576), (xr[3] - 4, 576)], C['violet'], sw=1.8, head=7)

    # staff lane
    lane(d, 648, 112, 'Staff phone', ['Paid per cup, into', 'their own account.'])
    node(d, X0, 672, w, 'NS-01', 'My earnings', 'light')
    node(d, X0 + w + gap, 672, w, 'NS-02', 'Send home (preview)', 'light')
    arrow(d, [(X0 + w + 4, 704), (X0 + w + gap - 4, 704)], C['ink'], sw=1.8, head=7)
    d.text(X0 + 2 * (w + gap) + 8, 698, 'Each bill pays whoever is clocked in, in the same receipt as the owner.', 13, 400,
           C['muted'])
    d.text(X0 + 2 * (w + gap) + 8, 718, 'Opened from Team & shifts (NM-03).', 12, 400, C['muted'])

    # the five words of the track
    d.rect(24, 776, 1552, 184, fill=C['ink'], rx=16, id='track-band')
    d.text(48, 812, 'One bill covers the five words of the Real-World Money track', 16, 700, C['onink'])
    split_bar(d, 48, 828, 1504, 8, dark=True)
    words = [('Merchant payments', 'Exact-amount bill in a contract.', 'Wrong amount bounces back.'),
             ('Payroll', 'Whoever is on shift is paid', 'from the next bill, at once.'),
             ('Invoicing', 'Supplier invoices fund', 'themselves from every bill.'),
             ('Remittances', 'Staff preview sending their', 'share home across chains.'),
             ('Stablecoin rails', 'Gasless token payments with', 'a hardware witness.')]
    cw = 1504 / 5
    for i, (t, a, b) in enumerate(words):
        x = 48 + i * cw
        d.text(x, 874, t, 15, 700, C['mint'])
        d.text(x, 898, a, 12, 400, C['oninkmuted'], maxw=cw - 16)
        d.text(x, 916, b, 12, 400, C['oninkmuted'], maxw=cw - 16)
    d.text(48, 946, 'Thai variants of NC-02, NC-05, NC-06, NC-07, ND-02 and ND-04 open from the language switch on each of those screens.',
           11, 400, '#8A96AD')
    footer(d)
    return d


ALL = [n00]
