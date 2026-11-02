# -*- coding: utf-8 -*-
"""Collectible "Regulars" badge cards (5:7), one per tier, as vector SVG + Metaplex-style metadata JSON.
Output: apps/web/public/loyalty/card-N.svg, metadata badge-N.json (PNG rendered separately by figcraft-cli).
A cute coffee-cup mascot with tier accessories on a layered "foil" card. Generic (no shop name): the shop and level are in the on-chain name."""
import json, math, os, sys
OUT = sys.argv[1]
TIERS = {
 1: dict(name='Regular', th='ประจำ', frame=('#E6A06A', '#A9622D'), glow='#FFD9B8', acc='bean', rank='01'),
 2: dict(name='Gold', th='ทอง', frame=('#FFE9A3', '#D9971A'), glow='#FFF0B8', acc='crown', rank='02'),
 3: dict(name='Platinum', th='แพลตินัม', frame=('#F4F7FF', '#8D9BC0'), glow='#DDE6FF', acc='royal', rank='03'),
}
def star(cx, cy, r, fill, op=1):
    pts = []
    for i in range(8):
        a = math.pi / 4 * i - math.pi / 2; rr = r if i % 2 == 0 else r * 0.28
        pts.append(f'{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}')
    return f'<polygon points="{" ".join(pts)}" fill="{fill}" opacity="{op}"/>'
def svg(n, t):
    f1, f2 = t['frame']
    sp = ''.join(star(x, y, r, '#FFFFFF', o) for x, y, r, o in ((92, 232, 13, .95), (408, 262, 17, .9), (366, 168, 9, .8), (130, 372, 8, .7), (74, 330, 6, .6)))
    if n == 3: sp += star(250, 150, 20, '#FFFFFF', .95) + star(150, 190, 11, '#CFE0FF', .9) + star(352, 214, 12, '#CFE0FF', .9)
    acc = ''
    if t['acc'] == 'bean':
        acc = '<ellipse cx="250" cy="206" rx="22" ry="30" transform="rotate(28 250 206)" fill="#6B3F22"/><path d="M243 184 Q258 206 255 230" stroke="#3E2413" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="243" cy="196" rx="5" ry="9" transform="rotate(28 243 196)" fill="#9A6238" opacity=".7"/>'
    elif t['acc'] in ('crown', 'royal'):
        acc = ('<path d="M198 232 L206 178 L232 208 L250 164 L268 208 L294 178 L302 232 Z" fill="url(#gold)" stroke="#B87A0C" stroke-width="3" stroke-linejoin="round"/>'
               '<rect x="198" y="226" width="104" height="14" rx="6" fill="#E0A21C" stroke="#B87A0C" stroke-width="3"/>'
               '<circle cx="206" cy="178" r="7" fill="#FF6FA8"/><circle cx="250" cy="164" r="8" fill="#6FD6FF"/><circle cx="294" cy="178" r="7" fill="#FF6FA8"/>')
    wings = ''
    if t['acc'] == 'royal':
        for side in (-1, 1):
            wings += (f'<g transform="translate({250 + side * 78} 346) scale({side} 1)">'
                      '<ellipse cx="52" cy="-34" rx="56" ry="17" transform="rotate(-38 52 -34)" fill="#FFFFFF" stroke="#C9D6F2" stroke-width="2.5"/>'
                      '<ellipse cx="66" cy="-4" rx="64" ry="18" transform="rotate(-12 66 -4)" fill="#FFFFFF" stroke="#C9D6F2" stroke-width="2.5"/>'
                      '<ellipse cx="58" cy="30" rx="54" ry="16" transform="rotate(16 58 30)" fill="#F4F7FF" stroke="#C9D6F2" stroke-width="2.5"/></g>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700" viewBox="0 0 500 700" role="img" aria-label="BitPOS Regulars {t['name']} card">
<defs>
 <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{f1}"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".9"/><stop offset="1" stop-color="{f2}"/></linearGradient>
 <linearGradient id="plum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5C1A82"/><stop offset="1" stop-color="#26093B"/></linearGradient>
 <radialGradient id="glow" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="{t['glow']}"/><stop offset=".55" stop-color="#C58BE6"/><stop offset="1" stop-color="#6B2594"/></radialGradient>
 <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1B0"/><stop offset="1" stop-color="#F0B429"/></linearGradient>
 <linearGradient id="cup" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#FFF3E2"/><stop offset="1" stop-color="#F2D7B6"/></linearGradient>
 <linearGradient id="holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6FD6FF" stop-opacity="0"/><stop offset=".35" stop-color="#FF9BD2" stop-opacity=".30"/><stop offset=".5" stop-color="#FFE98A" stop-opacity=".38"/><stop offset=".65" stop-color="#9BFFD0" stop-opacity=".30"/><stop offset="1" stop-color="#6FD6FF" stop-opacity="0"/></linearGradient>
 <clipPath id="card"><rect x="14" y="14" width="472" height="672" rx="34"/></clipPath>
 <clipPath id="art"><rect x="44" y="104" width="412" height="372" rx="22"/></clipPath>
</defs>
<rect x="6" y="10" width="488" height="684" rx="40" fill="#1B0B26" opacity=".35"/>
<rect x="4" y="4" width="492" height="692" rx="40" fill="url(#frame)"/>
<rect x="14" y="14" width="472" height="672" rx="34" fill="url(#plum)"/>
<g clip-path="url(#card)">
 <rect x="44" y="104" width="412" height="372" rx="22" fill="url(#glow)"/>
 <g clip-path="url(#art)">
  <circle cx="250" cy="300" r="190" fill="#FFFFFF" opacity=".12"/><circle cx="250" cy="300" r="130" fill="#FFFFFF" opacity=".12"/>
  {sp}{wings}
  <ellipse cx="250" cy="438" rx="132" ry="22" fill="#2A0A40" opacity=".28"/>
  <ellipse cx="250" cy="426" rx="124" ry="20" fill="#E8D2F2"/><ellipse cx="250" cy="420" rx="124" ry="18" fill="#FFFFFF"/>
  <path d="M176 272 Q176 420 250 420 Q324 420 324 272 Z" fill="url(#cup)" stroke="#E5C9A6" stroke-width="3"/>
  <ellipse cx="250" cy="272" rx="74" ry="20" fill="#7B3F1E"/><ellipse cx="250" cy="270" rx="64" ry="14" fill="#A15C2E"/>
  <path d="M324 300 Q372 296 366 346 Q360 388 318 380" fill="none" stroke="#F2D7B6" stroke-width="16" stroke-linecap="round"/><path d="M324 300 Q372 296 366 346 Q360 388 318 380" fill="none" stroke="#FFF8EC" stroke-width="7" stroke-linecap="round"/>
  <ellipse cx="226" cy="340" rx="12" ry="16" fill="#3B1F12"/><ellipse cx="274" cy="340" rx="12" ry="16" fill="#3B1F12"/><circle cx="222" cy="333" r="4.5" fill="#FFFFFF"/><circle cx="270" cy="333" r="4.5" fill="#FFFFFF"/>
  <path d="M232 372 Q250 394 268 372" fill="none" stroke="#3B1F12" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="200" cy="368" rx="14" ry="9" fill="#FF8FB1" opacity=".6"/><ellipse cx="300" cy="368" rx="14" ry="9" fill="#FF8FB1" opacity=".6"/>
  <path d="M214 256 Q200 226 218 206 Q232 188 220 168" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" opacity=".75"/>
  <path d="M286 256 Q300 230 284 210 Q272 192 284 172" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" opacity=".6"/>
  {acc}
  <path d="M182 288 Q186 360 206 396" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" opacity=".7"/>
 </g>
 <rect x="44" y="104" width="412" height="372" rx="22" fill="none" stroke="url(#frame)" stroke-width="5"/>
 <rect x="-60" y="120" width="620" height="120" fill="url(#holo)" transform="rotate(-24 250 350)"/>
 <rect x="30" y="38" width="440" height="48" rx="24" fill="#FFFFFF" opacity=".1"/>
 <text x="250" y="70" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="26" font-weight="800" letter-spacing="6" fill="#FFFFFF">{t['name'].upper()}</text>
 <rect x="44" y="498" width="412" height="150" rx="20" fill="#FFFFFF" opacity=".08"/>
 <text x="250" y="548" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="34" font-weight="800" fill="#FFD36B" letter-spacing="3">BITPOS REGULARS</text>
 <text x="250" y="582" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="17" fill="#FFFFFF" opacity=".9">Level {n} · {t['name']}</text>
 <rect x="76" y="598" width="348" height="1.5" fill="#FFFFFF" opacity=".25"/>
 <text x="250" y="626" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="13" fill="#FFFFFF" opacity=".75">Non-transferable · Solana devnet · no monetary value</text>
</g>
</svg>
'''
def meta(n, t):
    base = 'https://pay.cashlessthailand.com/loyalty'
    return {'name': f"BitPOS Regulars · {t['name']}", 'symbol': f'REG{n}',
     'description': 'A membership badge from a BitPOS shop for being a regular. It cannot be transferred, has no monetary value, and the shop can take it back after a refund. Solana devnet (test network) only.',
     'image': f'{base}/card-{n}.png', 'external_url': 'https://pay.cashlessthailand.com/loyalty',
     'attributes': [{'trait_type': 'Level', 'value': t['name']}, {'trait_type': 'Rank', 'value': n}, {'trait_type': 'Network', 'value': 'Solana devnet'}, {'trait_type': 'Transferable', 'value': 'No'}, {'trait_type': 'Monetary value', 'value': 'None'}],
     'properties': {'category': 'image', 'files': [{'uri': f'{base}/card-{n}.png', 'type': 'image/png'}]}}
os.makedirs(OUT, exist_ok=True)
for n, t in TIERS.items():
    open(f'{OUT}/card-{n}.svg', 'w').write(svg(n, t))
    open(f'{OUT}/badge-{n}.json', 'w').write(json.dumps(meta(n, t), indent=1, ensure_ascii=False) + '\n')
print('ok')
