# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
"""Customer phone screens NC-01 .. NC-08 (390x844). English first; Thai variants for NC-02, NC-05, NC-06, NC-07."""
from lib import (C, ACCT, BILL_ID, SPLIT_COLOR, phone, card, chip, button, link, split_bar, wrap, ic_check, ic_shield,
                 ic_spinner, ic_return, ic_clock, ic_cup, ic_bolt, ic_key)

TH_VARIANTS = {'NC-02', 'NC-05', 'NC-06', 'NC-07'}


def L(lang, en, th):
    return th if lang == 'th' else en


def nm(base, lang):
    return base + '-th' if lang == 'th' else base


def to(base, lang):
    """Next frame in the same language when that variant exists."""
    return base + '-th' if (lang == 'th' and base in TH_VARIANTS) else base


def lang_toggle(d, base, lang, y=118):
    """EN <-> TH switch; also what makes the -th variants reachable."""
    label = 'English' if lang == 'th' else 'ไทย'
    w = chip(d, 374, y, label, 'outline', h=28, size=12, anchor='end', pad=12, id='language-toggle')
    d.hotspot(base if lang == 'th' else base + '-th', 374 - w, y, w, 28)


# ------------------------------------------------------------------ NC-01
def nc01():
    d = phone('NC-01', 'Menu')
    x = 16
    for t, k in (('All', 'ink'), ('Coffee', 'outline'), ('Bakery', 'outline')):
        x += chip(d, x, 160, t, k, h=32, size=13, pad=16, id='category-chip') + 8
    items = [('Iced latte', 'Double shot, fresh milk', '3.50', '#DCEFE7', True),
             ('Butter croissant', 'Baked this morning', '1.50', '#FBEBCB', True),
             ('Americano', 'Hot or iced', '3.00', '#E4E7EE', False),
             ('Matcha latte', 'Ceremonial grade', '4.50', '#E3F1D9', False)]
    y = 208
    for name, desc, price, tint, inbill in items:
        card(d, 16, y, 358, 92, id='product-card', r=16)
        d.rect(28, y + 12, 68, 68, fill=tint, rx=12)
        ic_cup(d, 60, y + 46, 15, C['ink'], sw=2)
        d.text(108, y + 36, name, 16, 600)
        d.text(108, y + 56, desc, 12, 400, C['muted'])
        d.text(108, y + 78, price + ' tUSD', 14, 700)
        if inbill:
            chip(d, 358, y + 14, '1 in bill', 'mint', h=22, size=11, anchor='end', pad=9, id='in-bill-chip')
        d.circle(338, y + 62, 18, fill=C['ink'] if not inbill else C['mint'])
        d.line(330, y + 62, 346, y + 62, C['onink'] if not inbill else C['ink'], 2.4, cap='round')
        d.line(338, y + 54, 338, y + 70, C['onink'] if not inbill else C['ink'], 2.4, cap='round')
        y += 104
    d.g('cart-bar')
    d.rect(16, 732, 358, 64, fill=C['ink'], rx=32)
    d.text(40, 761, '2 items', 12, 400, C['oninkmuted'])
    d.text(40, 781, '5.00 tUSD', 16, 700, C['onink'])
    d.text(350, 770, 'View bill →', 15, 700, C['mint'], anchor='end')
    d.end()
    d.hotspot('NC-02', 16, 732, 358, 64)
    return d


# ------------------------------------------------------------------ NC-02
def nc02(lang='en'):
    d = phone(nm('NC-02', lang), L(lang, 'Your bill', 'บิลของคุณ'), back='NC-01')
    lang_toggle(d, 'NC-02', lang)
    card(d, 16, 160, 358, 148, id='bill-card', r=16)
    rows = [(L(lang, 'Iced latte', 'ลาเต้เย็น'), '3.50'), (L(lang, 'Butter croissant', 'ครัวซองต์เนย'), '1.50')]
    y = 194
    for t, a in rows:
        d.text(32, y, t, 15, 400)
        d.text(358, y, a, 15, 600, anchor='end')
        y += 30
    d.line(32, y - 10, 358, y - 10, C['line'])
    d.text(32, y + 24, L(lang, 'Total', 'รวม'), 15, 700)
    d.text(358, y + 26, '5.00 tUSD', 22, 700, anchor='end')

    card(d, 16, 324, 358, 352, id='split-card', r=16)
    d.text(32, 358, L(lang, 'Where your money goes', 'เงินของคุณไปไหน'), 17, 700)
    split_bar(d, 32, 376, 326, 18)
    pay = [('owner', L(lang, 'Orbit Café (owner)', 'Orbit Café (เจ้าของร้าน)'),
            L(lang, 'Keeps the café running', 'ค่าดำเนินงานของร้าน'), '3.55'),
           ('tips', L(lang, 'Mai and Ton, on shift now', 'ใหม่และต้น ที่อยู่กะตอนนี้'),
            L(lang, 'Tips and wage share', 'ทิปและส่วนแบ่งค่าแรง'), '0.50'),
           ('tax', L(lang, 'Tax reserve', 'เงินกันไว้จ่ายภาษี'), L(lang, 'Set aside automatically', 'กันไว้ให้อัตโนมัติ'), '0.35'),
           ('supplier', L(lang, 'Milk Farm Co-op invoice', 'ใบแจ้งหนี้สหกรณ์นม'),
            L(lang, 'Pays the milk supplier', 'จ่ายให้ผู้ส่งนม'), '0.60')]
    y = 430
    for k, t, s, a in pay:
        d.rect(32, y - 11, 12, 12, fill=SPLIT_COLOR[k], rx=3)
        d.text(54, y, t, 14, 600, C['ink'], maxw=236)
        d.text(54, y + 19, s, 12, 400, C['muted'], maxw=236)
        d.text(358, y, a, 15, 700, anchor='end')
        y += 52
    d.line(32, y - 16, 358, y - 16, C['line'])
    cap = L(lang, ['Split by the bill\'s contract in the same second', 'you pay.'],
            ['สัญญาของบิลแบ่งเงินให้ทุกคน', 'ในวินาทีเดียวกับที่คุณจ่าย'])
    d.text(32, y + 8, cap, 12, 400, C['muted'], lh=17, maxw=326)

    button(d, 16, 696, 358, 52, L(lang, 'Pay 5.00 tUSD', 'จ่าย 5.00 tUSD'), 'primary', target='NC-03', id='pay-button',
           size=16)
    ic_bolt(d, 42, 774, 7, C['minttext'])
    d.text(56, 779, L(lang, 'No NEAR needed · the café pays the network fee',
                      'ไม่ต้องมี NEAR · ร้านจ่ายค่าธรรมเนียมเครือข่ายให้'), 12, 600, C['minttext'], maxw=318)
    return d


# ------------------------------------------------------------------ NC-03
def nc03():
    d = phone('NC-03', 'Choose how to pay', back='NC-02')
    opts = [('NEAR wallet', 'Gasless', 'mint', ['No NEAR needed · the café pays the', 'network fee. Meteor or Intear on testnet.'],
             'NC-04', ic_bolt),
            ('Demo wallet (testnet)', 'For judges', 'amber', ['A labelled test customer with test', 'money. Same contract, same checks.'],
             'NC-04', ic_key),
            ('Another chain', 'Mainnet preview · not executed', 'grey', ['See what a Base, Solana or Tron', 'wallet would pay for this bill.'],
             'NC-08', ic_return)]
    y = 164
    for t, ch, kind, lines, tgt, ic in opts:
        card(d, 16, y, 358, 132, id='pay-option', r=16)
        d.circle(48, y + 38, 20, fill=C['grey'])
        if ic is ic_return:
            ic(d, 48, y + 38, 18, C['ink'])
        else:
            ic(d, 48, y + 38, 9, C['ink'])
        d.text(80, y + 34, t, 16, 700)
        chip(d, 80, y + 44, ch, kind, h=22, size=11, pad=9, id='option-chip')
        d.text(80, y + 92, lines, 12, 400, C['muted'], lh=17, maxw=250)
        d.path('M%d %d l8 8 l-8 8' % (346, y + 58), stroke=C['muted'], sw=2)
        d.hotspot(tgt, 16, y, 358, 132)
        y += 144
    d.rect(16, 600, 358, 92, fill=C['amberbg'], rx=16)
    ic_clock(d, 42, 632, 9, C['ambertext'])
    d.text(60, 637, 'Pay the exact amount', 14, 700, C['ambertext'])
    d.text(34, 660, ['Anything else bounces back to you by itself.', 'This bill expires in 4:32.'], 12, 400, C['ambertext'],
           lh=17, maxw=322)
    d.line(16, 716, 374, 716, C['line'])
    d.text(16, 748, 'Bill ' + BILL_ID, 13, 600, C['muted'])
    d.text(374, 750, '5.00 tUSD', 20, 700, anchor='end')
    d.text(16, 780, 'Paid to ' + ACCT['bills'], 12, 400, C['muted'])
    return d


# ------------------------------------------------------------------ NC-04
def nc04():
    d = phone('NC-04', 'Approve in your wallet', back='NC-03')
    chip(d, 374, 118, 'concept', 'amber', h=28, size=12, anchor='end', pad=12, id='concept-chip')
    d.rect(16, 164, 358, 440, fill=C['card'], rx=20, stroke=C['muted'], sw=2, dash='8 6', id='wallet-sheet')
    d.text(195, 196, 'Wallet window · concept', 12, 700, C['muted'], anchor='middle')
    d.text(195, 214, 'Not a real wallet\'s screen. Drawn as a placeholder.', 11, 400, C['muted'], anchor='middle')
    d.line(32, 230, 358, 230, C['line'])
    d.text(195, 280, '5.00 tUSD', 34, 700, anchor='middle')
    d.text(195, 304, 'exactly · nothing more is taken', 12, 400, C['muted'], anchor='middle')
    rows = [('To', ACCT['bills']), ('For', 'Bill ' + BILL_ID + ' · Orbit Café'), ('Network fee', 'Paid by Orbit Café'),
            ('You need', 'No NEAR')]
    y = 348
    for k, v in rows:
        d.text(40, y, k, 12, 600, C['muted'])
        d.text(350, y, v, 13, 600, C['ink'], anchor='end', maxw=230)
        d.line(40, y + 14, 350, y + 14, C['line'])
        y += 40
    button(d, 40, 516, 196, 52, 'Approve', 'primary', target='NC-05', id='approve-button', size=16)
    button(d, 248, 516, 102, 52, 'Reject', 'outline', target='NC-03', id='reject-button')
    d.rect(16, 620, 358, 64, fill=C['mintbg'], rx=16)
    ic_shield(d, 42, 652, 10, C['minttext'])
    d.text(62, 647, ['You only sign. The café\'s relayer sends it,', 'and it can only send this one payment.'], 12, 600,
           C['minttext'], lh=17, maxw=300)
    w = d.text(195, 736, 'Demo: send a wrong amount →', 13, 600, C['red'], anchor='middle')
    d.hotspot('NC-07', 195 - w / 2 - 6, 716, w + 12, 32)
    d.text(195, 760, 'Shows the payment bouncing back', 11, 400, C['muted'], anchor='middle')
    return d


# ------------------------------------------------------------------ NC-05
def nc05(lang='en'):
    d = phone(nm('NC-05', lang), None, back='NC-04')
    lang_toggle(d, 'NC-05', lang)
    cx, cy, r = 195, 236, 62
    d.circle(cx, cy, r, stroke=C['amberbg'], sw=10, id='countdown-track')
    d.path('M%s %s A%s %s 0 1 1 %s %s' % (cx, cy - r, r, r, cx - r * 0.59, cy - r * 0.81), stroke=C['amber'], sw=10,
           id='countdown-arc')
    d.text(cx, cy + 12, '1:48', 34, 700, anchor='middle', id='countdown')
    d.text(195, 348, L(lang, 'Paid into the bill', 'ชำระเข้าบิลแล้ว'), 24, 700, anchor='middle')
    d.text(195, 378, L(lang, 'Waiting for the café\'s screen to confirm', 'กำลังรอจอของร้านยืนยัน'), 15, 400, C['muted'],
           anchor='middle', maxw=358)
    chip(d, 195, 396, L(lang, 'Refunds itself in 2:00 if it doesn\'t', 'ถ้าไม่ยืนยัน เงินคืนเองใน 2:00'), 'amber', h=30,
         size=13, anchor='middle', pad=14, id='refund-chip')

    card(d, 16, 452, 358, 212, id='steps-card', r=16)
    steps = [('done', L(lang, 'Payment is final on NEAR', 'การชำระเสร็จสมบูรณ์บน NEAR แล้ว'), '9xQe…SAMPLE ↗'),
             ('now', L(lang, 'The table screen is checking the chain', 'จอที่โต๊ะกำลังตรวจกับเชน'),
              L(lang, 'It asks NEAR itself, not our server', 'เครื่องถาม NEAR เอง ไม่ได้ถามเซิร์ฟเวอร์')),
             ('next', L(lang, 'Split to everyone on the bill', 'แบ่งเงินให้ทุกคนในบิล'),
              L(lang, 'Happens the moment the screen signs', 'เกิดขึ้นทันทีที่เครื่องเซ็น'))]
    y = 490
    for st, t, s in steps:
        if st == 'done':
            ic_check(d, 44, y - 2, 12, C['ink'], bg=C['mint'])
        elif st == 'now':
            ic_spinner(d, 44, y - 2, 20, C['amber'], C['amberbg'])
        else:
            d.circle(44, y - 2, 11, stroke=C['line'], sw=2)
        d.text(68, y, t, 14, 600, C['ink'] if st != 'next' else C['muted'], maxw=290)
        d.text(68, y + 19, s, 12, 600 if st == 'done' else 400, C['minttext'] if st == 'done' else C['muted'], maxw=290)
        y += 62
    d.hotspot(to('NC-06', lang), 16, 452, 358, 212)
    w = d.text(195, 708, L(lang, 'Demo: the screen confirms →', 'เดโม: จอยืนยันแล้ว →'), 13, 600, C['minttext'],
               anchor='middle')
    d.hotspot(to('NC-06', lang), 195 - w / 2 - 6, 688, w + 12, 32)
    w = d.text(195, 752, L(lang, 'Demo: the screen never confirms →', 'เดโม: จอไม่ยืนยันเลย →'), 13, 600, C['red'],
               anchor='middle')
    d.hotspot(to('NC-07', lang), 195 - w / 2 - 6, 732, w + 12, 32)
    return d


# ------------------------------------------------------------------ NC-06
def nc06(lang='en'):
    d = phone(nm('NC-06', lang), None)
    lang_toggle(d, 'NC-06', lang)
    ic_check(d, 195, 196, 40, C['ink'], bg=C['mint'])
    d.text(195, 280, L(lang, 'Paid · 5.00 tUSD', 'จ่ายแล้ว · 5.00 tUSD'), 26, 700, anchor='middle')
    d.text(195, 306, L(lang, 'Witnessed by the table screen at 10:42:07', 'จอที่โต๊ะเป็นพยานเมื่อ 10:42:07'), 13, 400,
           C['muted'], anchor='middle')
    card(d, 16, 336, 358, 340, id='receipt-card', r=16)
    d.text(32, 370, L(lang, 'Your payment paid everyone at once', 'เงินของคุณจ่ายให้ทุกคนพร้อมกัน'), 15, 700, maxw=326)
    split_bar(d, 32, 386, 326, 14)
    pay = [('owner', L(lang, 'Orbit Café (owner)', 'Orbit Café (เจ้าของร้าน)'), '3.55'),
           ('tips', L(lang, 'Mai and Ton, on shift', 'ใหม่และต้น ที่อยู่กะ'), '0.50'),
           ('tax', L(lang, 'Tax reserve', 'เงินกันไว้จ่ายภาษี'), '0.35'),
           ('supplier', L(lang, 'Milk Farm Co-op invoice', 'ใบแจ้งหนี้สหกรณ์นม'), '0.60')]
    y = 436
    for k, t, a in pay:
        d.rect(32, y - 11, 12, 12, fill=SPLIT_COLOR[k], rx=3)
        d.text(54, y, t, 14, 600, C['ink'], maxw=230)
        d.text(358, y, a, 15, 700, anchor='end')
        y += 40
    d.line(32, y - 14, 358, y - 14, C['line'])
    d.text(32, y + 14, L(lang, 'Total', 'รวม'), 14, 700)
    d.text(358, y + 14, '5.00 tUSD', 16, 700, anchor='end')
    d.text(32, y + 48, L(lang, 'One transaction on NEAR', 'ธุรกรรมเดียวบน NEAR'), 12, 400, C['muted'])
    d.text(358, y + 48, '6dWm…SAMPLE ↗', 12, 600, C['minttext'], anchor='end')
    button(d, 16, 700, 358, 52, L(lang, 'Back to menu', 'กลับไปที่เมนู'), 'dark', target='NC-01', id='menu-button')
    d.text(195, 780, L(lang, 'Test money on NEAR testnet', 'เงินทดสอบบน NEAR testnet'), 12, 400, C['muted'],
           anchor='middle')
    return d


# ------------------------------------------------------------------ NC-07
def nc07(lang='en'):
    d = phone(nm('NC-07', lang), None)
    lang_toggle(d, 'NC-07', lang)
    ic_return(d, 195, 196, 40, C['onink'], bg=C['red'])
    d.text(195, 280, L(lang, 'Your money came back', 'เงินของคุณกลับมาแล้ว'), 24, 700, anchor='middle')
    d.text(195, 306, L(lang, 'Nothing was taken.', 'ไม่มีการหักเงิน'), 14, 400, C['muted'], anchor='middle')
    card(d, 16, 332, 358, 168, id='reason-card', r=16)
    d.text(32, 366, L(lang, 'What happened', 'เกิดอะไรขึ้น'), 15, 700)
    d.text(32, 392, L(lang, 'You sent 4.00 tUSD. The bill is 5.00 tUSD.', 'คุณส่ง 4.00 tUSD แต่บิลคือ 5.00 tUSD'), 14, 600,
           C['red'], maxw=326)
    d.text(32, 418, L(lang, ['The bill\'s contract refused it, and the token', 'returned 4.00 tUSD in the same transaction.'],
                      ['สัญญาของบิลไม่รับยอดนี้ และเหรียญคืน', '4.00 tUSD เข้ากระเป๋าคุณในธุรกรรมเดียวกัน']), 13, 400,
           C['muted'], lh=19, maxw=326)
    d.text(32, 478, '8wQn…SAMPLE ↗', 12, 600, C['minttext'])
    card(d, 16, 516, 358, 160, id='rules-card', r=16)
    d.text(32, 550, L(lang, 'Money also returns by itself when', 'เงินคืนเองในกรณีเหล่านี้ด้วย'), 15, 700, maxw=326)
    rules = [L(lang, 'The bill has expired', 'บิลหมดอายุแล้ว'), L(lang, 'The bill was already paid', 'บิลถูกจ่ายไปแล้ว'),
             L(lang, 'The café\'s screen does not confirm in 2:00', 'จอของร้านไม่ยืนยันภายใน 2:00')]
    y = 582
    for rl in rules:
        ic_return(d, 42, y - 4, 20, C['red'])
        d.text(62, y, rl, 13, 400, C['ink'], maxw=296)
        y += 30
    button(d, 16, 700, 358, 52, L(lang, 'Back to the bill', 'กลับไปที่บิล'), 'dark', target=to('NC-02', lang),
           id='bill-button')
    d.text(195, 780, L(lang, 'Test money on NEAR testnet', 'เงินทดสอบบน NEAR testnet'), 12, 400, C['muted'],
           anchor='middle')
    return d


# ------------------------------------------------------------------ NC-08
def nc08():
    d = phone('NC-08', 'Pay from another chain', back='NC-03')
    chip(d, 16, 156, 'Mainnet preview · not executed', 'amber', h=26, size=12, id='preview-chip')
    card(d, 16, 196, 358, 96, id='receive-card', r=16, fill=C['ink'], stroke=C['ink'])
    d.text(32, 228, 'The café receives exactly', 12, 600, C['oninkmuted'])
    d.text(32, 266, '5.00', 30, 700, C['onink'])
    d.text(104, 266, 'USDC on NEAR', 14, 600, C['oninkmuted'])
    d.text(16, 326, 'You would pay', 13, 600, C['muted'])
    opts = [('USDC on Base', '5.01', 'about 35 s', True), ('USDC on Solana', '5.01', 'about 40 s', False),
            ('USDT on Tron', '5.02', 'about 60 s', False)]
    y = 340
    for t, a, s, sel in opts:
        card(d, 16, y, 358, 72, id='chain-option', r=16, stroke=C['mint'] if sel else C['line'])
        d.circle(44, y + 36, 10, stroke=C['mint'] if sel else C['line'], sw=2)
        if sel:
            d.circle(44, y + 36, 5, fill=C['mint'])
        d.text(68, y + 32, t, 15, 600)
        d.text(68, y + 52, s, 12, 400, C['muted'])
        d.text(358, y + 42, a, 18, 700, anchor='end')
        y += 84
    d.rect(16, 600, 358, 104, fill=C['grey'], rx=16)
    d.text(32, 630, 'What you are looking at', 13, 700)
    d.text(32, 652, ['A live dry quote from NEAR Intents. Nothing', 'is sent. Intents runs on mainnet only, so the',
                     'testnet demo stops at this preview.'], 12, 400, C['muted'], lh=17, maxw=326)
    button(d, 16, 724, 358, 52, 'Back to payment options', 'outline', target='NC-03', id='back-button')
    return d


ALL = [nc01, lambda: [nc02('en'), nc02('th')], nc03, nc04, lambda: [nc05('en'), nc05('th')],
       lambda: [nc06('en'), nc06('th')], lambda: [nc07('en'), nc07('th')], nc08]
