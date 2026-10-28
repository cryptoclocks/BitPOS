#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
"""Maps every sol- POS, pay and state screen (design/figcraft/handoff/screen-map.json, pre-hackathon) to its
meta- counterpart, and lists the meta-only screens. Writes reports/diff-vs-sol.md and .json."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'design/figcraft-meta'
sol = {s['id']: s for s in json.load(open(ROOT / 'design/figcraft/handoff/screen-map.json'))['screens']}
meta = {s['id']: s for s in json.load(open(OUT / 'handoff/screen-map.json'))['screens']}

# kind: same = same page re-themed · changed = same job, Meta behaviour · merged = folded into another page · removed = not in meta-
M = {
 'P01': ('changed', 'MP02', 'ยอดขายแยกตามช่องทาง แตะ / แชท / AI / โต๊ะ / หน้าร้าน'), 'P02': ('changed', 'MP03, MP04', 'เก็บเงินด้วย QR ของ Stripe บน BitPOS Mini'),
 'P03': ('merged', 'MP05', 'บิลรวมอยู่ในศูนย์ออเดอร์'), 'P04': ('same', 'MP06', 'เพิ่มหลักฐาน Stripe และ Muse Spark'), 'P05': ('removed', '', 'ปิดรอบขายไม่อยู่ในขอบเขตเดโม Meta'),
 'P06': ('merged', 'MP10', 'เมนูและสต็อกรวมหน้าเดียว'), 'P07': ('same', 'MP11', 'ราคาเป็น USD หน่วยย่อยสำหรับ Stripe'), 'P08': ('merged', 'MP10', ''),
 'P09': ('removed', '', 'รับเข้าสินค้าไม่อยู่ในขอบเขต'), 'P10': ('removed', '', 'ประวัติรับเข้าไม่อยู่ในขอบเขต'), 'P11': ('removed', '', 'ปรับสต็อกด้วยมือไม่อยู่ในขอบเขต'),
 'P12': ('removed', '', 'แจ้งสินค้าใกล้หมดไม่อยู่ในขอบเขต'), 'P13': ('merged', 'MP10', 'แสดง meta_stock_movements'),
 'P14': ('merged', 'MP18', 'รายงานรวมหน้าเดียว'), 'P15': ('merged', 'MP18', ''), 'P16': ('removed', '', 'ไม่มีรับเข้าสินค้า'), 'P17': ('merged', 'MP18', ''),
 'P18': ('merged', 'MP18', ''), 'P19': ('merged', 'MP18', 'สินค้าขายดี'), 'P20': ('merged', 'MP18', 'ปุ่มส่งออก CSV'), 'P21': ('removed', '', 'ไม่มีซัพพลายเออร์'),
 'P22': ('changed', 'MP15', 'เฉพาะลูกค้าที่ยินยอมใน Messenger ไม่แสดงรหัส Messenger'), 'P23': ('changed', 'MP16', 'มีปุ่มลบข้อมูลลูกค้า'),
 'P24': ('merged', 'MP11', 'หมวดตั้งในหน้าแก้ไขเมนู'), 'P25': ('same', 'MP21', ''), 'P26': ('changed', 'MP17', 'หลักฐาน AI + การแตะ + Stripe แทนประวัติการใช้งาน'),
 'P27': ('removed', '', 'ไม่มีเครื่องพิมพ์ใบเสร็จ ใบเสร็จส่งใน Messenger'), 'P28': ('changed', 'MP20', 'ตั้งค่า Messenger, Stripe, Muse Spark, MCP'),
 'P29': ('changed', 'MP05', 'แยกช่องทาง และจ่ายแล้วจาก Stripe webhook เท่านั้น'), 'P30': ('same', 'MP22', ''), 'P31': ('merged', 'MP06', ''),
 'P32': ('removed', '', 'ไม่มีจัดส่ง/ไรเดอร์ในงาน Meta'), 'P33': ('changed', 'MP13', 'Muse Spark ร่าง + เจ้าของอนุมัติ + Allow All'), 'P34': ('changed', 'MP14', 'ตรวจร่างจาก AI และตั้งขอบเขต Allow All'),
 'P35': ('changed', 'MP09', 'สติกเกอร์ NTAG 424 + ลิงก์จอโต๊ะ + เฟิร์มแวร์ Meta'), 'P36': ('removed', '', 'ร้านเดโมมีสาขาเดียว'), 'P37': ('same', 'MP07', 'คืนเงินผ่าน Stripe'),
 'P38': ('changed', 'MP19', 'ยอดจาก Stripe แทนการโอนคริปโต'), 'P39': ('same', 'MP01', 'ทางลัดเดโม เจ้าของ/ผู้จัดการ/พนักงาน'), 'P40': ('removed', '', 'ไม่มีไรเดอร์'),
 'P41': ('changed', 'MP07', 'คืนเต็มจำนวนก่อนส่งมอบเท่านั้น'),
 'W01': ('same', 'C18', 'เพิ่มทางเลือกแตะ NFC'), 'W02': ('same', 'C19', ''), 'W03': ('same', 'C20', ''), 'W04': ('merged', 'C21', 'ตะกร้ารวมกับหน้าตรวจรายการ'), 'W05': ('same', 'C21', ''),
 'W06': ('changed', 'C22', 'Stripe อย่างเดียว ตัดกระเป๋าคริปโต'), 'W07': ('removed', '', 'คริปโต (Phantom / Solana)'), 'W08': ('removed', '', 'PromptPay ยังไม่เปิดในงานนี้'),
 'W09': ('same', 'C07', ''), 'W10': ('merged', 'C07', 'ไม่มีขั้นยืนยันบนบล็อกเชน'), 'W11': ('same', 'C06', ''), 'W12': ('same', 'C23', ''), 'W13': ('merged', 'C06, B11', 'รหัสรับสินค้าอยู่หน้าจ่ายแล้วและบน Mini'),
 'W14': ('same', 'C24', ''), 'W15': ('same', 'C25', 'ข้อความจาก Stripe'), 'W16': ('merged', 'C07, C27', ''), 'W17': ('same', 'C26', ''), 'W18': ('merged', 'C27', ''),
 'W19': ('same', 'CD02', ''), 'W20': ('removed', '', 'สั่งรวมโต๊ะยังไม่ทำในงาน Meta'), 'W21': ('merged', 'C27', ''), 'W22': ('changed', 'C04', 'โปรเฉพาะคนจาก Muse Spark แทนคูปอง'),
 'S01': ('removed', '', 'ตะกร้าว่างเป็นสถานะในหน้าเมนู'), 'S02': ('removed', '', 'ไม่มีค้นหาร้าน (ร้านเดียว)'), 'S03': ('merged', 'C27', ''), 'S04': ('removed', '', 'ไม่ใช้ GPS'),
 'S05': ('removed', '', 'ไม่ใช้ GPS'), 'S06': ('removed', '', 'ร้านเดโมเปิดตลอด'), 'S07': ('same', 'S05', ''), 'S08': ('merged', 'C07', ''), 'S09': ('same', 'S06', ''),
 'S10': ('removed', '', 'ไม่มีไรเดอร์'), 'S11': ('same', 'MPM01', ''), 'S12': ('same', 'MPM02', ''), 'S13': ('removed', '', 'ยังไม่มีโหมดมืดใน meta-'), 'S14': ('removed', '', 'ไม่มีแอปไรเดอร์'),
 'E01': ('removed', '', 'ข้อความสองภาษาอยู่ในหน้าเดียวกันแล้ว'), 'E02': ('removed', '', 'ข้อความสองภาษาอยู่ในหน้าเดียวกันแล้ว'),
 'WD01': ('changed', 'CD02', 'Stripe แทนกระเป๋าเงิน'), 'WD02': ('same', 'CD01', ''), 'WD03': ('removed', '', 'คริปโต'), 'WD04': ('removed', '', 'คริปโต (เลือก USDG/USDC/USDT)'),
 'WD05': ('removed', '', 'คริปโต'), 'WD06': ('removed', '', 'คริปโต'), 'WD07': ('removed', '', 'คริปโต'), 'WD08': ('merged', 'C07', ''), 'WD09': ('same', 'CD03', ''),
 'WD10': ('merged', 'CD03, C23', ''), 'WD11': ('merged', 'C24', ''), 'WD12': ('merged', 'C27', ''), 'WD13': ('merged', 'C27', ''), 'WD14': ('removed', '', 'ไม่มีบันทึกรายการไว้จ่ายทีหลัง'),
 'WD15': ('changed', 'C02', 'ความยินยอมผ่าน Messenger'), 'WD16': ('merged', 'C06', ''), 'WD17': ('removed', '', 'PromptPay ยังไม่เปิด'), 'WD18': ('merged', 'C26', ''),
 'WD19': ('removed', '', 'สถานะโหลดทั่วไป'), 'WD20': ('merged', 'S04', ''), 'WD21': ('removed', '', 'x402 / USDC (คริปโต)'), 'WD22': ('changed', 'C01, C03', 'ตัวตนจากการแตะ NFC + Messenger'),
 'WD23': ('merged', 'C20', ''), 'WD24': ('merged', 'CD01', ''), 'WD25': ('removed', '', 'สั่งรวมโต๊ะยังไม่ทำ'), 'WD26': ('merged', 'CD03', ''),
}
LABEL = {'same': 'คงเดิม (ปรับธีม)', 'changed': 'เปลี่ยนการทำงาน', 'merged': 'รวมไว้ในหน้าอื่น', 'removed': 'ตัดออก'}
scope = [i for i, s in sol.items() if s['surface'] in ('pos', 'pay', 'pay-desktop', 'states')]
unmapped = [i for i in scope if i not in M]
bad = [(i, d) for i, (k, d, _) in M.items() for d in [x.strip() for x in d.split(',') if x.strip()] if d not in meta]
used = {x.strip() for _, d, _ in M.values() for x in d.split(',') if x.strip()}
meta_only = [i for i, s in meta.items() if i not in used and s['page'] not in ('00 · เริ่มที่นี่', '01 · พื้นฐานการออกแบบ', '50 · ส่งต่อทีมพัฒนา')]
counts = {k: sum(1 for i in scope if M.get(i, ('?',))[0] == k) for k in LABEL}
lines = ['# meta- เทียบกับ sol- (ไฟล์ออกแบบ)', '', 'สร้างโดย `design/figcraft-meta/source/diff_vs_sol.py` · sol- = `design/figcraft/handoff/screen-map.json` (ก่อนเริ่มแข่ง, 21 ต.ค.) · meta- = `BitPOS-Muse-UI.figcraft`', '',
         f"หน้าของ sol- ที่เทียบ (POS, Pay, Pay desktop, สถานะ): **{len(scope)}** · " + ' · '.join(f"{LABEL[k]} {v}" for k, v in counts.items()) + f" · หน้าที่มีเฉพาะ meta-: **{len(meta_only)}**", '']
if unmapped or bad: lines += ['> ⚠️ ยังไม่ได้จับคู่: ' + ', '.join(unmapped) + ' · ปลายทางที่ไม่มี: ' + ', '.join(f'{a}→{b}' for a, b in bad), '']
for kind in ['removed', 'changed', 'merged', 'same']:
    lines += [f'## {LABEL[kind]}', '', '| sol- | ชื่อ | meta- | หมายเหตุ |', '|---|---|---|---|']
    for i in scope:
        k, d, note = M.get(i, ('?', '', ''))
        if k == kind: lines.append(f"| {i} | {sol[i]['title']} | {d or '—'} | {note} |")
    lines.append('')
lines += ['## มีเฉพาะ meta- (งานใหม่ของ Meta)', '', '| meta- | ชื่อ | หน้า |', '|---|---|---|'] + [f"| {i} | {meta[i]['title']} | {meta[i]['page']} |" for i in meta_only]
(OUT / 'reports/diff-vs-sol.md').write_text('\n'.join(lines) + '\n')
(OUT / 'reports/diff-vs-sol.json').write_text(json.dumps({'counts': counts, 'meta_only': meta_only, 'unmapped': unmapped, 'bad_destinations': bad,
                                                          'map': {i: {'kind': M[i][0], 'meta': M[i][1], 'note': M[i][2]} for i in scope if i in M}}, ensure_ascii=False, indent=1) + '\n')
print(counts, 'meta-only', len(meta_only), 'unmapped', unmapped, 'bad', bad)
