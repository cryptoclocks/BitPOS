# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
"""Merchant desktop screens NM-01 .. NM-11 (1440x1000)."""
from lib import (C, ACCT, BILL_ID, SPLIT, SPLIT_COLOR, CX, CW, money, tw, pos_shell, card, chip, button, link, table,
                 split_bar, ic_check, ic_shield, ic_key, ic_screen, ic_spark, ic_clock, ic_bolt, ic_cup, ic_spinner,
                 ic_return, mark)

TX = '9xQe…SAMPLE'


def proof_chip(d, x, y, anchor='start'):
    return chip(d, x, y, 'Private inference · signature verified', 'violet', h=26, size=12, id='proof-chip',
                anchor=anchor, dot=C['violet'])


def stat(d, x, y, w, label, value, unit, note, accent=None):
    card(d, x, y, w, 132, id='stat-card')
    if accent:
        d.rect(x + 20, y + 22, 8, 8, fill=accent, rx=2)
        d.text(x + 36, y + 31, label, 13, 600, C['muted'])
    else:
        d.text(x + 20, y + 31, label, 13, 600, C['muted'])
    vw = d.text(x + 20, y + 78, value, 34, 700, C['ink'])
    d.text(x + 28 + vw, y + 78, unit, 14, 600, C['muted'])
    d.text(x + 20, y + 108, note, 13, 400, C['muted'], maxw=w - 40)


def legend_rows(d, x, y, w, rows, gap=44, size=14):
    """rows: (key, title, account, amount)."""
    for i, (k, title, acct, amt) in enumerate(rows):
        yy = y + i * gap
        d.rect(x, yy - 11, 12, 12, fill=SPLIT_COLOR[k], rx=3)
        d.text(x + 24, yy, title, size, 600, C['ink'])
        d.text(x + 24, yy + 18, acct, 12, 400, C['muted'], maxw=w - 130)
        d.text(x + w, yy, amt, size + 1, 700, C['ink'], anchor='end')


# ------------------------------------------------------------------ NM-01
def nm01():
    d = pos_shell('NM-01', 'Overview', 'One coffee payment. Everyone is paid in the same second.')
    w4 = (CW - 3 * 16) / 4
    stat(d, CX, 112, w4, 'Sales today', '180.00', 'tUSD', '36 bills · all witnessed')
    stat(d, CX + (w4 + 16), 112, w4, 'Paid to the team', '18.00', 'tUSD', 'Mai and Ton, on shift now', C['mint'])
    stat(d, CX + 2 * (w4 + 16), 112, w4, 'Tax reserve', '12.60', 'tUSD', 'Set aside bill by bill', C['amber'])
    stat(d, CX + 3 * (w4 + 16), 112, w4, 'Supplier invoices', '21.60', 'tUSD', 'Milk invoice 68% funded', C['muted'])

    # money flow card
    fw = 724
    card(d, CX, 260, fw, 388, id='flow-card')
    d.text(CX + 24, 296, 'Where today\'s money went', 18, 700)
    d.text(CX + 24, 320, 'Each bill splits itself in one receipt on NEAR. Nothing waits for a payout run.', 13, 400,
           C['muted'])
    segs = split_bar(d, CX + 24, 344, fw - 48, 28)
    pct = {'owner': '71%', 'tips': '10%', 'tax': '7%', 'supplier': '12%'}
    for k, sx, sw_ in segs:
        col = C['onink'] if k in ('owner', 'supplier') else C['ink']
        d.text(sx + 10, 363, pct[k], 12, 700, col)
    legend_rows(d, CX + 24, 414, fw - 48, [
        ('owner', 'Orbit Café (owner)', ACCT['shop'], '127.80'),
        ('tips', 'Team tips · Mai and Ton', 'mai.orbit… and ton.orbit…', '18.00'),
        ('tax', 'Tax reserve', ACCT['tax'], '12.60'),
        ('supplier', 'Milk Farm Co-op invoice', ACCT['milk'], '21.60'),
    ])
    d.line(CX + 24, 590, CX + fw - 24, 590, C['line'])
    d.text(CX + 24, 622, 'Last bill', 13, 600, C['muted'])
    d.text(CX + 92, 622, '%s · 5.00 tUSD · Table 4' % BILL_ID, 14, 600)
    chip(d, CX + 318, 604, 'Settled', 'mint', id='state-chip')
    link(d, CX + fw - 24, 622, 'Open evidence', 'NM-07', anchor='end')

    # accounts card
    ax = CX + fw + 16
    aw = CW - fw - 16
    card(d, ax, 260, aw, 388, id='accounts-card')
    d.text(ax + 24, 296, 'Accounts on NEAR', 18, 700)
    rows = [('Bills contract', ACCT['bills'], 'Holds each bill until it settles'),
            ('Shop', ACCT['shop'], 'Receives the owner share'),
            ('Token', ACCT['token'], 'tUSD · 6 decimals · test money'),
            ('Fee relayer', ACCT['relayer'], '4.82 NEAR left for network fees')]
    y = 334
    for t, a, n in rows:
        d.text(ax + 24, y, t, 12, 600, C['muted'])
        d.text(ax + 24, y + 20, a, 14, 600, C['ink'], maxw=aw - 48)
        d.text(ax + 24, y + 38, n, 12, 400, C['muted'], maxw=aw - 48)
        y += 66
    d.line(ax + 24, 590, ax + aw - 24, 590, C['line'])
    d.text(ax + 24, 622, 'Keys with the least power', 13, 600)
    link(d, ax + aw - 24, 622, 'Setup', 'NM-11', anchor='end')

    # row 3
    w3 = (CW - 2 * 16) / 3
    y3 = 664
    card(d, CX, y3, w3, 276, id='invoice-card')
    d.text(CX + 24, y3 + 36, 'An invoice that collects itself', 16, 700)
    d.text(CX + 24, y3 + 64, 'Milk Farm Co-op · INV-0042', 14, 600)
    d.text(CX + 24, y3 + 84, 'Due 20 Nov · 12% of every bill', 13, 400, C['muted'])
    d.rect(CX + 24, y3 + 108, w3 - 48, 12, fill=C['grey'], rx=6)
    d.rect(CX + 24, y3 + 108, (w3 - 48) * 0.68, 12, fill=C['muted'], rx=6)
    d.text(CX + 24, y3 + 148, '81.60', 26, 700)
    d.text(CX + 104, y3 + 148, 'of 120.00 tUSD funded', 13, 400, C['muted'])
    d.text(CX + 24, y3 + 180, '38.40 to go. At today\'s pace it is funded', 13, 400, C['muted'])
    d.text(CX + 24, y3 + 198, 'before the due date.', 13, 400, C['muted'])
    link(d, CX + 24, y3 + 244, 'Open invoice', 'NM-05')

    x2 = CX + w3 + 16
    card(d, x2, y3, w3, 276, id='witness-card')
    d.text(x2 + 24, y3 + 36, 'The table screen is the witness', 16, 700)
    d.circle(x2 + 44, y3 + 86, 20, fill=C['mintbg'])
    ic_screen(d, x2 + 44, y3 + 85, 9, C['minttext'])
    d.text(x2 + 76, y3 + 82, 'Mini-01 · Table 4', 14, 600)
    d.text(x2 + 76, y3 + 100, 'Online · firmware 0.5.0-near', 12, 400, C['muted'])
    d.text(x2 + 24, y3 + 148, '36 / 36', 26, 700)
    d.text(x2 + 122, y3 + 148, 'bills witnessed today', 13, 400, C['muted'])
    d.text(x2 + 24, y3 + 180, 'Money is released only after the screen', 13, 400, C['muted'])
    d.text(x2 + 24, y3 + 198, 'signs that it showed PAID. No sign, refund.', 13, 400, C['muted'])
    link(d, x2 + 24, y3 + 244, 'Devices & witness', 'NM-08')

    x3 = CX + 2 * (w3 + 16)
    card(d, x3, y3, w3, 276, id='cfo-card', stroke=C['violet'])
    ic_spark(d, x3 + 34, y3 + 30, 9, C['violet'])
    d.text(x3 + 52, y3 + 36, 'Café CFO has a proposal', 16, 700)
    proof_chip(d, x3 + 24, y3 + 54)
    d.text(x3 + 24, y3 + 108, 'Fund the milk invoice sooner', 14, 600)
    d.text(x3 + 24, y3 + 132, 'Move one step of the owner share to the', 13, 400, C['muted'])
    d.text(x3 + 24, y3 + 150, 'supplier until the invoice is paid.', 13, 400, C['muted'])
    d.text(x3 + 24, y3 + 180, 'The model picks from a list. You approve.', 13, 400, C['muted'])
    button(d, x3 + 24, y3 + 212, None, 44, 'Review proposal', 'violet', target='NM-10', id='review-button')
    return d


# ------------------------------------------------------------------ NM-02
def slider(d, x, y, w, frac, col):
    d.rect(x, y, w, 8, fill=C['grey'], rx=4)
    d.rect(x, y, w * frac, 8, fill=col, rx=4)
    d.circle(x + w * frac, y + 4, 11, fill=C['card'], stroke=col, sw=3)


def nm02():
    d = pos_shell('NM-02', 'Split recipe', 'Decide once how every bill pays everyone. The contract enforces it per bill.')
    lw = 660
    card(d, CX, 112, lw, 828, id='recipe-card')
    d.text(CX + 24, 150, 'Shares of every bill', 18, 700)
    rows = [('tips', 'Team tips and wage share', 'Split between whoever is clocked in when the bill is paid.', '10%', 0.10 / 0.3),
            ('tax', 'Tax reserve', 'Sent to the shop\'s tax account so it is never spent by mistake.', '7%', 0.07 / 0.3),
            ('supplier', 'Supplier funding', 'Goes to the oldest open invoice. Stops when invoices are paid.', '12%', 0.12 / 0.3),
            ('owner', 'Owner', 'Whatever is left, plus any rounding. You cannot set this by hand.', '71%', None)]
    y = 186
    for k, t, n, pct, fr in rows:
        d.rect(CX + 24, y, lw - 48, 118, fill=C['paper'], rx=12)
        d.rect(CX + 44, y + 22, 12, 12, fill=SPLIT_COLOR[k], rx=3)
        d.text(CX + 68, y + 33, t, 15, 600)
        d.text(CX + lw - 44, y + 36, pct, 24, 700, C['ink'], anchor='end')
        d.text(CX + 68, y + 56, n, 13, 400, C['muted'], maxw=lw - 200)
        if fr is not None:
            slider(d, CX + 68, y + 82, lw - 220, fr, SPLIT_COLOR[k])
            d.text(CX + lw - 44, y + 90, '0–30%', 12, 400, C['muted'], anchor='end')
        else:
            chip(d, CX + 68, y + 72, 'Automatic remainder', 'grey', h=24, size=11)
        y += 134
    d.line(CX + 24, y + 6, CX + lw - 24, y + 6, C['line'])
    d.text(CX + 24, y + 44, 'Witness mode', 15, 600)
    d.text(CX + 24, y + 66, 'Hold the money in the bill until the table screen confirms.', 13, 400, C['muted'])
    d.text(CX + 24, y + 84, 'If it does not confirm in 2:00, the customer is refunded.', 13, 400, C['muted'])
    d.rect(CX + lw - 24 - 52, y + 36, 52, 30, fill=C['mint'], rx=15)
    d.circle(CX + lw - 24 - 15, y + 51, 11, fill=C['card'])
    button(d, CX + 24, 868, 180, 48, 'Save recipe', 'primary', target='NM-01', id='save-button')
    button(d, CX + 220, 868, 200, 48, 'Ask Café CFO', 'outline', target='NM-09', id='ask-cfo-button')

    px = CX + lw + 16
    pw = CW - lw - 16
    card(d, px, 112, pw, 828, id='preview-card')
    d.text(px + 24, 150, 'Preview', 12, 700, C['muted'])
    d.text(px + 24, 182, 'A 5.00 tUSD bill becomes', 18, 700)
    split_bar(d, px + 24, 206, pw - 48, 24)
    pay = [('owner', 'Orbit Café (owner)', ACCT['shop'], '3.55'), ('tips', 'Mai', ACCT['mai'], '0.25'),
           ('tips', 'Ton', ACCT['ton'], '0.25'), ('tax', 'Tax reserve', ACCT['tax'], '0.35'),
           ('supplier', 'Milk Farm Co-op', ACCT['milk'], '0.60')]
    legend_rows(d, px + 24, 274, pw - 48, pay, gap=52)
    yy = 274 + 5 * 52
    d.line(px + 24, yy - 14, px + pw - 24, yy - 14, C['line'])
    d.text(px + 24, yy + 14, 'Total', 15, 700)
    d.text(px + pw - 24, yy + 14, '5.00', 18, 700, anchor='end')
    d.rect(px + 24, yy + 44, pw - 48, 156, fill=C['mintbg'], rx=12)
    ic_shield(d, px + 50, yy + 76, 11, C['minttext'])
    d.text(px + 72, yy + 81, 'Checked on chain, not just here', 14, 700, C['minttext'])
    for i, ln in enumerate(['Amounts are whole token units, never fractions.',
                            'The contract refuses a bill whose payouts do not',
                            'add up to its total, or that lists more than ten',
                            'recipients. Every recipient is registered first.']):
        d.text(px + 48, yy + 108 + i * 20, ln, 13, 400, C['ink'], maxw=pw - 96)
    return d


# ------------------------------------------------------------------ NM-03
def nm03():
    d = pos_shell('NM-03', 'Team & shifts', 'Payroll by the cup: whoever is clocked in is paid from the next bill, at once.')
    tw_ = 760
    card(d, CX, 112, tw_, 480, id='team-card')
    d.text(CX + 24, 150, 'Today', 18, 700)
    chip(d, CX + 86, 132, '2 on shift', 'mint', id='shift-count')
    cols = [150, 262, 128, 98, 122]
    y0 = table(d, CX + 0 + 0, 176, cols, ['Person', 'NEAR account', 'Shift', {'t': 'Earned today'}, ''], [], row_h=0)
    people = [('Mai', ACCT['mai'], 'On since 08:02', '9.00', True), ('Ton', ACCT['ton'], 'On since 08:15', '9.00', True),
              ('Fern', 'fern.orbit.bitpos-near.testnet', 'Off shift', '0.00', False)]
    y = 212
    for name, acct, sh, earned, on in people:
        d.circle(CX + 36, y + 36, 16, fill=C['mintbg'] if on else C['grey'])
        d.text(CX + 36, y + 41, name[0], 14, 700, C['minttext'] if on else C['muted'], anchor='middle')
        d.text(CX + 62, y + 41, name, 15, 600)
        d.text(CX + 164, y + 33, acct, 12, 600, C['ink'], maxw=250)
        d.text(CX + 164, y + 51, 'Registered on tUSD', 11, 400, C['muted'])
        chip(d, CX + 426, y + 23, sh, 'mint' if on else 'grey', h=26, size=11, pad=9)
        d.text(CX + 624, y + 41, earned, 16, 700, anchor='end')
        button(d, CX + tw_ - 24, y + 18, 92, 36, 'Clock out' if on else 'Clock in', 'outline' if on else 'dark',
               size=13, anchor='end', id='shift-button')
        d.line(CX, y + 72, CX + tw_, y + 72, C['line'])
        y += 72
    d.text(CX + 24, y + 36, 'Tips and wage share today', 13, 600, C['muted'])
    d.text(CX + 624, y + 38, '18.00', 18, 700, anchor='end')
    d.text(CX + 632, y + 38, 'tUSD', 12, 600, C['muted'])
    d.rect(CX + 24, y + 60, tw_ - 48, 64, fill=C['paper'], rx=12)
    d.text(CX + 44, y + 87, 'See it from Mai\'s side', 14, 600)
    d.text(CX + 44, y + 107, 'Her phone shows each share arriving as bills are paid.', 12, 400, C['muted'])
    link(d, CX + tw_ - 44, y + 97, 'Open Mai\'s phone', 'NS-01', anchor='end')

    hx = CX + tw_ + 16
    hw = CW - tw_ - 16
    card(d, hx, 112, hw, 480, id='how-card')
    d.text(hx + 24, 150, 'How payroll by the cup works', 16, 700)
    steps = [('Clock in', 'The server notes who is on shift. No money moves.'),
             ('A bill is paid', 'The bill lists each person on shift with a share.'),
             ('The contract pays', 'Shares land in each person\'s own account, in the owner\'s receipt.'),
             ('Nobody holds NEAR', 'The café\'s relayer pays the network fee for staff too.')]
    y = 190
    for i, (t, n) in enumerate(steps):
        d.circle(hx + 40, y + 6, 14, fill=C['ink'])
        d.text(hx + 40, y + 11, str(i + 1), 13, 700, C['onink'], anchor='middle')
        d.text(hx + 68, y + 10, t, 14, 600)
        d.para(hx + 68, y + 32, n, 13, 400, C['muted'], hw - 96, lh=19)
        y += 96

    card(d, CX, 608, CW, 332, id='feed-card')
    d.text(CX + 24, 646, 'Shares paid in the last bills', 16, 700)
    cols = [150, 110, 240, 240, 388]
    rows = []
    for b, t in ((BILL_ID, '10:42'), ('B-7K2M8P', '10:37'), ('B-7K2M7N', '10:31'), ('B-7K2M6M', '10:24')):
        rows.append([dict(t=b, w=600), t, 'Mai  +0.25 tUSD', 'Ton  +0.25 tUSD',
                     dict(t='Same receipt as the owner share · ' + TX + ' ↗', col=C['muted'])])
    table(d, CX + 24, 668, [c * (CW - 48) / sum(cols) for c in cols], ['Bill', 'Time', 'To Mai', 'To Ton', 'Proof'], rows,
          row_h=52)
    return d


# ------------------------------------------------------------------ NM-04
def nm04():
    d = pos_shell('NM-04', 'Suppliers & invoices', 'Record what you owe. Every bill sets a share aside until it is paid.')
    card(d, CX, 112, CW, 360, id='invoices-card')
    d.text(CX + 24, 150, 'Invoices', 18, 700)
    button(d, CX + CW - 24, 128, 150, 40, 'New invoice', 'dark', size=14, anchor='end', id='new-invoice-button')
    cols = [200, 250, 110, 110, 110, 170, 130]
    sc = (CW - 48) / sum(cols)
    cols = [c * sc for c in cols]
    rows = [[dict(t='Milk Farm Co-op', w=600), ACCT['milk'], 'INV-0042', dict(t='120.00', anchor='end'),
             dict(t='81.60', anchor='end', w=700), '12% of each bill', dict(t='Collecting', chip='amber')],
            [dict(t='Bean Roasters', w=600), ACCT['beans'], 'INV-0039', dict(t='90.00', anchor='end'),
             dict(t='90.00', anchor='end', w=700), dict(t='Stopped', col=C['muted']), dict(t='Paid in full', chip='mint')]]
    y = table(d, CX + 24, 180, cols, ['Supplier', 'NEAR account', 'Invoice', {'t': 'Total'}, {'t': 'Funded'}, 'Rate',
                                     'Status'], rows, row_h=64)
    d.hotspot('NM-05', CX + 24, 216, CW - 48, 64)
    d.text(CX + 24, y + 36, 'Milk Farm Co-op is being funded now', 14, 600)
    d.rect(CX + 24, y + 52, CW - 48 - 190, 12, fill=C['grey'], rx=6)
    d.rect(CX + 24, y + 52, (CW - 48 - 190) * 0.68, 12, fill=C['muted'], rx=6)
    d.text(CX + CW - 24 - 172, y + 63, '68% · 38.40 to go', 13, 600, C['ink'])
    link(d, CX + 24, y + 104, 'Open INV-0042', 'NM-05')

    w3 = (CW - 2 * 16) / 3
    cards = [('It collects itself', 'Each paid bill sends the invoice\'s share straight to the supplier\'s account. You never run a payment batch.', ic_bolt),
             ('It stops by itself', 'When the funded amount reaches the total, the server leaves the supplier out of the next bills and the owner share grows back.', ic_check),
             ('The supplier can check', 'Every share is a token transfer the supplier sees in their own account, with the bill it came from in the ledger.', ic_shield)]
    for i, (t, n, ic) in enumerate(cards):
        x = CX + i * (w3 + 16)
        card(d, x, 488, w3, 220, id='explain-card')
        d.circle(x + 44, 532, 20, fill=C['grey'])
        if ic is ic_check:
            ic(d, x + 44, 532, 18, C['ink'])
        elif ic is ic_bolt:
            ic(d, x + 44, 532, 10, C['ink'])
        else:
            ic(d, x + 44, 532, 10, C['ink'])
        d.text(x + 24, 586, t, 16, 700)
        d.para(x + 24, 612, n, 13, 400, C['muted'], w3 - 48, lh=20)
    card(d, CX, 724, CW, 152, id='note-card', fill=C['paper'], dash='6 6')
    d.text(CX + 24, 764, 'What this does not do yet', 14, 700)
    for i, ln in enumerate(['Suppliers on other chains are not paid directly. That is a planned step using chain signatures.',
                            'An invoice is a record in BitPOS plus transfers on NEAR. It is not a legal tax invoice.',
                            'All amounts here are test money on NEAR testnet.']):
        d.circle(CX + 30, 792 + i * 28, 3, fill=C['muted'])
        d.text(CX + 44, 797 + i * 28, ln, 13, 400, C['muted'], maxw=CW - 80)
    return d


# ------------------------------------------------------------------ NM-05
def nm05():
    d = pos_shell('NM-05', 'Invoice INV-0042', 'Milk Farm Co-op · ' + ACCT['milk'])
    link_w = d.text(CX, 124, '← Back to suppliers', 13, 600, C['minttext'])
    d.hotspot('NM-04', CX - 4, 106, link_w + 8, 28)
    lw = 420
    card(d, CX, 144, lw, 796, id='summary-card')
    chip(d, CX + 24, 168, 'Collecting', 'amber', id='state-chip')
    d.text(CX + 24, 240, '81.60', 44, 700)
    d.text(CX + 150, 240, 'of 120.00 tUSD', 15, 600, C['muted'])
    d.rect(CX + 24, 264, lw - 48, 14, fill=C['grey'], rx=7)
    d.rect(CX + 24, 264, (lw - 48) * 0.68, 14, fill=C['muted'], rx=7)
    d.text(CX + 24, 304, '68% funded', 13, 600)
    d.text(CX + lw - 24, 304, '38.40 to go', 13, 600, C['muted'], anchor='end')
    facts = [('Supplier', 'Milk Farm Co-op'), ('Paid to', ACCT['milk']), ('Due', '20 Nov 2026'),
             ('Rate', '12% of each paid bill'), ('Started', '11 Nov 2026 · 136 bills so far'),
             ('Stops', 'By itself at 120.00')]
    y = 350
    for k, v in facts:
        d.text(CX + 24, y, k, 12, 600, C['muted'])
        d.text(CX + 24, y + 20, v, 14, 600, C['ink'], maxw=lw - 48)
        d.line(CX + 24, y + 36, CX + lw - 24, y + 36, C['line'])
        y += 58
    d.rect(CX + 24, y + 6, lw - 48, 92, fill=C['paper'], rx=12)
    d.text(CX + 44, y + 36, 'At today\'s pace', 13, 600)
    d.text(CX + 44, y + 58, 'Funded on 17 Nov, three days before', 13, 400, C['muted'])
    d.text(CX + 44, y + 76, 'the due date.', 13, 400, C['muted'])

    rx = CX + lw + 16
    rw = CW - lw - 16
    card(d, rx, 144, rw, 796, id='payouts-card')
    d.text(rx + 24, 182, 'Shares that came from bills', 18, 700)
    d.text(rx + 24, 206, 'Each line is one transfer inside a bill\'s own settlement receipt.', 13, 400, C['muted'])
    cols = [150, 110, 130, 262]
    sc = (rw - 48) / sum(cols)
    cols = [c * sc for c in cols]
    bills = [(BILL_ID, '10:42'), ('B-7K2M8P', '10:37'), ('B-7K2M7N', '10:31'), ('B-7K2M6M', '10:24'), ('B-7K2M4J', '10:02'),
             ('B-7K2M3H', '09:55'), ('B-7K2M2G', '09:48'), ('B-7K2M1F', '09:40'), ('B-7K2M0E', '09:31')]
    rows = []
    amts = ['0.60', '0.90', '0.60', '0.42', '0.60', '1.20', '0.60', '0.54', '0.60']
    for (b, t), a in zip(bills, amts):
        rows.append([dict(t=b, w=600), t, dict(t='+' + a, anchor='end', w=700), dict(t=TX + ' ↗', col=C['minttext'], w=600)])
    y = table(d, rx + 24, 228, cols, ['Bill', 'Time', {'t': 'To supplier'}, 'Settlement transaction'], rows, row_h=56)
    d.hotspot('NM-07', rx + 24, 264, rw - 48, 56)
    d.text(rx + 24, y + 36, 'Showing 9 of 136 · sample data', 12, 400, C['muted'])
    link(d, rx + rw - 24, y + 36, 'Evidence for ' + BILL_ID, 'NM-07', anchor='end')
    return d


# ------------------------------------------------------------------ NM-06
def nm06():
    d = pos_shell('NM-06', 'Ledger', 'Every bill, what the chain says about it, and the proof.')
    card(d, CX, 112, CW, 828, id='ledger-card')
    x = CX + 24
    for t, k in (('All 36', 'ink'), ('Settled 33', 'outline'), ('In escrow 1', 'outline'), ('Bounced 1', 'outline'),
                 ('Refunded 1', 'outline')):
        x += chip(d, x, 136, t, k, h=32, size=13, pad=14, id='filter-chip') + 8
    button(d, CX + CW - 24, 132, 150, 40, 'Export CSV', 'outline', size=14, anchor='end', id='export-button')
    cols = [120, 80, 80, 100, 130, 150, 250, 170]
    sc = (CW - 48) / sum(cols)
    cols = [c * sc for c in cols]
    A = 'alice.bitpos-near.testnet'
    rows = [
        [dict(t=BILL_ID, w=600), '10:42', 'T4', dict(t='5.00', anchor='end', w=700), dict(t='Settled', chip='mint'), 'Mini-01 signed', A, dict(t=TX + ' ↗', col=C['minttext'], w=600)],
        [dict(t='B-7K2M8P', w=600), '10:37', 'T2', dict(t='7.50', anchor='end', w=700), dict(t='Settled', chip='mint'), 'Mini-02 signed', 'bob.bitpos-near.testnet', dict(t='4mTz…SAMPLE ↗', col=C['minttext'], w=600)],
        [dict(t='B-7K2M7N', w=600), '10:31', 'T4', dict(t='5.00', anchor='end', w=700), dict(t='In escrow', chip='amber'), 'Waiting 0:48', A, dict(t='7pLa…SAMPLE ↗', col=C['minttext'], w=600)],
        [dict(t='B-7K2M6M', w=600), '10:24', 'T1', dict(t='3.50', anchor='end', w=700), dict(t='Settled', chip='mint'), 'Mini-03 signed', 'dee.bitpos-near.testnet', dict(t='2kVc…SAMPLE ↗', col=C['minttext'], w=600)],
        [dict(t='B-7K2M6L', w=600), '10:20', 'T1', dict(t='3.50', anchor='end', w=700), dict(t='Bounced', chip='red'), 'Not needed', 'dee.bitpos-near.testnet', dict(t='8wQn…SAMPLE ↗', col=C['minttext'], w=600)],
        [dict(t='B-7K2M5K', w=600), '10:11', 'T3', dict(t='5.00', anchor='end', w=700), dict(t='Refunded', chip='red'), 'No signature', 'bob.bitpos-near.testnet', dict(t='5hRd…SAMPLE ↗', col=C['minttext'], w=600)],
        [dict(t='B-7K2M4J', w=600), '10:02', 'T2', dict(t='5.00', anchor='end', w=700), dict(t='Settled', chip='mint'), 'Mini-02 signed', A, dict(t='3nBx…SAMPLE ↗', col=C['minttext'], w=600)],
        [dict(t='B-7K2M3H', w=600), '09:55', 'T4', dict(t='10.00', anchor='end', w=700), dict(t='Settled', chip='mint'), 'Mini-01 signed', 'bob.bitpos-near.testnet', dict(t='6yGf…SAMPLE ↗', col=C['minttext'], w=600)],
        [dict(t='B-7K2M2G', w=600), '09:48', 'T1', dict(t='5.00', anchor='end', w=700), dict(t='Settled', chip='mint'), 'Mini-03 signed', A, dict(t='1cJk…SAMPLE ↗', col=C['minttext'], w=600)],
    ]
    y = table(d, CX + 24, 192, cols, ['Bill', 'Time', 'Table', {'t': 'Total tUSD'}, 'State', 'Witness', 'Paid by',
                                     'Payment transaction'], rows, row_h=60)
    d.hotspot('NM-07', CX + 24, 228, CW - 48, 60)
    d.rect(CX + 24, y + 20, CW - 48, 116, fill=C['paper'], rx=12)
    d.text(CX + 48, y + 50, 'How to read the states', 14, 700)
    notes = [('Settled', 'Paid, witnessed and split. Final.'), ('In escrow', 'Paid. Waiting for the table screen to sign.'),
             ('Bounced', 'Wrong amount or expired. Money returned in the same transaction.'),
             ('Refunded', 'No witness within 2:00. The contract sent the money back.')]
    for i, (k, n) in enumerate(notes):
        xx = CX + 48 + (i % 2) * 540
        yy = y + 80 + (i // 2) * 30
        d.text(xx, yy, k, 13, 700)
        d.text(xx + 84, yy, n, 13, 400, C['muted'], maxw=440)
    d.text(CX + 24, 926, 'Transaction links open the NEAR testnet explorer.', 12, 400, C['muted'])
    return d


# ------------------------------------------------------------------ NM-07
def nm07():
    d = pos_shell('NM-07', 'Evidence · ' + BILL_ID, '5.00 tUSD · Table 4 · paid by alice.bitpos-near.testnet')
    link_w = d.text(CX, 124, '← Back to ledger', 13, 600, C['minttext'])
    d.hotspot('NM-06', CX - 4, 106, link_w + 8, 28)
    chip(d, CX + 150, 106, 'Settled', 'mint', id='state-chip')
    lw = 700
    card(d, CX, 144, lw, 796, id='timeline-card')
    d.text(CX + 24, 182, 'What happened, in order', 18, 700)
    steps = [
        ('10:41:52', 'Server froze the quote', 'Cart priced on the server: 5.00 tUSD = 5,000,000 units. Quote Q-58213.', None, 'ink'),
        ('10:41:53', 'Bill opened on chain', 'open_bill by the shop\'s cashier key: total, five payouts, expiry 10:46:53, witness key of Mini-01.', '1aBc…SAMPLE', 'ink'),
        ('10:42:04', 'Customer paid, gasless', 'ft_transfer_call of exactly 5.00 tUSD with the bill id. The café\'s relayer paid the fee. Status FINAL.', '9xQe…SAMPLE', 'mint'),
        ('10:42:04', 'Held in the bill', 'Contract state Escrow. The money sits in the contract, not with the shop.', None, 'amber'),
        ('10:42:07', 'Table screen witnessed', 'Mini-01 read the bill from the chain, showed PAID, then signed. The contract checked the signature.', '6dWm…SAMPLE', 'mint'),
        ('10:42:07', 'Split paid in one receipt', 'Five transfers in one batch. If any had failed, all would have reverted. State Settled.', '6dWm…SAMPLE', 'mint'),
    ]
    y = 220
    colmap = {'ink': C['ink'], 'mint': C['mint'], 'amber': C['amber']}
    for i, (t, title, note, tx, col) in enumerate(steps):
        if i < len(steps) - 1:
            d.line(CX + 44, y + 16, CX + 44, y + 112, C['line'], 2)
        d.circle(CX + 44, y + 4, 12, fill=colmap[col])
        if col == 'amber':
            ic_clock(d, CX + 44, y + 4, 7, C['ink'], sw=1.6)
        else:
            ic_check(d, CX + 44, y + 4, 11, C['onink'] if col == 'ink' else C['ink'])
        d.text(CX + 72, y + 9, title, 15, 600)
        d.text(CX + lw - 24, y + 9, t, 12, 600, C['muted'], anchor='end')
        yy = d.para(CX + 72, y + 32, note, 13, 400, C['muted'], lw - 120, lh=19)
        if tx:
            d.text(CX + 72, yy + 4, tx + ' ↗', 12, 600, C['minttext'])
        y += 116

    rx = CX + lw + 16
    rw = CW - lw - 16
    card(d, rx, 144, rw, 372, id='paid-card')
    d.text(rx + 24, 182, 'Who was paid', 16, 700)
    split_bar(d, rx + 24, 200, rw - 48, 16)
    pay = [('owner', 'Orbit Café (owner)', '3.55'), ('tips', 'Mai', '0.25'), ('tips', 'Ton', '0.25'),
           ('tax', 'Tax reserve', '0.35'), ('supplier', 'Milk Farm Co-op', '0.60')]
    y = 250
    for k, t, a in pay:
        d.rect(rx + 24, y - 11, 12, 12, fill=SPLIT_COLOR[k], rx=3)
        d.text(rx + 48, y, t, 14, 600)
        d.text(rx + rw - 24, y, a, 15, 700, anchor='end')
        y += 40
    d.line(rx + 24, y - 16, rx + rw - 24, y - 16, C['line'])
    d.text(rx + 24, y + 12, 'Total', 14, 700)
    d.text(rx + rw - 24, y + 12, '5.00 tUSD', 16, 700, anchor='end')

    card(d, rx, 532, rw, 408, id='checks-card')
    d.text(rx + 24, 570, 'What the server checked before PAID', 16, 700)
    checks = ['Transaction reached FINAL, not just sent', 'Token contract is the allowed tUSD', 'Receiver is the bills contract',
              'Amount equals the frozen quote', 'Bill id belongs to this order', 'Contract view says Settled',
              'This transaction was not used before']
    y = 606
    for c in checks:
        ic_check(d, rx + 36, y - 4, 11, C['minttext'], bg=C['mintbg'])
        d.text(rx + 58, y, c, 13, 400, C['ink'], maxw=rw - 82)
        y += 34
    d.rect(rx + 24, y + 4, rw - 48, 64, fill=C['paper'], rx=12)
    d.text(rx + 44, y + 30, 'A wallet saying "sent" is not proof.', 13, 600)
    d.text(rx + 44, y + 50, 'Only the chain\'s final receipt is.', 13, 400, C['muted'])
    return d


# ------------------------------------------------------------------ NM-08
def mini_thumb(d, x, y, w, h, label, state, target):
    d.g('thumb')
    d.rect(x, y, w, h, fill=C['ink'], rx=8)
    cx, cy = x + w / 2, y + h / 2 - 4
    if state == 'idle':
        ic_cup(d, cx, cy, 12, C['onink'], sw=2)
    elif state == 'qr':
        d.rect(cx - 16, cy - 16, 32, 32, fill=C['card'], rx=3)
        for (qx, qy) in ((-12, -12), (4, -12), (-12, 4)):
            d.rect(cx + qx, cy + qy, 8, 8, fill=C['ink'])
        d.rect(cx + 4, cy + 4, 4, 4, fill=C['ink'])
    elif state == 'checking':
        ic_spinner(d, cx, cy, 20, C['amber'], C['ink4'])
    elif state == 'paid':
        ic_check(d, cx, cy, 16, C['ink'], bg=C['mint'])
    elif state == 'refunded':
        ic_return(d, cx, cy, 16, C['onink'], bg=C['red'])
    elif state == 'offline':
        d.circle(cx, cy, 14, stroke=C['oninkmuted'], sw=2, dash='4 4')
        d.line(cx - 5, cy, cx + 5, cy, C['oninkmuted'], 2, cap='round')
    else:
        ic_key(d, cx, cy, 12, C['mint'])
    d.text(cx, y + h - 8, label, 10, 600, C['oninkmuted'], anchor='middle')
    d.end()
    d.hotspot(target, x, y, w, h)


def nm08():
    d = pos_shell('NM-08', 'Devices & witness', 'The table screen proves the café saw the payment. Without its signature, money goes back.')
    lw = 560
    card(d, CX, 112, lw, 520, id='device-card')
    d.circle(CX + 52, 164, 28, fill=C['mintbg'])
    ic_screen(d, CX + 52, 163, 13, C['minttext'], sw=2.2)
    d.text(CX + 96, 158, 'Mini-01 · Table 4', 18, 700)
    d.text(CX + 96, 180, 'BitPOS Mini · firmware 0.5.0-near', 13, 400, C['muted'])
    chip(d, CX + lw - 24, 148, 'Online', 'mint', anchor='end', dot=C['mint'], id='online-chip')
    d.rect(CX + 24, 212, lw - 48, 96, fill=C['paper'], rx=12)
    d.text(CX + 44, 240, 'Witness key', 12, 600, C['muted'])
    d.text(CX + 44, 266, 'ed25519:7Hk3vTn2…SAMPLE…9qPz', 16, 700)
    d.text(CX + 44, 290, 'Made inside the device. The private half never leaves it.', 12, 400, C['muted'])
    can = [('Can', C['minttext'], ['Sign "I showed PAID for this bill"', 'Read a bill\'s state from the chain']),
           ('Cannot', C['red'], ['Move or receive money', 'Open, change or void a bill', 'Sign for another shop\'s bills'])]
    x = CX + 24
    for t, col, items in can:
        d.text(x, 346, t, 13, 700, col)
        yy = 372
        for it in items:
            if t == 'Can':
                ic_check(d, x + 9, yy - 4, 9, C['minttext'], bg=C['mintbg'])
            else:
                d.circle(x + 9, yy - 4, 9, fill=C['redbg'])
                d.line(x + 5, yy - 4, x + 13, yy - 4, C['red'], 2, cap='round')
            d.text(x + 28, yy, it, 13, 400, C['ink'])
            yy += 30
        x += 262
    d.line(CX + 24, 476, CX + lw - 24, 476, C['line'])
    d.text(CX + 24, 510, 'Witness mode', 14, 600)
    d.text(CX + 24, 530, 'Refund after 2:00 without a signature', 12, 400, C['muted'])
    d.rect(CX + lw - 24 - 52, 498, 52, 30, fill=C['mint'], rx=15)
    d.circle(CX + lw - 24 - 15, 513, 11, fill=C['card'])
    button(d, CX + 24, 564, 230, 44, 'Register a new device', 'dark', target='ND-07', size=14, id='register-button')
    d.text(CX + 270, 591, 'Opens the setup screen on the Mini', 12, 400, C['muted'])

    rx = CX + lw + 16
    rw = CW - lw - 16
    card(d, rx, 112, rw, 252, id='stats-card')
    d.text(rx + 24, 150, 'Today', 16, 700)
    st = [('36 / 36', 'bills witnessed'), ('1.8 s', 'median, paid to signed'), ('1', 'refund for no witness')]
    for i, (v, n) in enumerate(st):
        xx = rx + 24 + i * ((rw - 48) / 3)
        d.text(xx, 208, v, 28, 700)
        d.text(xx, 232, n, 12, 400, C['muted'])
    d.line(rx + 24, 262, rx + rw - 24, 262, C['line'])
    d.text(rx + 24, 294, 'Why a signature and not a server flag', 13, 600)
    d.text(rx + 24, 316, 'The contract checks the device\'s signature itself, so the', 12, 400, C['muted'])
    d.text(rx + 24, 334, 'server cannot fake a witness to release money early.', 12, 400, C['muted'])

    card(d, rx, 380, rw, 252, id='sim-card')
    d.text(rx + 24, 418, 'Table screen states', 16, 700)
    chip(d, rx + rw - 24, 400, 'Simulated on the hosted demo', 'amber', anchor='end', h=24, size=11, id='sim-chip')
    d.text(rx + 24, 442, 'The same seven states run on the real BitPOS Mini.', 12, 400, C['muted'])
    states = [('Idle', 'idle', 'ND-01'), ('QR', 'qr', 'ND-02'), ('Checking', 'checking', 'ND-03'), ('Paid', 'paid', 'ND-04'),
              ('Refunded', 'refunded', 'ND-05'), ('Offline', 'offline', 'ND-06'), ('Setup', 'setup', 'ND-07')]
    gw = (rw - 48 - 6 * 8) / 7
    for i, (lb, stt, tg) in enumerate(states):
        mini_thumb(d, rx + 24 + i * (gw + 8), 464, gw, 96, lb, stt, tg)
    d.text(rx + 24, 600, 'Click a state to open its screen.', 12, 400, C['muted'])

    card(d, CX, 648, CW, 292, id='flow-card')
    d.text(CX + 24, 686, 'How the witness works', 16, 700)
    steps = [('1', 'Customer pays', 'Exact amount lands in the bill. State: Escrow.'),
             ('2', 'Screen asks the chain', 'The Mini calls a NEAR RPC view itself. It does not trust the server.'),
             ('3', 'Screen shows PAID', 'Only after the display has really refreshed.'),
             ('4', 'Screen signs', 'ed25519 over the contract, shop and bill id.'),
             ('5', 'Contract releases', 'Signature checked on chain, then the split is paid.')]
    sw_ = (CW - 48 - 4 * 16) / 5
    for i, (n, t, s) in enumerate(steps):
        x = CX + 24 + i * (sw_ + 16)
        d.rect(x, 710, sw_, 150, fill=C['paper'], rx=12)
        d.circle(x + 28, 740, 14, fill=C['ink'])
        d.text(x + 28, 745, n, 13, 700, C['onink'], anchor='middle')
        d.text(x + 16, 782, t, 14, 600)
        d.para(x + 16, 804, s, 12, 400, C['muted'], sw_ - 32, lh=17)
    d.rect(CX + 24, 876, CW - 48, 44, fill=C['amberbg'], rx=12)
    ic_clock(d, CX + 48, 898, 8, C['ambertext'])
    d.text(CX + 68, 903, 'No signature within 2:00? Anyone can call reclaim and the contract refunds the customer.', 13, 600,
           C['ambertext'])
    return d


# ------------------------------------------------------------------ NM-09
def nm09():
    d = pos_shell('NM-09', 'Café CFO', 'An assistant that reads your ledger privately and proposes. It cannot move money or approve.')
    lw = 720
    card(d, CX, 112, lw, 828, id='cfo-card')
    ic_spark(d, CX + 36, 146, 10, C['violet'])
    d.text(CX + 56, 152, 'Ask about your money', 18, 700)
    x = CX + 24
    for q in ('Can I pay the milk invoice by Friday?', 'Are tips fair this week?', 'Is my tax reserve enough?'):
        x += chip(d, x, 176, q, 'outline', h=32, size=12, pad=12, id='question-chip') + 8
    d.rect(CX + lw - 24 - 360, 232, 360, 44, fill=C['ink'], rx=16)
    d.text(CX + lw - 44, 259, 'Can I pay the milk invoice by Friday?', 14, 600, C['onink'], anchor='end')
    d.rect(CX + 24, 296, lw - 120, 152, fill=C['violetbg'], rx=16)
    d.text(CX + 44, 326, 'CAFÉ CFO', 11, 700, C['violettext'])
    d.para(CX + 44, 352, 'Sales are steady and the milk invoice is close to its due date. Moving one step of the owner '
           'share to supplier funding pays it early without touching tips or the tax reserve.', 14, 400, C['ink'],
           lw - 160, lh=22)
    d.text(CX + 44, 432, 'The model writes no figures. The numbers below come from the server.', 12, 400, C['violettext'])

    d.rect(CX + 24, 464, lw - 48, 132, fill=C['paper'], rx=12)
    d.text(CX + 44, 494, 'Facts computed by the server from the ledger', 13, 600)
    facts = [('38.40', 'tUSD still to fund'), ('20 Nov', 'due date'), ('17 Nov', 'funded at today\'s pace'),
             ('15 Nov', 'funded with the proposal')]
    for i, (v, n) in enumerate(facts):
        xx = CX + 44 + i * 164
        d.text(xx, 548, v, 24, 700)
        d.text(xx, 572, n, 12, 400, C['muted'])

    d.rect(CX + 24, 612, lw - 48, 150, fill=C['card'], rx=12, stroke=C['violet'])
    d.text(CX + 44, 644, 'Proposal · preset "supplier-up-one"', 14, 700)
    d.text(CX + 44, 672, 'Supplier funding', 13, 400, C['muted'])
    d.text(CX + 190, 672, '12% → 15%', 14, 700)
    d.text(CX + 330, 672, 'Owner', 13, 400, C['muted'])
    d.text(CX + 390, 672, '71% → 68%', 14, 700)
    d.text(CX + 44, 698, 'Tips and tax reserve stay as they are. Reverts by itself when the invoice is paid.', 13, 400,
           C['muted'])
    button(d, CX + 44, 714, None, 40, 'Review proposal', 'violet', target='NM-10', size=14, id='review-button')

    d.text(CX + 24, 800, 'Proof for this answer', 13, 600)
    wp = chip(d, CX + 24, 814, 'Private inference · signature verified', 'violet', h=26, size=12, id='proof-chip',
              dot=C['violet'])
    d.text(CX + 24, 866, 'Model z-ai/glm-5.3-flash, run in a hardware enclave on NEAR AI Cloud', 12, 400, C['muted'])
    d.text(CX + 24, 886, 'Request 3fa9…SAMPLE · Response b21c…SAMPLE · Signer 0x8E4c…SAMPLE matches the attested key', 12,
           400, C['muted'], maxw=lw - 48)
    d.text(CX + 24, 906, 'Saved with the proposal so anyone can re-check it later.', 12, 400, C['muted'])

    rx = CX + lw + 16
    rw = CW - lw - 16
    card(d, rx, 112, rw, 500, id='limits-card')
    d.text(rx + 24, 150, 'What the CFO can and cannot do', 16, 700)
    groups = [('Can', C['minttext'], ['Read ledger totals inside the enclave', 'Pick one preset from the server\'s list',
                                      'Write a short reason with no figures']),
              ('Cannot', C['red'], ['Set a percentage or an amount', 'Approve its own proposal', 'Open bills or move money',
                                    'See customer names or wallets'])]
    y = 186
    for t, col, items in groups:
        d.text(rx + 24, y, t, 13, 700, col)
        y += 26
        for it in items:
            if t == 'Can':
                ic_check(d, rx + 33, y - 4, 9, C['minttext'], bg=C['mintbg'])
            else:
                d.circle(rx + 33, y - 4, 9, fill=C['redbg'])
                d.line(rx + 29, y - 4, rx + 37, y - 4, C['red'], 2, cap='round')
            d.text(rx + 52, y, it, 13, 400, C['ink'], maxw=rw - 76)
            y += 30
        y += 14
    d.rect(rx + 24, 504, rw - 48, 84, fill=C['paper'], rx=12)
    ic_key(d, rx + 48, 532, 9, C['ink'])
    d.text(rx + 68, 536, 'Its NEAR key', 13, 600)
    d.text(rx + 44, 558, ACCT['cfo'], 12, 600, C['ink'], maxw=rw - 88)
    d.text(rx + 44, 576, 'may call one method: propose', 12, 400, C['muted'])

    card(d, rx, 628, rw, 312, id='history-card')
    d.text(rx + 24, 666, 'Earlier proposals', 16, 700)
    hist = [('12 Nov', 'Start funding the milk invoice', 'Approved by owner', 'mint'),
            ('10 Nov', 'Raise the tax reserve one step', 'Rejected by owner', 'grey'),
            ('08 Nov', 'Stop funding the bean invoice', 'Applied by itself: invoice paid', 'grey')]
    y = 700
    for dt, t, s, k in hist:
        d.text(rx + 24, y, dt, 12, 600, C['muted'])
        d.text(rx + 84, y, t, 13, 600, C['ink'], maxw=rw - 108)
        chip(d, rx + 84, y + 10, s, k, h=22, size=11, pad=9, id='history-chip')
        d.line(rx + 24, y + 46, rx + rw - 24, y + 46, C['line'])
        y += 72
    return d


# ------------------------------------------------------------------ NM-10
def bar(d, x, y, w, h, parts):
    cx = x
    inner = w - 3 * (len(parts) - 1)
    for k, v in parts:
        sw_ = inner * v / 100.0
        d.rect(cx, y, sw_, h, fill=SPLIT_COLOR[k], rx=6)
        cx += sw_ + 3


def nm10():
    d = pos_shell('NM-10', 'Review proposal', 'Café CFO proposed a change to the split recipe. Only an owner can approve it.')
    link_w = d.text(CX, 124, '← Back to Café CFO', 13, 600, C['minttext'])
    d.hotspot('NM-09', CX - 4, 106, link_w + 8, 28)
    lw = 720
    card(d, CX, 144, lw, 796, id='compare-card')
    ic_spark(d, CX + 36, 178, 10, C['violet'])
    d.text(CX + 56, 184, 'Fund the milk invoice sooner', 20, 700)
    d.text(CX + 24, 212, 'Preset "supplier-up-one" · proposed 14 Nov 10:44', 13, 400, C['muted'])
    cur = [('owner', 71), ('tips', 10), ('tax', 7), ('supplier', 12)]
    new = [('owner', 68), ('tips', 10), ('tax', 7), ('supplier', 15)]
    assert sum(v for _, v in cur) == 100 and sum(v for _, v in new) == 100
    d.text(CX + 24, 262, 'Now', 13, 600, C['muted'])
    bar(d, CX + 100, 246, lw - 124, 24, cur)
    d.text(CX + 24, 310, 'Proposed', 13, 600, C['violettext'])
    bar(d, CX + 100, 294, lw - 124, 24, new)
    cols = [240, 108, 108, 108, 108]
    rows = [[dict(t='Orbit Café (owner)', w=600), dict(t='71%', anchor='end'), dict(t='68%', anchor='end', w=700),
             dict(t='3.55', anchor='end'), dict(t='3.40', anchor='end', w=700)],
            [dict(t='Milk Farm Co-op invoice', w=600), dict(t='12%', anchor='end'), dict(t='15%', anchor='end', w=700),
             dict(t='0.60', anchor='end'), dict(t='0.75', anchor='end', w=700)],
            [dict(t='Team tips', w=600), dict(t='10%', anchor='end'), dict(t='10%', anchor='end'),
             dict(t='0.50', anchor='end'), dict(t='0.50', anchor='end')],
            [dict(t='Tax reserve', w=600), dict(t='7%', anchor='end'), dict(t='7%', anchor='end'),
             dict(t='0.35', anchor='end'), dict(t='0.35', anchor='end')],
            [dict(t='Total of a 5.00 bill', w=700), dict(t='100%', anchor='end', w=700), dict(t='100%', anchor='end', w=700),
             dict(t='5.00', anchor='end', w=700), dict(t='5.00', anchor='end', w=700)]]
    assert 340 + 75 + 50 + 35 == 500
    y = table(d, CX + 24, 348, cols, ['Recipient', {'t': 'Share now'}, {'t': 'Proposed'}, {'t': 'Per 5.00 now'},
                                     {'t': 'Proposed'}], rows, row_h=52)
    d.rect(CX + 24, y + 20, lw - 48, 116, fill=C['violetbg'], rx=12)
    d.text(CX + 44, y + 50, 'CAFÉ CFO\'S REASON', 11, 700, C['violettext'])
    d.para(CX + 44, y + 76, 'Sales are steady and the milk invoice is close to its due date. One step more supplier '
           'funding pays it early without touching tips or the tax reserve.', 13, 400, C['ink'], lw - 88, lh=20)
    chip(d, CX + 24, y + 152, 'Private inference · signature verified', 'violet', h=26, size=12, id='proof-chip',
         dot=C['violet'])
    d.text(CX + 24, y + 204, 'The share reverts by itself once INV-0042 is fully funded.', 13, 400, C['muted'])
    button(d, CX + 24, 868, 220, 48, 'Approve and apply', 'primary', target='NM-02', id='approve-button')
    button(d, CX + 260, 868, 120, 48, 'Reject', 'outline', target='NM-09', id='reject-button')
    d.text(CX + 400, 897, 'Applies to bills opened after you approve.', 13, 400, C['muted'])

    rx = CX + lw + 16
    rw = CW - lw - 16
    card(d, rx, 144, rw, 380, id='effect-card')
    d.text(rx + 24, 182, 'What changes', 16, 700)
    eff = [('15 Nov', 'invoice funded, two days sooner'), ('−0.15', 'tUSD owner share per 5.00 bill, for now'),
           ('0', 'change for the team or tax reserve')]
    y2 = 228
    for v, n in eff:
        d.text(rx + 24, y2, v, 26, 700)
        d.text(rx + 24, y2 + 22, n, 13, 400, C['muted'], maxw=rw - 48)
        d.line(rx + 24, y2 + 42, rx + rw - 24, y2 + 42, C['line'])
        y2 += 86
    d.text(rx + 24, y2 + 6, 'Figures computed by the server.', 12, 400, C['muted'])

    card(d, rx, 540, rw, 400, id='who-card')
    d.text(rx + 24, 578, 'Who decides', 16, 700)
    who = [('The model', 'picked this preset from a list the server built. It has no approve tool.'),
           ('The server', 'computed every number and checked the preset is inside your limits.'),
           ('You', 'approve or reject. Your decision is recorded with the proof.')]
    y3 = 616
    for t, n in who:
        d.text(rx + 24, y3, t, 14, 700)
        y3 = d.para(rx + 24, y3 + 22, n, 13, 400, C['muted'], rw - 48, lh=19) + 22
    return d


# ------------------------------------------------------------------ NM-11
def nm11():
    d = pos_shell('NM-11', 'Setup', 'Four steps to take a shop live on NEAR testnet. Each key gets the least power that works.')
    steps = [('1', 'Shop account', ACCT['shop'], 'Created · a readable name'),
             ('2', 'Token', 'tUSD (test) and Circle USDC testnet', 'Both allowed in the bills contract'),
             ('3', 'Recipients', '5 of 5 registered on the token', 'Owner, tax, Mai, Ton, Milk Farm Co-op'),
             ('4', 'Witness device', 'Mini-01 · key registered', 'Witness mode on · refund after 2:00')]
    w4 = (CW - 3 * 16) / 4
    for i, (n, t, v, s) in enumerate(steps):
        x = CX + i * (w4 + 16)
        card(d, x, 112, w4, 168, id='step-card')
        ic_check(d, x + 38, 150, 14, C['ink'], bg=C['mint'])
        d.text(x + 62, 155, 'Step ' + n, 12, 600, C['muted'])
        d.text(x + 24, 200, t, 16, 700)
        d.text(x + 24, 226, v, 13, 600, C['ink'], maxw=w4 - 40)
        d.text(x + 24, 250, s, 12, 400, C['muted'], maxw=w4 - 40)
    card(d, CX, 296, CW, 484, id='keys-card')
    ic_key(d, CX + 40, 332, 10, C['ink'])
    d.text(CX + 62, 338, 'Keys with the least power', 18, 700)
    d.text(CX + 24, 362, 'No automated part of BitPOS holds a key that can move the shop\'s money.', 13, 400, C['muted'])
    cols = [190, 190, 372, 328]
    rows = [[dict(t='Owner key', w=600), 'Your own wallet', 'Everything. Used only by you, for setup and withdrawals.',
             dict(t='Never stored by BitPOS', col=C['minttext'], w=600)],
            [dict(t='Cashier key', w=600), 'BitPOS server', 'Call open_bill and void_bill on the bills contract.',
             dict(t='Cannot transfer tokens or NEAR', col=C['muted'])],
            [dict(t='Relayer key', w=600), 'BitPOS relayer', 'Pay network fees for payments into the bills contract.',
             dict(t='Refuses any other transaction', col=C['muted'])],
            [dict(t='Witness key', w=600), 'BitPOS Mini', 'Sign "I showed PAID for this bill".',
             dict(t='Not a NEAR account. Signs only.', col=C['muted'])],
            [dict(t='CFO key', w=600), 'Café CFO agent', 'Call propose with a preset id.',
             dict(t='Cannot approve or move money', col=C['muted'])],
            [dict(t='Staff keys', w=600), 'Each staff phone', 'Withdraw from their own account.',
             dict(t='Cannot touch the shop account', col=C['muted'])]]
    sc = (CW - 48) / sum(cols)
    table(d, CX + 24, 384, [c * sc for c in cols], ['Key', 'Held by', 'What it can do', 'What it cannot do'], rows,
          row_h=58)
    card(d, CX, 796, CW, 144, id='finish-card')
    d.text(CX + 24, 838, 'Ready to take bills', 16, 700)
    d.text(CX + 24, 862, 'Open a table menu, pay with the demo wallet and watch the bill split itself.', 13, 400,
           C['muted'])
    d.text(CX + 24, 900, 'Everything here is NEAR testnet and test money. Mainnet is not enabled.', 12, 400, C['muted'])
    button(d, CX + CW - 24, 836, 200, 48, 'Finish setup', 'primary', target='NM-01', anchor='end', id='finish-button')
    return d


ALL = [nm01, nm02, nm03, nm04, nm05, nm06, nm07, nm08, nm09, nm10, nm11]
