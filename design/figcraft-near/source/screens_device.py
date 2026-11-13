# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
"""BitPOS Mini screens ND-01 .. ND-07 (480x320, dark, large type). Thai variants for ND-02 and ND-04."""
from lib import (C, BILL_ID, SPLIT_COLOR_DARK, mini, chip, qr, split_bar, ic_check, ic_spinner, ic_return, ic_key,
                 ic_cup)


def L(lang, en, th):
    return th if lang == 'th' else en


def nm(base, lang):
    return base + '-th' if lang == 'th' else base


def lang_toggle(d, base, lang):
    label = 'EN' if lang == 'th' else 'ไทย'
    w = chip(d, 344, 9, label, 'darkline', h=24, size=11, anchor='end', pad=10, id='language-toggle')
    d.hotspot(base if lang == 'th' else base + '-th', 344 - w, 9, w, 24)


def nd01():
    d = mini('ND-01')
    ic_cup(d, 44, 92, 16, C['mint'], sw=2.4)
    d.text(24, 152, 'Orbit Café', 38, 700, C['onink'])
    d.text(24, 184, 'Scan to order from your seat', 16, 400, C['oninkmuted'])
    chip(d, 24, 206, 'Pay with any NEAR wallet · no NEAR needed', 'darkmint', h=26, size=11, id='hint-chip')
    qr(d, 332, 76, 120, seed=11, id='table-qr', pad=8)
    d.text(392, 226, 'Table menu', 12, 600, C['oninkmuted'], anchor='middle')
    d.text(24, 292, 'Tap the screen to wake a bill', 11, 400, '#6F7B92')
    d.hotspot('ND-02', 0, 50, 480, 216)
    return d


def nd02(lang='en'):
    d = mini(nm('ND-02', lang))
    lang_toggle(d, 'ND-02', lang)
    qr(d, 28, 66, 172, seed=5, id='pay-qr', pad=10)
    x = 232
    d.text(x, 82, L(lang, 'SCAN TO PAY', 'สแกนเพื่อจ่าย'), 13, 700, C['mint'])
    d.text(x, 140, '5.00', 58, 700, C['onink'])
    d.text(x + 130, 140, 'tUSD', 16, 600, C['oninkmuted'])
    d.text(x, 176, L(lang, 'No NEAR needed', 'ไม่ต้องมี NEAR'), 17, 600, C['onink'])
    d.text(x, 198, L(lang, 'The café pays the network fee', 'ร้านจ่ายค่าธรรมเนียมให้'), 13, 400, C['oninkmuted'])
    chip(d, x, 216, L(lang, 'Expires in 4:32', 'หมดอายุใน 4:32'), 'darkamber', h=26, size=12, id='expiry-chip')
    d.text(28, 280, L(lang, 'Bill ', 'บิล ') + BILL_ID + L(lang, ' · exact amount only', ' · ต้องจ่ายยอดพอดี'), 11, 400, '#8A96AD')
    d.hotspot('ND-03', 0, 50, 480, 216)
    return d


def nd03():
    d = mini('ND-03')
    ic_spinner(d, 240, 104, 60, C['amber'], C['ink3'])
    d.text(240, 184, 'Checking NEAR…', 30, 700, C['onink'], anchor='middle')
    d.text(240, 210, 'Asking the chain itself, not the server', 14, 400, C['oninkmuted'], anchor='middle')
    chip(d, 240, 226, 'get_bill → Escrow', 'darkamber', h=26, size=12, anchor='middle', id='rpc-chip')
    d.hotspot('ND-04', 0, 50, 480, 206)
    w = d.text(24, 292, 'Demo: no confirmation in 2:00 →', 11, 600, '#FF9C94')
    d.hotspot('ND-05', 16, 272, w + 16, 30)
    return d


def nd04(lang='en'):
    d = mini(nm('ND-04', lang))
    lang_toggle(d, 'ND-04', lang)
    ic_check(d, 56, 96, 30, C['ink'], bg=C['mint'])
    d.text(102, 104, L(lang, 'PAID', 'จ่ายแล้ว'), 44, 700, C['onink'])
    d.text(456, 86, '5.00', 32, 700, C['mint'], anchor='end')
    d.text(456, 108, 'tUSD', 13, 600, C['oninkmuted'], anchor='end')
    split_bar(d, 24, 142, 432, 14, dark=True)
    rows = [('owner', L(lang, 'Owner', 'เจ้าของร้าน'), '+3.55'), ('tips', L(lang, 'Team', 'ทีมงาน'), '+0.50'),
            ('tax', L(lang, 'Tax', 'ภาษี'), '+0.35'), ('supplier', L(lang, 'Milk', 'ค่านม'), '+0.60')]
    for i, (k, t, a) in enumerate(rows):
        x = 24 + (i % 2) * 224
        y = 192 + (i // 2) * 34
        d.rect(x, y - 12, 12, 12, fill=SPLIT_COLOR_DARK[k], rx=3)
        d.text(x + 22, y, t, 17, 600, C['onink'])
        d.text(x + 208, y, a, 19, 700, C['onink'], anchor='end')
    chip(d, 24, 250, L(lang, 'Witness signed', 'เครื่องเซ็นเป็นพยานแล้ว'), 'darkmint', h=26, size=12, dot=C['mint'],
         id='witness-chip')
    d.text(24, 300, L(lang, 'Read from the chain at 10:42:07', 'อ่านจากเชนเมื่อ 10:42:07'), 11, 400, '#8A96AD')
    d.hotspot('ND-01', 0, 50, 480, 190)
    return d


def nd05():
    d = mini('ND-05')
    ic_return(d, 64, 110, 36, C['onink'], bg=C['red'])
    d.text(118, 106, 'Refunded', 40, 700, C['onink'])
    d.text(118, 136, '5.00 tUSD went back to the customer', 15, 400, C['oninkmuted'])
    d.line(24, 172, 456, 172, C['ink3'])
    d.text(24, 204, 'The bill was not confirmed in time.', 16, 600, C['onink'])
    d.text(24, 228, 'Its contract returned the money by itself.', 14, 400, C['oninkmuted'])
    chip(d, 24, 246, 'Nothing for staff to do', 'darkred', h=26, size=12, id='note-chip')
    d.hotspot('ND-01', 0, 50, 480, 190)
    return d


def nd06():
    d = mini('ND-06')
    d.circle(64, 110, 34, stroke=C['oninkmuted'], sw=3, dash='6 6')
    d.line(50, 110, 78, 110, C['oninkmuted'], 3, cap='round')
    d.text(118, 106, 'Offline', 40, 700, C['onink'])
    d.text(118, 136, 'Payments wait. Nothing is lost.', 15, 400, C['oninkmuted'])
    d.line(24, 172, 456, 172, C['ink3'])
    d.text(24, 204, 'Paid bills stay safe in their contract.', 16, 600, C['onink'])
    d.text(24, 228, 'Without a witness they refund themselves.', 14, 400, C['oninkmuted'])
    chip(d, 24, 246, 'Retrying Wi-Fi…', 'darkamber', h=26, size=12, id='retry-chip')
    d.hotspot('ND-01', 0, 50, 480, 190)
    return d


def nd07():
    d = mini('ND-07', table_label='not assigned')
    qr(d, 28, 66, 150, seed=23, id='key-qr', pad=10)
    x = 212
    d.text(x, 84, 'Set up this screen', 24, 700, C['onink'])
    d.text(x, 116, 'WITNESS KEY', 11, 700, C['oninkmuted'])
    ic_key(d, x + 8, 138, 8, C['mint'])
    d.text(x + 26, 143, 'ed25519:7Hk3…9qPz', 16, 700, C['mint'])
    d.text(x, 168, 'Made in this device.', 13, 400, C['oninkmuted'])
    d.text(x, 186, 'The private half never leaves it.', 13, 400, C['oninkmuted'])
    chip(d, x, 204, 'Firmware 0.5.0-near', 'darkline', h=24, size=11, id='firmware-chip')
    d.text(28, 262, 'Scan this in Devices & witness to register the screen.', 13, 600, C['onink'])
    d.text(28, 292, 'Tap when registered', 11, 400, '#8A96AD')
    d.hotspot('ND-01', 0, 50, 480, 190)
    return d


ALL = [nd01, lambda: [nd02('en'), nd02('th')], nd03, lambda: [nd04('en'), nd04('th')], nd05, nd06, nd07]
