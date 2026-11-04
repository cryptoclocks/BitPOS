# ออกแบบ: เครื่องคิดเงินสด + บาร์โค้ด + ส่วนลด + ใบกำกับภาษีอย่างย่อ (parity กับฟีเจอร์ที่ขาดจาก domepos)

ผู้ออกแบบ: SA · วันที่ 2026-11-02 · สถานะ: **implement ครบเฟส A–D แล้ว (2026-11-02)** — ยังไม่ apply migration 183 กับ DB จริง ยังไม่ deploy ยังไม่ได้ดูในหน้า Pos จริงหลังล็อกอิน · อ้างอิง `docs/DOMEPOS_FEATURE_GAP_TH.md`
(เขียนเองทั้งหมด ไม่คัดลอกโค้ดจาก domepos ซึ่งไม่มี license)

## 1. สิ่งที่สำรวจพบก่อนออกแบบ (ข้อเท็จจริงที่บังคับการตัดสินใจ)

| ข้อเท็จจริง | หลักฐาน | ผลต่อการออกแบบ |
|---|---|---|
| `orders` เป็น PAID ได้ทางเดียวคือ routine SQL `settle_verified_attempt` หลังตรวจธุรกรรมบนเชน (migration 010/013/026/051/055…) | `apps/api/src/orders.ts` `settleAttempt` | **ห้ามแทรกเงินสดเข้า `orders`** เสี่ยงทำลายกฎ "ลายเซ็น/callback ไม่ใช่หลักฐานการชำระ" และ trigger ~30 ตัว |
| สกุลราคาแคตตาล็อกเป็น `USD` หรือ `USDG` เท่านั้น (`priceConfiguration`) | `apps/api/src/catalog.ts` | ร้านไทยรับเงินสดเป็น **THB** → ห้ามแปลง USD/USDG↔THB (ไม่มีอัตราแลกเปลี่ยนที่เชื่อถือได้ และ AGENTS.md ห้ามเดา) |
| ยอดปิดรอบนับเฉพาะ `orders` PAID แยกสกุลเงิน และไม่รวมข้ามสกุล | `apps/api/src/shifts.ts` | ยอดเงินสด THB เป็นกลุ่มของตัวเอง (`sourceKind='cash_counter'`) |
| สต็อกมี ledger ที่แก้ไม่ได้ (`stock_movements`) และ `reserved<=stock` | migration 139, 182 | ขายเงินสดต้องตัดผ่าน ledger เดิม ห้ามต่ำกว่า reserved |
| การเพิ่มฟิลด์ใน `Product` ของสัญญา `/catalog` กระทบแอปมือถือ (generated contract) | `packages/contracts` | บาร์โค้ดเก็บ **ตารางแยก** ไม่แตะสัญญา product |
| ตัวอย่างที่เคยตัดสินใจไว้แล้ว: ออเดอร์ที่ไม่ใช่ Solana อยู่ตารางแยก (`channel_orders`) | `docs/ORDER_CHANNELS_PLAN_TH.md` | ใช้แบบเดียวกัน: `cash_sales` แยก ไม่ปน `orders` |

## 2. ทางเลือกและการตัดสินใจ

| ทางเลือก | ข้อดี | ข้อเสีย | ผล |
|---|---|---|---|
| A. เพิ่มสกุล THB ให้แคตตาล็อกและ settlement | รวมศูนย์ | ต้องมี FX, แก้สัญญามือถือ/quote/ทุก routine | ไม่ทำ (ใหญ่และเสี่ยงเงิน) |
| B. **โมดูลเงินสดแยก ราคาเงินสด (THB) แยกต่อสินค้า เจ้าของกรอกเอง** | ไม่แตะ crypto settlement, ไม่มี FX, ตรวจสอบง่าย | เจ้าของต้องตั้งราคา THB ซ้ำอีกชุด | **เลือก** |
| C. ไม่ทำ | ไม่มีความเสี่ยง | ขาดฟีเจอร์ที่ขอ | ไม่เลือก |

หลักการ (ยึด AGENTS.md): ราคา/ส่วนลด/ภาษี/ทอน **คำนวณฝั่งเซิร์ฟเวอร์** เป็นจำนวนเต็ม minor units; client ส่งแค่ productId, qty, ส่วนลดที่ขอ, เงินที่รับมา; ทุกการเขียนมี idempotency key + audit; tenant isolation ด้วย RLS; role บังคับที่เซิร์ฟเวอร์.

## 3. โมเดลข้อมูล (migration 183)

- `product_barcodes(merchant_id, barcode, product_id, created_by, created_at)` PK(merchant,barcode); barcode 4–32 ตัว `[0-9A-Za-z-]`; FK products; หนึ่งสินค้ามีได้หลายบาร์โค้ด; RLS; grant SELECT/INSERT/DELETE.
- `cash_settings(merchant_id PK, enabled=false, currency='THB', decimals=2, vat_mode('none'|'inclusive')='none', vat_bps=700, seller_name, seller_tax_id(13 หลัก หรือว่าง), seller_branch('00000'), seller_address, receipt_prefix, staff_max_discount_bps=0, updated_by, updated_at)`.
- `cash_prices(merchant_id, product_id, price_minor>0, updated_by, updated_at)` PK(merchant,product) — สกุลตาม settings (ราคาเดียวต่อร้าน ไม่มีการแปลง).
- `cash_receipt_counters(merchant_id, series, last_value)` — เลขที่ใบเสร็จเรียงต่อเนื่องไม่ข้าม (increment ใน transaction เดียวกับการขาย; rollback = ไม่เสียเลข).
- `cash_sales(merchant_id,id,seq,receipt_no,status 'PAID'|'VOIDED', currency_code, decimals, subtotal_minor, discount_minor, total_minor, net_minor, vat_minor, vat_mode, vat_bps, tender_minor, change_minor, cashier, created_at, voided_at/by/reason/restocked, idempotency_key, request_hash, seller_snapshot jsonb)` UNIQUE(merchant,seq), UNIQUE(merchant,receipt_no), UNIQUE(merchant,idempotency_key). CHECK: `total=subtotal-discount`, `net+vat=total`, `tender>=total`, `change=tender-total`, `total>0`.
- `cash_sale_lines(merchant_id,sale_id,line_no,product_id,name,name_en,qty,unit_minor,line_total_minor)` ชื่อ/ราคา **snapshot ณ ขาย** (ราคาเปลี่ยนทีหลังไม่กระทบใบเสร็จเก่า) — insert-only.
- Trigger: `cash_sales` แก้ได้เฉพาะ PAID→VOIDED ครั้งเดียว (ฟิลด์ void_*) ส่วนที่เหลือ immutable; lines immutable.
- `stock_movements.kind` เพิ่ม `CASH_SALE` (delta<0) และ `CASH_VOID_RETURN` (delta>0).

## 4. กฎคำนวณ (ฟังก์ชันบริสุทธิ์เดียว `priceCashSale`, ใช้ทั้ง quote และ commit)

1. subtotal = Σ unit×qty (unit จาก `cash_prices` เท่านั้น; ไม่มีราคา = ขายไม่ได้ `CASH_PRICE_MISSING`).
2. ส่วนลดท้ายบิล: `percent` (หน่วย basis points 0–10000) หรือ `amount` (minor units); percent → `floor(subtotal×bps/10000)` (ปัดลงเข้าข้างร้าน); discount < subtotal เสมอ (total>0).
3. total = subtotal − discount.
4. VAT แบบรวมในราคา (inclusive) เท่านั้น: `net = round_half_up(total×10000/(10000+bps))`, `vat = total − net` → net+vat=total พอดี ไม่เศษหาย; mode none → vat=0.
5. ทอน = tender − total; tender < total → `TENDER_TOO_LOW`.
- ใช้ BigInt ทั้งหมด ไม่มี float.

## 5. สิทธิ์ (บังคับที่เซิร์ฟเวอร์)

| การกระทำ | owner | manager | staff |
|---|---|---|---|
| ตั้งค่าโปรไฟล์/ภาษี/เปิด-ปิดโมดูล | ✅ | ❌ | ❌ |
| ตั้งราคาเงินสด / จัดการบาร์โค้ด | ✅ | ✅ | ❌ |
| ขาย | ✅ | ✅ | ✅ (เมื่อ enabled) |
| ส่วนลด | ทุกระดับ < 100% | ทุกระดับ < 100% | ไม่เกิน `staff_max_discount_bps` (ค่าเริ่ม 0 = ห้าม) |
| ยกเลิก (void) | ✅ ต้องใส่เหตุผล | ✅ ต้องใส่เหตุผล | ❌ |
| ดูรายการขาย/พิมพ์ซ้ำ | ✅ | ✅ | ✅ (เฉพาะของตัวเอง… ตัดสินใจ: ทั้งหมดของร้าน 100 รายการล่าสุด อ่านอย่างเดียว) |
| เรียกค้นบาร์โค้ด | ✅ | ✅ | ✅ |

## 6. API (`/api/cash/*`, `/api/barcodes/*`)

- `GET/PUT /api/cash/settings` · `GET/PUT /api/cash/prices` (PUT เป็น batch set/clear, strict zod)
- `GET /api/barcodes?productId=` · `PUT /api/barcodes` · `DELETE`-ผ่าน `POST /api/barcodes/delete` · `GET /api/barcodes/lookup?code=`
- `POST /api/cash/quote` (คำนวณอย่างเดียว ไม่บันทึก) · `POST /api/cash/sales` (บันทึก; idempotent ด้วย `idempotencyKey`+hash) · `GET /api/cash/sales` · `GET /api/cash/sales/:id` · `POST /api/cash/sales/:id/void`
- ข้อผิดพลาดใช้รหัสเดิมของสัญญา (`INVALID_REQUEST`, `ROLE_REQUIRED`, `RESOURCE_NOT_FOUND`, `STOCK_CHANGED`/`INVALID_PRICE` ฯลฯ) ไม่ขยาย `BoundaryErrorCode` ของสัญญาร่วม.

## 7. การขาย = หนึ่ง transaction

ล็อก advisory `cash-sale:<merchant>` → replay idempotency → ตรวจ settings.enabled → ล็อกแถว products (เรียงตาม id กัน deadlock) → ตรวจ `stock−reserved ≥ qty` → คำนวณ → นับเลขที่ใบเสร็จ → insert sale+lines → ตัดสต็อกผ่าน ledger (key `cash:<sale>:<line>:sale`) → audit. ล้มเหลวที่ใดก็ rollback ทั้งหมด (ไม่เสียเลขใบเสร็จ ไม่ตัดสต็อกครึ่งๆ).

Void: ล็อก sale → ต้อง PAID → ตั้ง VOIDED+เหตุผล+ผู้ทำ → ถ้า `restock=true` คืนสต็อกผ่าน ledger (`CASH_VOID_RETURN`) → audit. เลขใบเสร็จไม่ถูกนำกลับมาใช้.

## 8. ใบเสร็จ / ใบกำกับภาษีอย่างย่อ

- `vat_mode='none'` → "ใบเสร็จรับเงิน" (ไม่ใช่ใบกำกับภาษี)
- `vat_mode='inclusive'` และมีชื่อผู้ขาย + เลขผู้เสียภาษี 13 หลัก → "ใบกำกับภาษีอย่างย่อ": ชื่อ/ที่อยู่/เลขผู้เสียภาษี/สาขาผู้ขาย, เลขที่เรียงต่อเนื่อง, วันเวลา, รายการ+จำนวน+ราคา, ยอดรวมรวม VAT, มูลค่าก่อน VAT, VAT, "ราคารวมภาษีมูลค่าเพิ่มแล้ว", ทอน, สถานะ VOIDED ประทับทับเมื่อยกเลิก
- **อัปเดต 2026-11-04 (M09):** ใบที่พิมพ์ใช้หัวว่า "ใบเสร็จรับเงิน" / "Receipt" เสมอ ไม่เรียกตัวเองว่าใบกำกับภาษี (ตามแผน M09) ส่วนเลขผู้เสียภาษี สาขา และบรรทัด VAT ยังแสดงเมื่อเงื่อนไขข้างบนครบ
- **คำเตือนบังคับใน UI ตั้งค่า**: รูปแบบนี้ยังไม่ได้ผ่านการตรวจโดยนักบัญชี/กรมสรรพากร ห้ามอ้างว่าเป็นใบกำกับภาษีที่ถูกต้องตามกฎหมายจนกว่าจะยืนยัน; ระบบ **ไม่ยื่นภาษี ไม่เชื่อมสรรพากร**.

## 9. ยอดปิดรอบ

`shifts.totals()` เพิ่มกลุ่ม `sourceKind='cash_counter'` ต่อสกุลเงิน (เฉพาะ PAID ในช่วงเวลา; VOIDED ไม่นับ) ทำให้ Z-Report มี "เงินสดที่ควรมี" เทียบกับ "นับได้" (UI แสดงส่วนต่างเป็นข้อมูลอ่านอย่างเดียว ไม่ปรับยอดอัตโนมัติ). ฐาน `gross_paid_before_refunds_and_fees` เดิม.

## 10. UX/UI และ motion

แท็บใหม่ "ขายเงินสด": ซ้าย = ค้นหา/สแกนบาร์โค้ด + กริดสินค้า (ชิปหมวด) · ขวา = ตะกร้า ส่วนลด ปุ่มรับเงิน (พอดี/20/50/100/500/1000/กรอกเอง) ยอดทอนตัวใหญ่ · ปุ่มชำระ disabled จนกว่า tender ≥ total.
Motion: ตัวเลขยอด/ทอนเด้งเมื่อเปลี่ยน, การ์ดสินค้ากดแล้วเด้ง + ป้าย +1, แถวตะกร้าเลื่อนเข้า, ชำระสำเร็จมี check วาดเส้น + ใบเสร็จเลื่อนขึ้น, เสียงใช้ `sfx.ts` เดิม (ปิดได้), ทุกอย่างมี `prefers-reduced-motion`.
สแกนเนอร์: ช่องค้นหารับ Enter → lookup เฉพาะเมื่อข้อความตรงบาร์โค้ดเป๊ะ; ไม่พบ → เตือนแทนการเดาจากชื่อ.

## 11. แผนทดสอบ

- หน่วย: `priceCashSale` (ปัดเศษ, VAT net+vat=total, ส่วนลด, ขอบ 1 minor unit, ค่ามหาศาล BigInt), ตรวจเลข 13 หลัก
- DB (Postgres จริง): idempotent replay/conflict, เลขใบเสร็จต่อเนื่องและไม่เสียเมื่อ rollback, ขายพร้อมกัน 2 การเชื่อมต่อ (สต็อก 1 ชิ้นขายได้ 1), ห้ามต่ำกว่า reserved, role matrix, staff ลดราคาเกินเพดาน, void/restock/ห้าม void ซ้ำ, immutability (trigger + สิทธิ์), tenant isolation (RLS), กลุ่ม `cash_counter` ในยอดปิดรอบ
- เว็บ: เอกสารใบเสร็จ/ใบกำกับภาษี, ตรวจภาพจริง TH/EN มือถือ/เดสก์ท็อป, reduced-motion (บังคับ media rule รวม pseudo-element)

## 12. สิ่งที่ไม่ทำ (ขอบเขต)

FX/สกุล THB ในแคตตาล็อกหลัก · PromptPay/บัตร/โอน (ต้องมีตัวตรวจจากผู้ให้บริการจริง; ยอมรับแค่เงินสด) · เชื่อมสรรพากร/ยื่น VAT · GL คู่ · เครื่องพิมพ์ความร้อน ESC/POS (ใช้ print ของเบราว์เซอร์).

## 13. ลำดับ implement

A) migration 183 + บาร์โค้ด API/UI · B) ราคาเงินสด + `priceCashSale` + ขาย/void API + tests · C) หน้าขายเงินสด + ตั้งค่า + ใบเสร็จ · D) ยอดปิดรอบ + เอกสาร checkpoint/provenance.

## 14. ทบทวนแผนรอบสอง (2026-11-02) — ช่องโหว่ที่หาและผลการตรวจ

| ประเด็นที่สงสัย | ผลตรวจ | การแก้ |
|---|---|---|
| โค้ดทำงานได้ใต้ role จริง `bitpos_app` + RLS หรือไม่ (การทดสอบแรกรันเป็น superuser) | **พบช่องโหว่จริง**: `addBarcode` ใช้ `SELECT … FOR UPDATE` บน `product_barcodes` ซึ่ง role นี้ไม่มีสิทธิ์ UPDATE → `permission denied` | เปลี่ยนเป็น `INSERT … ON CONFLICT DO NOTHING` แล้วอ่านผู้ชนะ; เพิ่มเทสต์รันทั้งเส้นทางเป็น `bitpos_app` ทั้งเงินสด (15 เทสต์) และสต็อก/settlement ของ Grab |
| VAT ทำให้ `net` เป็น 0 สำหรับยอดเล็กมาก (ชนกับ CHECK `net>0`)? | **ไม่ใช่ช่องโหว่** พิสูจน์ครบทุกค่า total 1–200000 × อัตรา 0/1/7/10/30% → net>0 เสมอ | ไม่ต้องแก้ (เก็บเทสต์ยอดเล็กไว้) |
| เลข migration ชนกับ session Meta/PayPal ที่ใช้ DB เดียวกัน? | **ไม่ชน**: Meta ใช้ 300–328, PayPal 400–405, งานนี้ 179–183 | — |
| บันทึกราคาเกิน 200 รายการต่อครั้ง | พบ: ร้านที่เมนู >200 กรอกครั้งแรกจะถูกปฏิเสธ | UI ส่งเป็นชุดละ 200 |
| ชุดทดสอบทั้งโปรเจกต์ 5 ไฟล์ล้ม | สาเหตุคือรันโดยไม่ตั้ง env ที่ config บังคับ (ไม่ใช่โค้ด) — ตั้ง env แล้วผ่านหมด | — |
| ยกเลิกบิลหลังปิดรอบแล้ว | **ข้อจำกัดที่ต้องรู้**: ยอดของรอบที่ปิดไปแล้วไม่ถูกแก้ย้อนหลัง (snapshot immutable) การยกเลิกจะสะท้อนในรอบถัดไปเป็นส่วนต่างเงินสดที่ต้องอธิบายด้วยบันทึก void | บันทึกไว้ ไม่แก้ (การแก้ย้อนหลังขัดกับ immutability ของปิดรอบ) |

## 15. Preflight ก่อนใช้บนระบบจริง (ยังไม่ได้ทำ — ต้องได้รับอนุญาตจากเจ้าของ)

1. สำรอง DB ตาม `docs/RUNBOOK_BACKUP_RESTORE_TH.md` แล้ว apply 179→183 ตามลำดับ (แต่ละไฟล์ idempotent ไม่ได้ ห้าม apply ซ้ำ)
2. ค่าเริ่มต้นปลอดภัย: `cash_settings.enabled=false` จนกว่าเจ้าของเปิดเอง; ไม่มีราคาเงินสด = ขายไม่ได้
3. deploy API + เว็บ แล้วตรวจในหน้า Pos จริงด้วยบัญชี owner/manager/staff (ภาพ, สิทธิ์, พิมพ์ใบเสร็จ, เสียง)
4. ให้นักบัญชียืนยันรูปแบบใบกำกับภาษีอย่างย่อก่อนเปิด `vat_mode=inclusive` กับลูกค้าจริง
5. Rollback: ปิด `enabled`; ถ้าต้องถอดจริง `DROP TABLE cash_sale_lines, cash_sales, cash_receipt_counters, cash_prices, cash_settings, product_barcodes` (ledger ที่เขียนไว้คงอยู่เพราะเป็นประวัติแก้ไม่ได้) และต้องไม่มีการขายจริงแล้ว

## 16. อัปเดต: รายงานขายหลักรวมเงินสดแล้ว
`apps/api/src/reports.ts` เพิ่มแหล่ง `cash_counter` ต่อวันและต่อชั่วโมง (เขตเวลาร้าน, เฉพาะ PAID) แยกสกุลเงินเสมอ; หน้ารายงานแสดงป้าย "เงินสด"; เมื่อมีทั้ง USD/USDG และ THB หน้าสรุปรวมจะไม่รวมข้ามสกุล (พฤติกรรมเดิมของ `salesSummary`) ยังเห็นตารางรายวันแยกครบ. ไฟล์ส่งออก CSV (`report-exports.ts`) ยังไม่รวมเงินสด.

## 17. ส่วนเพิ่ม (migration 184)
- **ตัวเลือกรายแก้ว:** `cash_prices.sweetness_enabled/unit`, `cash_addons` (ชื่อ ไทย/อังกฤษ ราคาบวก ≥0 สูงสุด 20 ต่อเมนู); ตะกร้าเป็น "เมนู + ตัวเลือก" (`lineKey`) เมนูเดียวหลายบรรทัดได้ แต่สต็อกนับรวมกองเดียว และ ledger เก็บ before/after ต่อเนื่องต่อบรรทัด; `cash_sale_lines` เก็บ unit/base/sweetness/addons ณ ตอนขาย
- **ลิ้นชัก:** `cash_drawer_openings` (insert-only, PK = วันเริ่มรอบ); snapshot ปิดรอบมี `drawer{opening,cashSales,expected}` เฉพาะรอบที่บันทึกเงินตั้งต้น
- **พักบิล:** `cash_held_bills` (recall = DELETE…RETURNING กัน 2 เครื่องดึงซ้ำ)
- **ทดสอบ:** cash-register-extras-db 9 (รวมรันเป็น `bitpos_app`), cash-register-http (ผ่านเซิร์ฟเวอร์ HTTP จริง: session/สิทธิ์/routes/รายงาน/ส่งออก/ปิดรอบ), web-cash-routes (proxy), web-cash-view 6; UI ตรวจจริงในเบราว์เซอร์ (แผ่นตัวเลือก, พัก/เรียกกลับ, ขายด่วน, ลิ้นชัก) และ reduced-motion (animation 11→0, transition 0)
