#!/usr/bin/env python3
"""Inventory design boards; source pointers are candidates, never acceptance proof."""
import json
from pathlib import Path
from collections import Counter
root = Path(__file__).resolve().parents[2]
boards = json.loads((root/'design/figcraft/handoff/screen-map.json').read_text())['screens']
specific = {
'U12':'apps/mobile-customer/lib/account_page.dart','U13':'apps/mobile-customer/lib/account_page.dart',
'U23':'apps/mobile-customer/lib/order_history_sheet.dart','U25':'apps/mobile-customer/lib/order_refunds_sheet.dart',
'U29':'packages/mobile_shared/lib/food_chat_page.dart','R19':'packages/mobile_shared/lib/food_chat_page.dart','U28':'apps/mobile-customer/lib/favourites_sheet.dart','U30':'apps/mobile-customer/lib/help_page.dart',
'U31':'apps/mobile-customer/lib/food_review_page.dart','U32':'apps/mobile-customer/lib/account_page.dart',
'R20':'apps/mobile-driver/lib/help_safety_page.dart','R21':'apps/mobile-driver/lib/help_safety_page.dart','R22':'apps/mobile-driver/lib/main.dart','R15':'apps/mobile-driver/lib/food_history_page.dart','U33':'apps/mobile-customer/lib/account_page.dart','U34':'apps/mobile-customer/lib/account_privacy_page.dart','R16':'apps/mobile-driver/lib/earnings_page.dart',
'R17':'apps/mobile-driver/lib/earnings_page.dart','R18':'apps/mobile-driver/lib/earnings_page.dart',
'P29':'apps/web/src/components/IncomingOrders.tsx','P32':'apps/web/src/pages/platform/food-dispatch.astro',
'P38':'apps/web/src/pages/platform/driver-earnings.astro',
}
presentation_only = set('U26 U35 U36 U37 U39 U40 U41 U42 U43 R27 R28 R29 R30 R31 W22'.split())
for screen in presentation_only:
 specific[screen] = ('apps/web/src/components/CouponSelection.tsx' if screen=='W22' else
  'packages/mobile_shared/lib/presentation/feature_ui.dart' if screen in {'U26','U35','U36','U37'} else
  'packages/mobile_shared/lib/presentation/ride_ui.dart')
missing = set()
# Preserve accumulated manual/source-backed acceptance instead of erasing it on regeneration.
previous = {}
existing = root/'docs/UI_RUNTIME_INVENTORY_TH.md'
if existing.exists():
 for line in existing.read_text().splitlines():
  cells=[c.strip() for c in line.split('|')]
  if len(cells)==7 and cells[1] not in {'ID','---'}:
   previous[cells[1]]=(cells[4],cells[5])
def pointer(s):
 if s['id'] in missing: return '— ต้อง implement/join runtime'
 p=specific.get(s['id'])
 if not p:
  surface=s['surface']
  p={'user':'apps/mobile-customer/lib/food_page.dart','rider':'apps/mobile-driver/lib/food_work_page.dart','pos':'apps/web/src/components/Pos.tsx','pay':'apps/web/src/components/Payment.tsx','pay-desktop':'apps/web/src/components/Payment.tsx'}.get(surface)
 if p and not (root/p).is_file(): raise SystemExit('Missing candidate: '+p)
 return f'`{p}`' if p else '— ต้องระบุ implementation'
counts=Counter(s['surface'] for s in boards)
lines=['# ทะเบียน UI เทียบ FigCraft กับ runtime','',
'อัปเดต 2026-10-21 — direct Codex; OMP ยังคงหยุด', '',
'รายการนี้อ่านทุกบอร์ดจาก screen-map.json โดยตรง ไม่ใช่เปอร์เซ็นต์งานเสร็จ เส้นทาง source เป็นจุดตรวจที่เกี่ยวข้อง ไม่ยืนยันว่าหน้าหรือพฤติกรรมนั้นทำครบแล้ว บอร์ดรวม foundations/components/states ด้วย จึงห้ามเรียกทั้งหมดว่า 192 หน้าฟีเจอร์สำเร็จ', '',
'ทุกบอร์ดยังเปิดการตรวจเทียบภาพล่าสุด การผ่าน build หรือมีไฟล์ไม่เท่ากับผ่าน UI acceptance หลักฐานราย flow ดู DIRECT_IMPLEMENTATION_STATUS.md; ใช้ข้อมูลจริงจาก API หรือแสดงสถานะ unavailable ห้ามคัดลอกคะแนน/ETA/รูป fixture มาอ้างข้อมูลจริง', '',
'## จำนวนบอร์ดตาม surface','', '| Surface | Boards |','|---|---:|']
lines += [f'| {k} | {v} |' for k,v in sorted(counts.items())]
lines += ['', '## ตรวจทีละบอร์ด','', '| ID | Surface | แบบ | Source ที่ต้องตรวจ | ตรวจภาพล่าสุด |','|---|---|---|---|---|']
for s in boards:
 old=previous.get(s['id'])
 source=pointer(s) if s['id'] in presentation_only or not old else old[0]
 acceptance=old[1] if old else 'ยังไม่ผ่าน acceptance'
 lines.append(f"| {s['id']} | {s['surface']} | {s['title'].replace('|','/')} | {source} | {acceptance} |")
lines += ['', '## ลำดับเก็บงาน', '',
'1. Customer: root navigation และหน้าหลัก/ร้าน/สินค้า/ตะกร้า/checkout; ตามด้วยร้านโปรด/support/reviews ที่มี API แล้ว เทียบ geometry ภาษาไทย/อังกฤษและข้อความยาว',
'2. Rider: onboarding/งาน/รับส่ง/หลักฐาน/รายได้/ความปลอดภัย พร้อม owner-loss และ offline states',
'3. POS และ Pay: ตรวจ Desktop/Mobile แยกทุก composition; รักษาฟีเจอร์ POS เดิมและสิทธิ์ server',
'4. คูปอง/chat/privacy/scheduling/group/multi-merchant/passenger: implement business lifecycle กับ UI ให้ครบ ห้ามวางหน้าสวยแล้วระบุว่าใช้งานได้',
'5. ชุดภาพและ E2E ล่าสุด พร้อม independent review; ลบภาพ scratch หลังวิเคราะห์และคงเฉพาะหลักฐานจำเป็น', '']
(root/'docs/UI_RUNTIME_INVENTORY_TH.md').write_text('\n'.join(lines))
print(f'Wrote {len(boards)} unique boards; {len({s["id"] for s in boards})} unique IDs')
