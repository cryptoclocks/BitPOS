# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
"""Staff phone screens NS-01, NS-02 (390x844)."""
from lib import C, ACCT, BILL_ID, phone, card, chip, button, ic_bolt, arrow


def ns01():
    d = phone('NS-01', 'My earnings', back='NM-03', sub='Mai · Orbit Café')
    card(d, 16, 160, 358, 164, id='earnings-card', r=20, fill=C['ink'], stroke=C['ink'])
    d.text(36, 196, 'Today', 13, 600, C['oninkmuted'])
    chip(d, 354, 178, 'Live', 'darkmint', h=24, size=11, anchor='end', pad=10, dot=C['mint'], id='live-chip')
    d.text(36, 256, '9.00', 48, 700, C['onink'])
    d.text(152, 256, 'tUSD', 16, 600, C['oninkmuted'])
    d.text(36, 292, 'On shift since 08:02 · share of 36 bills', 13, 400, C['oninkmuted'])

    card(d, 16, 340, 358, 264, id='feed-card', r=16)
    d.text(32, 374, 'As it happens', 15, 700)
    rows = [(BILL_ID, '10:42'), ('B-7K2M8P', '10:37'), ('B-7K2M7N', '10:31'), ('B-7K2M6M', '10:24')]
    y = 408
    for b, t in rows:
        d.circle(44, y - 4, 12, fill=C['mintbg'])
        d.line(44, y - 9, 44, y + 1, C['minttext'], 2, cap='round')
        d.line(39, y - 4, 49, y - 4, C['minttext'], 2, cap='round')
        d.text(68, y, 'Bill ' + b, 14, 600)
        d.text(68, y + 18, t + ' · in the bill\'s own receipt ↗', 12, 400, C['muted'])
        d.text(358, y + 2, '+0.25', 16, 700, C['minttext'], anchor='end')
        d.line(32, y + 32, 358, y + 32, C['line'])
        y += 50
    d.rect(16, 620, 358, 84, fill=C['mintbg'], rx=16)
    ic_bolt(d, 40, 648, 8, C['minttext'])
    d.text(56, 653, 'No payday to wait for', 14, 700, C['minttext'])
    d.text(34, 674, ['Each share lands in your own NEAR account.', 'You never need NEAR for fees.'], 12, 400,
           C['minttext'], lh=17, maxw=322)
    d.text(16, 732, ACCT['mai'], 12, 600, C['muted'])
    button(d, 16, 748, 358, 52, 'Send home (preview)', 'outline', target='NS-02', id='send-home-button')
    return d


def ns02():
    d = phone('NS-02', 'Send money home', back='NS-01', sub='Mai · Orbit Café')
    chip(d, 16, 156, 'Mainnet preview · not executed', 'amber', h=26, size=12, id='preview-chip')
    card(d, 16, 196, 358, 104, id='send-card', r=16)
    d.text(32, 228, 'You send', 12, 600, C['muted'])
    d.text(32, 270, '9.00', 32, 700)
    d.text(112, 270, 'USDC on NEAR', 14, 600, C['muted'])
    d.circle(195, 316, 18, fill=C['ink'])
    arrow(d, [(195, 306), (195, 324)], C['onink'], sw=2, head=6)
    card(d, 16, 332, 358, 104, id='receive-card', r=16, fill=C['ink'], stroke=C['ink'])
    d.text(32, 364, 'Family receives', 12, 600, C['oninkmuted'])
    d.text(32, 406, '8.97', 32, 700, C['onink'])
    d.text(112, 406, 'USDT on Tron', 14, 600, C['oninkmuted'])
    card(d, 16, 452, 358, 172, id='detail-card', r=16)
    rows = [('Route', 'NEAR Intents'), ('Total cost', '0.03'), ('Time', 'about 60 s'),
            ('If it fails', 'Refunded to your NEAR account')]
    y = 486
    for k, v in rows:
        d.text(32, y, k, 13, 400, C['muted'])
        d.text(358, y, v, 13, 600, anchor='end', maxw=230)
        y += 38
    d.rect(16, 640, 358, 76, fill=C['grey'], rx=16)
    d.text(32, 668, ['A live dry quote. Nothing is sent from the', 'demo: Intents runs on mainnet only.'], 12, 400,
           C['muted'], lh=17, maxw=326)
    button(d, 16, 736, 358, 52, 'Back to my earnings', 'outline', target='NS-01', id='back-button')
    return d


ALL = [ns01, ns02]
