# 04 · หน้าจอและ UX

> ส่วนหนึ่งของ [แผน implement](../IMPLEMENTATION_PLAN_TH.md) · ใช้ style/components ของ POS เดิม (`app.css`, `customer-checkout.css`) เพิ่มเฉพาะ class `pp-*` ใน `apps/web/src/styles/paypal.css` · ภาษาไทย/อังกฤษครบทุกข้อความ

## 1. ลูกค้า — หน้าจ่าย `/pay/[accessToken]` (มือถือ 390×844)

| ส่วน | เนื้อหา |
|---|---|
| หัว | ชื่อร้าน + โต๊ะ, ปุ่ม TH/EN เดิม |
| บิล | รายการ, ราคาโปร (ขีดราคาเดิม), รวม `USD 9.00`, นับถอยหลังอายุราคา |
| ป้ายแคมเปญ | "เหลือ 3 จาก 8 · ถึง 16:00" (จาก envelope, อัปเดตเมื่อโหลดใหม่) |
| ปุ่มหลัก | ปุ่ม PayPal (สไตล์ตาม brand guideline ของ PayPal: ใช้ปุ่มของ SDK ถ้ามี web component **[spike: `<paypal-button>` ใน v6]** ไม่งั้นปุ่มเองพร้อมโลโก้ที่อนุญาต) |
| สถานะ | แถบสถานะตาม 01 §11 ใต้ปุ่ม, กันกดซ้ำระหว่าง creating/confirming |
| จ่ายแล้ว | เครื่องหมายถูก, "ชำระด้วย PayPal · USD 9.00 · capture …A1B2C3", "ร้านได้รับออร์เดอร์แล้ว", ปุ่มกลับเมนู (เดิม) |
| ป้าย sandbox | แถบเล็ก "PayPal Sandbox — test money only" ทุกหน้าของร้านเดโม |
| ซ่อน | ตัวเลือก wallet/Phantom/USDG เมื่อร้านไม่เปิด asset (ใช้ logic เดิมของ `merchant_payment_assets`) |

สถานะ in-app browser (LINE/Messenger/IG): ตรวจ user agent → ข้อความ "เปิดหน้านี้ใน Safari/Chrome เพื่อจ่ายด้วย PayPal" + ปุ่มคัดลอกลิงก์ (P0), ลิงก์ approve แบบ redirect (P1)

## 2. Owner — แท็บ "Café Copilot" ใน POS (`paypal-pos.`)

จุดเข้า: เมนูโปรโมชันเดิม → แท็บใหม่ "Copilot (PayPal)" (component `CampaignAgent.tsx` ใส่ใน `Promotions.tsx` เดิมแบบเงื่อนไขเมื่อร้านเปิด PayPal)

```
┌ Café Copilot ─────────────────────────────────────────┐
│ บอกสิ่งที่อยากขาย  [ขายครัวซองต์ที่เหลือ 8 ชิ้นก่อน 16:00 ลดไม่เกิน 10%] [ส่ง] │
│ ตัวอย่าง: ▸ ขายของเหลือก่อนปิดร้าน ▸ ดันเมนูใหม่ช่วงบ่าย              │
├ AI กำลังทำ ──────────────────────────────────────────┤
│ ✓ อ่านสต็อก: Croissant เหลือ 8 (ว่าง 8)                     │
│ ✓ อ่านยอดขาย 6 ชม.: ขายแล้ว 4                                │
│ ✓ ตรวจข้อเสนอ: ลด 10% → USD 4.05, 8 ชิ้น, ถึง 16:00 ✓         │
│ ✓ บันทึกร่าง                                    [Details ▾] │
├ ร่างแคมเปญ (ยังไม่เผยแพร่) ───────────────────────────────┤
│ Croissant  USD 4.50 → 4.05 (−10%)   จำนวนสูงสุด [8]  ต่อออร์เดอร์ [1] │
│ จบ [16:00]   หัวข้อ [ ... ]  ข้อความ [ ... ]                      │
│ เหตุผลของ AI: ...                                            │
│ แสดงบนจอ: (•) Mini โต๊ะ 1  ( ) Terminal โต๊ะ 2                  │
│ [อนุมัติและส่งไปจอ]   [ใช้แบบฟอร์มแทน]                           │
└──────────────────────────────────────────────────────┘
```
- ปุ่มอนุมัติเปิดหน้ายืนยัน: "จะแสดงโปรนี้บน Mini โต๊ะ 1 จนถึง 16:00 หรือขายครบ 8 ชิ้น ลูกค้าจ่ายด้วย PayPal Sandbox" [ยืนยัน]
- แก้ช่องใดหลัง approve → กลับเป็นร่าง ต้องอนุมัติใหม่ (แสดงป้ายเตือน)
- `NEEDS_INPUT`: แสดงคำถามของ AI + ช่องตอบ (ต่อ run เดิมไม่ได้ใน P0 → เริ่ม run ใหม่โดยรวมคำตอบเข้า intent)
- Details: ตาราง steps (tool, args ย่อ, ผล, เวลา ms, model, request id)

## 3. Owner — ผลแคมเปญ `CampaignOutcome.tsx`

| การ์ด | ค่า (คำนวณด้วย code) |
|---|---|
| ขายแล้ว (paid) | `CONSUMED units` / `max_units` |
| รับแล้ว (collected) | จาก fulfillment เดิม |
| จองอยู่ | `RESERVED` |
| เหลือ | `max_units − CONSUMED − RESERVED` |
| ยอด PayPal (gross) | Σ `paypal_captures.gross_minor` ของ settlement SETTLED ที่ผูก envelope |
| คืนเงิน | Σ `paypal_payment_events` (แยก) |
| RECOVERY | จำนวน + ยอด (ต้องให้ร้านดู) |
| เวลาเหลือ | ถึง `ends_at` |

ตารางออร์เดอร์: เวลา, โต๊ะ, ยอด, สถานะ, capture id ย่อ, ปุ่ม Evidence → `EvidenceTrace.tsx`

## 4. Evidence trace (หนึ่ง order)

ไทม์ไลน์แนวตั้ง แต่ละแถวมีเวลา + id + แหล่ง:
1. Intent ของ owner (run id, model)
2. Tool steps (จำนวน, violations ที่แก้)
3. Draft v1 → แก้ v2 → Approved v2 โดย owner@… เวลา …
4. Published to device … (target id, render ACK เวลา …)
5. Order สร้างจาก QR (quote id, ราคา freeze, หมดอายุ)
6. Campaign units RESERVED 1
7. PayPal order …(CREATED → APPROVED)
8. Capture … COMPLETED USD 4.05 (verified via capture_response)
9. Webhook PAYMENT.CAPTURE.COMPLETED รับ 2 ครั้ง → ผล 1 ครั้ง (dedup)
10. Settlement SETTLED, stock 8 → 7, outbox event …, จอ paid ACK เวลา …
ปุ่ม "Copy JSON" (redacted) สำหรับแนบ judge packet

## 5. จอ

- Browser terminal `/terminal/[accessToken]` เดิม: ตรวจว่าแสดงโปร (ภาพ/ข้อความ/QR) และหน้าจอ paid ที่มี `USD 4.05 · PayPal`
- Mini: `table_settlement()` ใน firmware รับเฉพาะ settlement ของ Solana devnet (ตรวจ network/mint/genesis) จึงแสดง paid ของ PayPal ไม่ได้ถ้าไม่แก้ firmware → Mini เป็น **P1** (เพิ่ม branch PayPal + แฟลช + ทดสอบจริง); หน้าจอ Mini ใน FigCraft ฉบับ PayPal (PPN-46…53) ติดป้าย P1
- P0 ใช้ browser terminal เท่านั้น

## 6. ข้อความ i18n ใหม่ (ไฟล์ `apps/web/src/lib/paypal-i18n.ts`)

ทุก key มี `th`/`en`: สถานะจ่าย 9 ค่า (01 §11), ป้าย sandbox, ข้อความ in-app browser, Copilot (หัวข้อ, placeholder, ตัวอย่าง 2, สถานะ step 5 แบบ, ปุ่ม 3, หน้ายืนยัน, ป้ายเตือนแก้หลังอนุมัติ, NEEDS_INPUT), Outcome (การ์ด 8, หัวตาราง 5), Evidence (แถว 10)
