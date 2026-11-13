# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
"""The route table of near-hackathon/PLAN_TH.md section 8, as data. The builder asserts every edge listed here
exists as a prototype link in the FigCraft document, and writes handoff/screen-map.json from it."""

PAGES = ['00 · Flow', '10 · Merchant', '20 · Customer', '30 · Staff', '40 · BitPOS Mini']
START = 'N00-flow-map'

# frame -> (page, title, (w, h), entries, destinations, planned runtime route)
POS = 'POS web app (near-pos) → tab "NEAR · Living Bill" → '
ROUTES = {
    'N00-flow-map': ('00 · Flow', 'Flow map of every screen', (1600, 1000), [], [], 'design only'),
    'NM-01': ('10 · Merchant', 'Overview: accounts, balances, today\'s money flow', (1440, 1000), ['N00-flow-map'],
              ['NM-02', 'NM-03', 'NM-04', 'NM-05', 'NM-06', 'NM-07', 'NM-08', 'NM-09', 'NM-10', 'NM-11'], POS + 'Overview'),
    'NM-02': ('10 · Merchant', 'Split recipe', (1440, 1000), ['NM-01'], ['NM-01', 'NM-09'], POS + 'Split recipe'),
    'NM-03': ('10 · Merchant', 'Team & shifts (payroll by the cup)', (1440, 1000), ['NM-01'], ['NS-01'], POS + 'Team & shifts'),
    'NM-04': ('10 · Merchant', 'Suppliers & invoices', (1440, 1000), ['NM-01'], ['NM-05'], POS + 'Suppliers'),
    'NM-05': ('10 · Merchant', 'Invoice detail', (1440, 1000), ['NM-04'], ['NM-04', 'NM-07'], POS + 'Suppliers → invoice'),
    'NM-06': ('10 · Merchant', 'Ledger of bills + CSV', (1440, 1000), ['NM-01'], ['NM-07'], POS + 'Ledger'),
    'NM-07': ('10 · Merchant', 'Evidence timeline of one bill', (1440, 1000), ['NM-06'], ['NM-06'], POS + 'Ledger → bill'),
    'NM-08': ('10 · Merchant', 'Devices & witness', (1440, 1000), ['NM-01'], ['ND-07'], POS + 'Devices & witness'),
    'NM-09': ('10 · Merchant', 'Café CFO', (1440, 1000), ['NM-01'], ['NM-10'], POS + 'Café CFO'),
    'NM-10': ('10 · Merchant', 'Review a CFO proposal', (1440, 1000), ['NM-09'], ['NM-02'], POS + 'Café CFO → proposal'),
    'NM-11': ('10 · Merchant', 'First-time setup', (1440, 1000), ['NM-01'], ['NM-01'], POS + 'Setup'),
    'NC-01': ('20 · Customer', 'Table menu', (390, 844), ['N00-flow-map'], ['NC-02'], 'near-pay /table/<token>'),
    'NC-02': ('20 · Customer', 'Bill + where your money goes', (390, 844), ['NC-01'], ['NC-03'], 'near-pay /pay/<token>'),
    'NC-03': ('20 · Customer', 'Choose how to pay', (390, 844), ['NC-02'], ['NC-04', 'NC-08'], 'near-pay /pay/<token> (method step)'),
    'NC-04': ('20 · Customer', 'Approve in the wallet (concept)', (390, 844), ['NC-03'], ['NC-05', 'NC-07'],
              'wallet window (not ours) / demo wallet button'),
    'NC-05': ('20 · Customer', 'Waiting for the table screen to witness', (390, 844), ['NC-04'], ['NC-06', 'NC-07'],
              'near-pay /pay/<token> (state ESCROW)'),
    'NC-06': ('20 · Customer', 'Paid + split receipt', (390, 844), ['NC-05'], ['NC-01'], 'near-pay /pay/<token> (state SETTLED)'),
    'NC-07': ('20 · Customer', 'Money bounced back', (390, 844), ['NC-04', 'NC-05'], ['NC-02'],
              'near-pay /pay/<token> (state BOUNCED / REFUNDED)'),
    'NC-08': ('20 · Customer', 'Pay from another chain (preview)', (390, 844), ['NC-03'], ['NC-03'],
              'near-pay /pay/<token> (1Click dry quote panel)'),
    'NS-01': ('30 · Staff', 'My earnings', (390, 844), ['NM-03'], ['NS-02'], 'near-pay /near/staff/<token>'),
    'NS-02': ('30 · Staff', 'Send money home (preview)', (390, 844), ['NS-01'], ['NS-01'],
              'near-pay /near/staff/<token> (1Click dry quote panel)'),
    'ND-01': ('40 · BitPOS Mini', 'Mini: idle', (480, 320), ['NM-08', 'ND-04'], ['ND-02'], 'firmware screen=idle · /terminal/<token>'),
    'ND-02': ('40 · BitPOS Mini', 'Mini: pay QR', (480, 320), ['NM-08', 'ND-01'], ['ND-03'], 'firmware screen=qr · /terminal/<token>'),
    'ND-03': ('40 · BitPOS Mini', 'Mini: checking the chain', (480, 320), ['NM-08', 'ND-02'], ['ND-04', 'ND-05'],
              'firmware screen=checking · /terminal/<token>'),
    'ND-04': ('40 · BitPOS Mini', 'Mini: paid + split', (480, 320), ['NM-08', 'ND-03'], ['ND-01'], 'firmware screen=paid · /terminal/<token>'),
    'ND-05': ('40 · BitPOS Mini', 'Mini: refunded', (480, 320), ['NM-08', 'ND-03'], ['ND-01'], 'firmware screen=refunded · /terminal/<token>'),
    'ND-06': ('40 · BitPOS Mini', 'Mini: offline', (480, 320), ['NM-08'], ['ND-01'], 'firmware screen=offline · /terminal/<token>'),
    'ND-07': ('40 · BitPOS Mini', 'Mini: setup (device key)', (480, 320), ['NM-08'], ['ND-01'], 'firmware screen=setup'),
}
# N00 links to every base frame.
ROUTES['N00-flow-map'] = ROUTES['N00-flow-map'][:4] + ([k for k in ROUTES if k != 'N00-flow-map'],) + ROUTES['N00-flow-map'][5:]

# Thai variants: entered from the English frame's language switch; same exits (Thai where a Thai frame exists).
TH = ['NC-02', 'NC-05', 'NC-06', 'NC-07', 'ND-02', 'ND-04']
for _b in TH:
    _p, _t, _s, _e, _d, _r = ROUTES[_b]
    ROUTES[_b + '-th'] = (_p, _t + ' (Thai)', _s, [_b], [(x + '-th' if x in TH else x) for x in _d] + [_b], _r + ' · lang=th')
    ROUTES[_b] = (_p, _t, _s, _e, _d + [_b + '-th'], _r)

ORDER = ['N00-flow-map'] + ['NM-%02d' % i for i in range(1, 12)] + \
        ['NC-01', 'NC-02', 'NC-02-th', 'NC-03', 'NC-04', 'NC-05', 'NC-05-th', 'NC-06', 'NC-06-th', 'NC-07', 'NC-07-th', 'NC-08',
         'NS-01', 'NS-02', 'ND-01', 'ND-02', 'ND-02-th', 'ND-03', 'ND-04', 'ND-04-th', 'ND-05', 'ND-06', 'ND-07']
assert set(ORDER) == set(ROUTES), 'ORDER and ROUTES disagree'

FLOWS = [('00 · Flow', 'Start here: flow map', 'N00-flow-map', 'Every screen of the NEAR edition, one click away.'),
         ('10 · Merchant', 'Merchant: Living Bill hub', 'NM-01', 'Overview → recipe → team → suppliers → ledger → devices → CFO.'),
         ('20 · Customer', 'Customer: pay a Living Bill', 'NC-01', 'Menu → bill → pay → witness → split receipt, or bounce.'),
         ('30 · Staff', 'Staff: payroll by the cup', 'NS-01', 'Earnings arrive per bill; send-home preview.'),
         ('40 · BitPOS Mini', 'Mini: witness loop', 'ND-01', 'Idle → QR → checking the chain → paid + split → idle.')]
