# Integration รับออร์เดอร์ GrabFood / LINE MAN — ขอบเขตและ checklist

แยกจากงาน DS เดิม (`.omp/work/h2-merchant-pricing-20261026/`) ไม่แก้ไฟล์ DS ใดๆ
เริ่ม 2026-10-31 ใน worktree `bitpos-h2-parallel` เท่านั้น MAIN อ่านอย่างเดียว ไม่ push/deploy ไม่แตะข้อมูลจริง

## สถานะผู้ให้บริการ (ตามจริง)

| รายการ | สถานะ | หลักฐาน |
|---|---|---|
| Grab API / partner | ยังไม่ได้รับสิทธิ์ ฟอร์มยังไม่ยืนยันส่ง (ติด CAPTCHA) | ผู้ใช้แจ้ง ยังไม่มีเอกสาร/credentials |
| LINE MAN API | ส่ง Partnership Opportunity แล้ว ยังไม่อนุมัติ | ผู้ใช้แจ้ง ไม่พบเอกสาร API สาธารณะ |
| สมัครร้านบนแพลตฟอร์ม | คนละขั้นตอนกับสิทธิ์เชื่อม POS | — |

ผลที่ตามมา: capability ทุกตัวของทั้งสอง provider เป็น `false` (`capabilitiesFor` ใน contract) จนกว่าจะมีเอกสารและสิทธิ์จริง
GrabFood SDK (Python, ทางการ) เป็นแค่ข้อมูลอ้างอิงรายการ operation ไม่ใช่สิทธิ์ ต้องตรวจ version/license/ประเทศ/webhook จากเอกสารที่ได้รับ
LINE MAN: ไม่เดา endpoint/auth/payload ไม่ scrape ไม่ดัก notification LINE Messaging API/LIFF ไม่ใช่สิทธิ์สั่งอาหาร

## ผลสำรวจระบบเดิม (ชุด 1)

- `orders` ผูกกับ Solana quote ทุกแถว (`usdg_minor`, `treasury`, `quote_expires_at`, status `AWAITING_WALLET…PAID`) และ authority v2 ที่มี `settlement` USDG/devnet
  → ออร์เดอร์แพลตฟอร์มใส่ตารางนี้ตรงๆ ไม่ได้ (จะถูกมองเป็นหนี้ที่ต้องจ่ายผ่าน Solana) **ตัดสินใจ: ตารางแยก `channel_orders` + `channel_order_lines` + `channel_events`** แล้วให้ศูนย์ออร์เดอร์รวมสองแหล่งตอนแสดงผล
- สต็อก: `products.stock/reserved` + `stock_movements` ledger (idempotency key) ใน `inventory.ts` → mutation สต็อกของออร์เดอร์แพลตฟอร์มต้องผ่าน ledger เดิม key = `channelEventKey` และเกิดเมื่อ mapping ครบเท่านั้น
- ศูนย์ออร์เดอร์: `IncomingOrders.tsx` แบ่ง channel เป็น `counter/table/delivery/pickup` จาก `authority.source.kind` และมี `onlineAcceptance` (PENDING/ACCEPTED/REJECTED) กับ fulfillment (`RECEIVED→PREPARING→READY`) ใช้ pattern เดียวกันได้
- Worker: `apps/worker` มี lane/outbox อยู่แล้ว ใช้ outbox เดิมสำหรับคำสั่งขาออกไป provider (accept/reject/ready)
- ไม่มีโค้ด Grab/LINE MAN เดิมใน apps/ (พบเฉพาะคำว่า cursor `grab` ใน CSS)

## สามแกนที่ต้องแยก

`orderSource` (bitpos/grabfood/lineman) · `paymentCollector` (bitpos_solana/platform/cash_on_pickup) · `deliveryProvider` (none/platform_rider/merchant_rider)
สถานะแยก 4 อย่าง: order (`ChannelOrderStatus`) · payment · fulfillment · settlement (`not_applicable/receivable/settled/disputed`)
เงิน: จำนวนเต็ม minor units + สกุลต้นทาง (เช่น THB 2 ตำแหน่ง) ห้ามแปลงเป็น USD/USDG 1:1

## ไฟล์ที่ชุดนี้เขียน (ชุด 1)

| ไฟล์ | สถานะ |
|---|---|
| `packages/contracts/src/order-channels.ts` | ใหม่ — contract กลาง, capability flags, state advance, event key |
| `tests/order-channels.test.ts` | ใหม่ — 5 tests ผ่าน |
| `docs/ORDER_CHANNELS_PLAN_TH.md` | ใหม่ — ไฟล์นี้ |
| `docs/CHECKPOINT.md` | จะเพิ่มบรรทัดสรุปตอนจบชุด |

ไฟล์ที่ชุดถัดไปจะแตะ (ยังไม่แก้): `supabase/migrations/179_*.sql` (เลขอาจชนกับ session Meta ที่ใช้ DB เดียวกัน ตรวจก่อน merge), `apps/api/src/channels/*`, `apps/api/src/index.ts` (route), `apps/worker/src/index.ts`, `apps/web/src/components/IncomingOrders.tsx`, `apps/web/src/components/ChannelSettings.tsx` (ใหม่), `apps/web/src/lib/api-routes.ts`
ก่อนแก้ไฟล์ที่ใช้ร่วมจะตรวจ `git status` ว่าไม่มีผู้เขียนอื่น AGENTS.md ไม่ได้จำกัดงานนี้ แต่ต้องรักษา tenant/role/จำนวนเต็ม/idempotency และห้ามอ้างว่าเชื่อมจริง

## Checklist

- [x] ชุด 1a: contract กลาง + tests (local, ไม่ใช่หลักฐาน provider)
- [x] ชุด 1b: ผลสำรวจระบบเดิมและการตัดสินใจตารางแยก (เอกสารนี้)
- [x] ช่องกรอกคีย์ของเจ้าของร้าน (owner only): migration 179 `channel_connections` (ยังไม่ได้ apply กับ DB ใดๆ), `apps/api/src/channel-connections.ts` (AES-256-GCM, AAD=merchant|source|env, ไม่ส่ง secret กลับ), หน้า ตั้งค่า → ช่องทางเดลิเวอรี (`ChannelSettings.tsx`), 5 tests PASS, web build PASS — ยังไม่ได้ดูภาพหน้าจอจริงและยังไม่ทดสอบกับ DB
- [x] ชุด 1c: migration `channel_orders/lines/events` + RLS + unique(event key) + tests ฐานข้อมูล fixture
- [x] ชุด 2 (บางส่วน): UI ตั้งค่าช่องทาง + แท็บ BitPOS/GrabFood/LINE MAN + **จับคู่เมนู** (2026-11-01: migration 181 `channel_item_map`, `channels/item-map.ts`, `ChannelItemMap.tsx`; owner/manager เลือกสินค้าเอง ไม่เดาจากชื่อ; ตั้งค่าแล้วเติมบรรทัดที่ยังไม่จับคู่, ยกเลิกแล้วคืนเฉพาะออเดอร์ที่ยังไม่จบ; ตรวจภาพจริง TH/EN, มือถือ/เดสก์ท็อป, มุมมองพนักงาน ด้วยข้อมูลจำลอง) + แท็บ "ทั้งหมด" (`AllOrders.tsx`, อ่านอย่างเดียว เรียงตามเวลา คนละสกุลเงินไม่รวมยอด กด เปิด เพื่อไปจัดการในแท็บของช่องทางนั้น; ตรวจภาพจริงด้วย fixture)
- [x] ชุด 3 (แบบ polling ไม่มี webhook เพราะ SDK ไม่ระบุการยืนยัน inbound): ตัวรับ event (บันทึกถาวรก่อนตอบ), dedupe, ย้อนลำดับ, คำสั่งขาออก pending + reconcile, คิวเมนูไม่ตรง, adapter GrabFood แบบ fixture ป้ายชัด
- [x] ชุด 4 (ยกเว้นซิงก์เมนู): เงิน/settlement, snapshot, สต็อกผ่าน ledger (2026-11-02)
  - สต็อก: migration 182 เพิ่ม kind `CHANNEL_SALE` ใน `stock_movements` + ตาราง `channel_stock_effects` (append-only); `channels/stock.ts` ตัดสต็อกครั้งเดียวต่อบรรทัดเมื่อออเดอร์ถึง accepted ขึ้นไป (ที่มาจาก Grab ยืนยันแล้ว ไม่ใช่ตอนส่งคำสั่งยังไม่ทราบผล) เฉพาะบรรทัดที่จับคู่แล้ว; จับคู่ทีหลังแล้วตัดตอนนั้น; ของไม่พอตัดเท่าที่มีและโชว์ส่วนที่ขาด; ไม่ต่ำกว่า reserved
  - **ไม่คืนสต็อกอัตโนมัติ** เมื่อยกเลิกหลังรับ เพราะระบบไม่รู้ว่าของคืนชั้นได้ไหม เจ้าของบันทึกเองด้วย RECEIVE
  - settlement: `channels/settlement.ts` owner/manager ทำเครื่องหมาย รอรับเงิน/ได้รับแล้ว(ร้านยืนยันเอง)/ข้อพิพาท เฉพาะออเดอร์ที่แพลตฟอร์มเก็บเงินและ completed; บันทึก event + audit; ยอดค้างรับแยกตามสกุลเงิน ไม่รวมข้ามสกุล และบอกชัดว่ามาจากข้อมูลออเดอร์ ไม่ใช่รายการโอนจริง (BitPOS มองไม่เห็นการโอนของ Grab)
  - ครัว (2026-11-02): แท็บ GrabFood มี **คิวครัว** (รับแล้ว/กำลังทำ เรียงเก่าก่อน ตัวใหญ่ โชว์ชื่อสินค้าที่จับคู่ไว้และโน้ต) และคำสั่ง `preparing` ที่เป็นขั้นของครัวเอง **ไม่ส่งไป Grab** (SDK ไม่มีคำสั่งนี้) ใช้ได้จาก accepted เท่านั้น โพลของ Grab ไม่ย้อนสถานะกลับ; `ready` ยังเรียก Grab จริง ออเดอร์ Grab **ไม่ได้รวมเข้ากระดานครัวของ BitPOS** (`IncomingOrders`) เพราะกระดานนั้นผูกกับออเดอร์ที่จ่ายผ่าน Solana + fulfillment/อุปกรณ์แจ้งเตือน ตามการตัดสินใจตารางแยก
  - ซิงก์เมนู: **ไม่ทำ** SDK ทางการไม่มี endpoint เมนู
- [x] ชุด 5: LINE MAN — UI + สถานะ awaiting_provider_access เท่านั้น ไม่มี HTTP
- [~] ชุด 6: ทดสอบตามรายการเสี่ยง — ส่วนที่ทำได้โดยไม่ต้องมี credentials **ทำแล้ว** (fixture/Postgres จริง): event ซ้ำ/ย้อนลำดับ, ร้านผิด store, เงินจำนวนเต็มต่อสกุล, ผลคำสั่งไม่ทราบค้าง pending, tenant isolation + สิทธิ์ role, secret ไม่ถูกส่งกลับ, poll พร้อมกัน 2 การเชื่อมต่อ (commit จริง) ตัดสต็อกครั้งเดียว, ledger append-only. **ค้างเพราะข้อจำกัดภายนอก:** flow sandbox จริงต้องมี Client ID/secret/Store ID ที่เจ้าของร้านกรอกเอง ต้องรันและแนบหลักฐาน sandbox แยกจาก fixture เมื่อได้คีย์

## ที่ต้องตั้งค่าเมื่อได้ credentials (ชื่อเท่านั้น ห้ามส่งค่าผ่านแชท)

เจ้าของร้านกรอกเองในหน้าตั้งค่า ไม่ใช้ env: Store ID, Client ID, Client secret, Webhook secret แยก sandbox/production ชื่อช่องเป็นสล็อตทั่วไป (OAuth ตาม SDK) ต้องปรับให้ตรงเอกสารจริงของ provider เมื่อได้รับ เซิร์ฟเวอร์ต้องมี `APP_SECRET` (ใช้เป็นฐานคีย์เข้ารหัส: เปลี่ยนค่านี้แล้วคีย์ที่เก็บไว้จะอ่านไม่ได้ ต้องกรอกใหม่)

## ขอบเขตที่เลื่อน

เรียก GrabExpress/LINE MAN มาส่งออร์เดอร์ BitPOS · ห้ามตีความ GrabFood POS API ว่าจองไรเดอร์ได้ · ห้ามส่งงานภายนอกซ้ำให้ไรเดอร์ BitPOS

## GrabFood: สิ่งที่ยืนยันจากเอกสารทางการ (อ่าน 2026-10-31)

แหล่ง: SDK ทางการ `grab/grabfood-api-sdk-python` (MIT, API 1.1.3) + SDK Go/Node ที่ให้ค่า OAuth
- Host: sandbox `https://partner-api.grab.com/grabfood-sandbox`, production `https://partner-api.grab.com/grabfood`, OAuth `https://api.grab.com`
- OAuth: `POST /grabid/v1/oauth2/token` JSON `client_id, client_secret, grant_type=client_credentials, scope=food.partner_api` (token อายุเริ่มต้น 7 วัน ใช้ซ้ำจนหมด)
- ใช้แล้วใน `apps/api/src/channels/grabfood-client.ts`: store status, list orders (`merchantID,date,page` หรือ `orderIDs` ≤10), accept/reject (`/partner/v1/order/prepare`), mark ready (`/partner/v1/orders/mark`, markStatus 1), cancel (`/partner/v1/order/cancel`)
- **ไม่อยู่ใน SDK จึงยังไม่ทำ:** วิธียืนยันตัวตนของ Submit Order webhook ขาเข้า, รายชื่อ order state ครบชุด, รูปแบบ `date` ของ list orders, ความหมาย cancel code, ซิงก์เมนู (ต้องแปลงเมนูเป็นรูปแบบ Grab และยืนยัน schema) → รับออเดอร์ด้วยการ poll List Orders แทน
- ช่อง Webhook secret ยังไม่ถูกใช้
- ข้อสังเกต: `OrderItem` ไม่มีชื่อสินค้า มีแต่ `id` (external ID ในระบบพาร์ตเนอร์) → จับคู่สินค้าด้วย id ที่ซิงก์ไว้เท่านั้น
- Environment: ค่าเริ่มต้น sandbox, สลับ production ต้องมีคีย์ production และยืนยันโดย owner (`channel_settings`)
- ปุ่ม ทดสอบการเชื่อมต่อ ยิง token + store status จริง; เทสต์ในรีโปใช้ fake fetch เท่านั้น **ยังไม่มีหลักฐานจาก sandbox จริงของ Grab**
- LINE MAN: ค้นหาแล้วไม่พบเอกสาร API สาธารณะ (มีแต่บทความบุคคลที่สามว่ามี API ผ่านการขอสิทธิ์) จึงไม่มี client

## ความคืบหน้า: รับออเดอร์ GrabFood เข้าระบบ (2026-10-31)

ทำแล้ว (ทดสอบกับ Postgres ชั่วคราวในเครื่อง + fake fetch ไม่ใช่ sandbox ของ Grab):
- migration 179: `channel_connections`, `channel_settings`, `channel_orders` (snapshot แก้ไม่ได้ด้วย trigger), `channel_order_lines`, `channel_events` (PK = event key กันซ้ำ) + RLS ต่อ merchant
- `grabfood-orders.ts`: ingest ออเดอร์ที่ poll (ปฏิเสธ store ID ไม่ตรง/จำนวนเงินไม่ใช่จำนวนเต็ม/สกุลผิดรูป, สถานะไม่ถอยหลัง, event ซ้ำไม่ทำอะไร), sync (จำกัด 10 วินาที/ร้าน), คำสั่ง accept/reject/ready (pending จนรู้ผล, ผลไม่แน่นอนค้าง pending และห้ามกดซ้ำจน poll เห็นสถานะ), list
- UI ศูนย์ออเดอร์: แท็บ BitPOS / GrabFood / LINE MAN (หน้า BitPOS เดิมไม่แตะ) ตรวจภาพจริงที่ 375px และ desktop ด้วย API จำลอง แล้วลบหน้าตัวอย่างชั่วคราว
- รันเทสต์ฐานข้อมูล: `CHANNEL_TEST_DB=postgres://... pnpm exec tsx --test tests/channel-orders-db.test.ts` (ข้ามอัตโนมัติถ้าไม่ตั้งค่า)

ยังไม่ทำ / ข้อสมมติที่ต้องยืนยันกับ Grab:
- รูปแบบ `date` ของ List Orders ใช้ `YYYY-MM-DD` (เขตเวลาไทย) เป็นข้อสมมติ เปลี่ยนที่ `grabListDate` ที่เดียว
- ยังไม่มี background poll ใน worker (ตอนนี้ poll ทุก 30 วินาทีขณะเปิดแท็บ GrabFood) ดังนั้นปิดหน้าจอแล้วจะไม่รับออเดอร์
- ยังไม่มีมุมมอง "ทั้งหมด" รวมสองแหล่ง, ยังไม่ตัดสต็อก (จับคู่ด้วย id เท่านั้น บรรทัดที่ไม่จับคู่ขึ้นป้ายแดง ยังไม่มีคิวแก้ไข), ยังไม่ส่งออเดอร์ไปครัวและไม่มีซิงก์เมนู
- ไม่มี webhook ขาเข้า (ไม่ทราบวิธียืนยันตัวตน), ยังไม่มีหลักฐานจาก sandbox จริง
