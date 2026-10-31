# 02 · Data model และ settlement

> ส่วนหนึ่งของ [แผน implement](../IMPLEMENTATION_PLAN_TH.md) · SQL ด้านล่างเป็น **ร่างสำหรับออกแบบ** ต้องเทียบกับ migrations ที่ import มาจาก h2 (ถึง 176) ก่อนเขียนไฟล์จริง

> **ผลจาก Phase 2 (31 ต.ค.):** core schema บังคับให้ทุก order freeze quote แบบ Solana (`order_authority.settlement`, trigger `freeze_default_payment_quote`) และสร้าง order ไม่ได้ถ้าร้านไม่มี payment asset ที่เปิดอยู่ (`PAYMENT_ASSET_UNAVAILABLE`) ร้านเดโม PayPal จึง **ต้องเปิด asset ทดสอบไว้เป็น quote anchor** แต่ซ่อนตัวเลือกจ่ายด้วย crypto ใน UI (Phase 3) — ไม่ใช่ปิด asset ตามที่ §9 เขียนไว้ · `details.settlement` ที่ publish ยังเป็น quote settlement เดิม ข้อมูลการจ่ายจริงของ PayPal อยู่ใน `paypal_settlements`/`paypal_captures` → Phase 3 ต้องให้ใบเสร็จ/หน้าจ่ายแสดง provider จากตารางเหล่านี้ ไม่ใช่จาก settlement JSON · `paypal_settle_capture()` คืนค่าว่าง (ไม่ใช่ error) เมื่อ capture นี้ settle แล้ว เหมือน `settle_verified_attempt`

## 1. หลักการ

- schema `bitpos`, `SET search_path TO bitpos,extensions,public;` บรรทัดแรกเหมือน migration อื่น
- ทุกตารางมี `merchant_id` และ policy `tenant_access` แบบเดียวกับตารางเดิม (`merchant_id::text=current_setting('bitpos.merchant',true)`) ยกเว้น inbox ของ webhook (§6) ที่เข้าผ่านฟังก์ชัน SECURITY DEFINER เท่านั้น
- FK แบบคู่ `(merchant_id, id)` เหมือนตารางเดิม เพื่อกันข้าม tenant ระดับ DB
- เวลาใช้ `clock_timestamp()`; เงินเป็น `bigint` cents (USD 2 ทศนิยม)
- additive เท่านั้น; ไม่แก้ `settle_verified_attempt`, `payments`, `payment_attempts` (ยกเว้น trigger ใหม่ที่เพิ่มบน `payment_attempts`)
- ไฟล์ขึ้นต้นด้วย comment provenance ของ PayPal
- ทุก migration ต้องรันซ้ำบน DB ว่าง (fixture) และ DB ที่มี `meta_*` แล้วผ่าน

## 2. `400_paypal_merchant.sql`

```sql
CREATE TABLE paypal_merchant_settings(
 merchant_id uuid PRIMARY KEY REFERENCES merchants,
 enabled boolean NOT NULL DEFAULT false,
 environment text NOT NULL DEFAULT 'sandbox' CHECK(environment='sandbox'),
 payee_merchant_id text NOT NULL CHECK(payee_merchant_id ~ '^[A-Z0-9]{8,20}$'),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 max_order_minor bigint NOT NULL DEFAULT 100000 CHECK(max_order_minor BETWEEN 100 AND 1000000), -- ≤ USD 10,000
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
```
- `payee_merchant_id` ใน DB มีไว้แสดงผล; ตอน verify ใช้ค่าจาก env และต้องตรงกับค่าใน DB ด้วย (สองชั้น)
- แก้ได้เฉพาะ role `owner` ผ่าน seed/SQL ใน hackathon (ไม่ทำหน้า settings)

## 3. `401_paypal_ledger.sql`

```sql
CREATE TABLE paypal_checkouts(
 merchant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), order_id uuid NOT NULL,
 quote_id uuid NOT NULL, order_version int NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),           -- cents
 currency text NOT NULL CHECK(currency='USD'),
 payee_merchant_id text NOT NULL,
 create_request_id uuid NOT NULL UNIQUE, capture_request_id uuid NOT NULL UNIQUE,
 invoice_id text NOT NULL UNIQUE CHECK(invoice_id ~ '^BP[0-9a-f]{32}$'),
 paypal_order_id text UNIQUE CHECK(paypal_order_id ~ '^[A-Z0-9]{10,30}$'),
 status text NOT NULL DEFAULT 'CREATING' CHECK(status IN ('CREATING','CREATED','APPROVED','CAPTURING','CAPTURED','PENDING','UNKNOWN','DECLINED','EXPIRED','FAILED_CREATE','MISMATCH')),
 campaign_envelope_id uuid,
 last_issue text, last_debug_id text, attempts int NOT NULL DEFAULT 0, next_check_at timestamptz,
 cancelled_at timestamptz, approved_at timestamptz, capture_started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id) REFERENCES paypal_merchant_settings(merchant_id),
 CHECK((status IN ('CREATING','FAILED_CREATE')) OR paypal_order_id IS NOT NULL)
);
-- checkout ที่ยังเปลี่ยนสถานะได้ มีได้แค่หนึ่งต่อ order
CREATE UNIQUE INDEX paypal_one_live_checkout ON paypal_checkouts(merchant_id,order_id)
 WHERE status IN ('CREATING','CREATED','APPROVED','CAPTURING','PENDING','UNKNOWN');
CREATE INDEX paypal_checkouts_due ON paypal_checkouts(merchant_id,next_check_at)
 WHERE status IN ('CREATING','APPROVED','CAPTURING','PENDING','UNKNOWN');

CREATE TABLE paypal_captures(
 merchant_id uuid NOT NULL, capture_id text NOT NULL CHECK(capture_id ~ '^[A-Z0-9]{10,30}$'),
 checkout_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('COMPLETED','PENDING','DECLINED','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
 status_reason text, gross_minor bigint NOT NULL CHECK(gross_minor>0), fee_minor bigint, net_minor bigint,
 currency text NOT NULL CHECK(currency='USD'), payee_merchant_id text NOT NULL,
 verified_via text NOT NULL CHECK(verified_via IN ('capture_response','order_lookup','capture_lookup')),
 verified boolean NOT NULL, mismatch text, redacted jsonb NOT NULL,
 first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,capture_id), UNIQUE(capture_id),
 FOREIGN KEY(merchant_id,checkout_id) REFERENCES paypal_checkouts(merchant_id,id)
);
CREATE UNIQUE INDEX paypal_one_capture_per_checkout ON paypal_captures(merchant_id,checkout_id);

CREATE TABLE paypal_settlements(
 merchant_id uuid NOT NULL, order_id uuid NOT NULL, checkout_id uuid NOT NULL, capture_id text NOT NULL,
 amount_minor bigint NOT NULL, state text NOT NULL CHECK(state IN ('SETTLED','RECOVERY')),
 recovery_reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,capture_id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id),
 FOREIGN KEY(merchant_id,checkout_id) REFERENCES paypal_checkouts(merchant_id,id),
 FOREIGN KEY(merchant_id,capture_id) REFERENCES paypal_captures(merchant_id,capture_id),
 CHECK(state='SETTLED' OR recovery_reason IS NOT NULL)
);
-- order หนึ่งมี SETTLED ได้หนึ่งอัน; capture ที่สองของ order เดียวกันต้องเป็น RECOVERY ไม่หาย
CREATE UNIQUE INDEX paypal_one_settled_per_order ON paypal_settlements(merchant_id,order_id) WHERE state='SETTLED';

CREATE TABLE paypal_payment_events(            -- refund/reversal/dispute หลัง settle
 merchant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), capture_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('REFUNDED','PARTIALLY_REFUNDED','REVERSED','DENIED_AFTER_SETTLE')),
 amount_minor bigint, source_event_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,id), UNIQUE(merchant_id,source_event_id),
 FOREIGN KEY(merchant_id,capture_id) REFERENCES paypal_captures(merchant_id,capture_id)
);
```

### Mutex สองช่องทาง (อยู่ใน 401)

```sql
CREATE FUNCTION paypal_block_solana_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM bitpos.paypal_checkouts c WHERE c.merchant_id=NEW.merchant_id AND c.order_id=NEW.order_id
   AND c.status IN ('CREATING','CREATED','APPROVED','CAPTURING','PENDING','UNKNOWN','CAPTURED')) THEN
  RAISE EXCEPTION 'PAYMENT_PENDING' USING ERRCODE='55P03';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER paypal_block_solana_attempt BEFORE INSERT ON payment_attempts FOR EACH ROW EXECUTE FUNCTION paypal_block_solana_attempt();
```
- ฝั่ง PayPal ตรวจ `payment_attempts` live ภายใต้ `orders FOR UPDATE` (01 §4 ข้อ 3)
- trigger ไม่เห็น checkout ที่ยังไม่ commit — ป้องกันด้วยการที่ทั้งสองฝั่ง lock แถว `orders` ก่อนเสมอ **[ตรวจว่าโค้ด Solana lock order ก่อน insert attempt จริง ถ้าไม่ ให้ trigger `SELECT … FROM orders … FOR UPDATE` เอง]**
- ทดสอบใน T-DB-07/08 ([05](05_TESTS_TH.md))
- error code `PAYMENT_PENDING` ต้อง map เป็น 409 ในตัวจัดการ error เดิม

## 4. `402_paypal_settlement.sql` — `paypal_settle_capture()`

```text
paypal_settle_capture(p_merchant uuid, p_order uuid, p_checkout uuid, p_capture text)
 RETURNS TABLE(updated_order bitpos.orders, details jsonb)   -- รูปเดียวกับ settle_verified_attempt
 SECURITY INVOKER, search_path=bitpos,pg_temp

1  tenant check: current_setting('bitpos.merchant') = p_merchant ไม่งั้น TENANT_CONTEXT_MISMATCH
2  SELECT order FOR UPDATE                          (ลำดับ lock เดียวกับ Solana: order → payment rows → products)
3  SELECT checkout FOR UPDATE (merchant,order,id ต้องตรง)
4  SELECT capture (merchant,capture,checkout ต้องตรง)
5  ถ้ามี paypal_settlements ของ capture นี้แล้ว → คืน order ปัจจุบัน + details (idempotent) แล้ว RETURN
6  ตรวจ: capture.verified=true, status='COMPLETED', gross_minor=checkout.amount_minor, currency='USD',
         payee_merchant_id=checkout.payee_merchant_id; ไม่ตรง → RAISE PAYMENT_QUOTE_MISMATCH
7  v_late := order.reservation_released OR checkout.expires_at<=clock_timestamp()
             OR order.status IN ('PAID','RECOVERY') OR online_acceptance_ended(p_merchant,p_order)
             OR EXISTS(paypal_settlements SETTLED ของ order นี้) OR EXISTS(payments SETTLED ของ order นี้)
8  ถ้ายังไม่ปล่อย reservation: lock products ของ order ORDER BY id FOR UPDATE
9  INSERT paypal_settlements(state = CASE v_late THEN 'RECOVERY' ELSE 'SETTLED', recovery_reason)
10 ถ้ายังไม่ปล่อย reservation: UPDATE products SET stock=stock-(v_late?0:qty), reserved=reserved-qty  (สูตรเดียวกับเดิม)
11 campaign units: UPDATE paypal_campaign_units SET state=(v_late?'RELEASED':'CONSUMED') WHERE order
12 UPDATE checkout SET status='CAPTURED'
13 UPDATE orders SET status=(v_late?'RECOVERY':'PAID'), version=version+1, paid_at=now(), reservation_released=true
14 PERFORM ensure_online_decision_refunds(p_merchant,p_order)   (เหมือนเดิม ถ้าฟังก์ชันยังมีใน 176)
15 ถ้า authority_version=2 และ PAID: INSERT device_sound_effects … ON CONFLICT DO NOTHING
16 สร้าง details แบบเดียวกับ settle_verified_attempt บรรทัดต่อบรรทัด แต่
     'settlement' := paypal_effective_settlement(p_merchant,p_order)
     'ambiguous'  := จำนวน checkout live ของ order (แทน payment_attempts)
17 RETURN NEXT
```
- `paypal_effective_settlement()` คืน `{"provider":"paypal","environment":"sandbox","currency":"USD","decimals":2,"amountMinor":"900","captureId":"…","paypalOrderId":"…"}`
- **ต้องตรวจ** ว่า `effective_payment_settlement()` เดิมถูกเรียกจากที่อื่น (order view, receipt, device payload) — ถ้าใช่ ต้องทำ wrapper `order_payment_settlement()` ที่คืนของ PayPal เมื่อมี `paypal_settlements` ไม่งั้นใบเสร็จ/จอจะแสดง USDG ผิด ไล่ทุกจุดที่เรียกด้วย `grep -rn effective_payment_settlement`
- `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO bitpos_app;`
- ฝั่ง TS: `settlePayPal(db,checkout,captureId)` เรียกฟังก์ชันนี้แล้ว `publishOrderFromDetails(db,updated,details,occurredAt)` เหมือน `settleAttempt()`

## 5. Order view / receipt

- `GET /pay/:accessToken` เดิมคืน `paymentSignature` จาก `payments` → เพิ่ม `payment: {provider:'paypal', captureId, amount, currency}` เมื่อมี `paypal_settlements` SETTLED (แก้ไฟล์เดิม 1 จุด → PROVENANCE)
- POS order center/ใบเสร็จ: แสดง `PayPal · capture <6 ตัวท้าย>` แทน signature ลิงก์ explorer (ซ่อนลิงก์ Solana explorer เมื่อ provider=paypal)
- รายงานยอดขายเดิมนับจาก `orders.status='PAID'` อยู่แล้ว → ยอด PayPal เข้ารายงานเดิมโดยอัตโนมัติ **[ตรวจ reports.ts ว่าไม่ join `payments` แบบ inner]**

## 6. `403_paypal_webhooks.sql`

```sql
CREATE TABLE paypal_webhook_inbox(          -- ไม่มี tenant policy: เขียน/อ่านผ่านฟังก์ชันเท่านั้น
 event_id text PRIMARY KEY CHECK(event_id ~ '^WH-[A-Z0-9-]{10,80}$'),
 event_type text NOT NULL, resource_type text, resource_id text, transmission_id text NOT NULL,
 body_sha256 text NOT NULL, redacted jsonb NOT NULL, merchant_id uuid, order_id uuid, checkout_id uuid,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), deliveries int NOT NULL DEFAULT 1,
 processed_at timestamptz, process_attempts int NOT NULL DEFAULT 0, last_error text
);
REVOKE ALL ON paypal_webhook_inbox FROM PUBLIC, bitpos_app;
-- receive: ON CONFLICT(event_id) DO UPDATE SET deliveries=deliveries+1 → คืน (is_new, processed_at)
-- claim(limit): เลือกแถวที่ processed_at IS NULL FOR UPDATE SKIP LOCKED
-- mark_processed(event_id, merchant, order, checkout) / mark_failed(event_id, error)
```
ฟังก์ชันทั้งสี่เป็น `SECURITY DEFINER` เจ้าของคือ role migration, `GRANT EXECUTE … TO bitpos_app` เท่านั้น
- `merchant_id` ได้มาจาก `custom_id` ที่ parse แล้ว และตรวจว่า checkout มีอยู่จริงใน tenant นั้นก่อน `mark_processed`

## 7. `404_paypal_campaign.sql`

```sql
CREATE TABLE paypal_campaign_envelopes(
 merchant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL,                       -- promotion_campaigns เดิม (หนึ่ง envelope ต่อ campaign)
 agent_run_id uuid,                               -- null = สร้างจาก rules baseline หรือมือ
 product_id uuid NOT NULL,                        -- P0: สินค้าเดียว ตรงกับ promotion_campaigns.product_id
 max_units int NOT NULL CHECK(max_units BETWEEN 1 AND 500),
 max_units_per_order int NOT NULL DEFAULT 4 CHECK(max_units_per_order BETWEEN 1 AND max_units),
 max_discount_percent int NOT NULL CHECK(max_discount_percent BETWEEN 1 AND 50),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 version int NOT NULL DEFAULT 1, approved_version int, approved_by text, approved_at timestamptz,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','APPROVED','ENDED','REVOKED')),
 ended_reason text CHECK(ended_reason IN ('SOLD_OUT','TIME','REVOKED','STOCK')),
 PRIMARY KEY(merchant_id,id), UNIQUE(merchant_id,campaign_id),
 FOREIGN KEY(merchant_id,campaign_id) REFERENCES promotion_campaigns(merchant_id,id),
 FOREIGN KEY(merchant_id,product_id) REFERENCES products(merchant_id,id),
 CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '24 hours'),
 CHECK(state<>'APPROVED' OR approved_version=version)
);
CREATE TABLE paypal_campaign_units(
 merchant_id uuid NOT NULL, envelope_id uuid NOT NULL, order_id uuid NOT NULL,
 units int NOT NULL CHECK(units>0), state text NOT NULL DEFAULT 'RESERVED' CHECK(state IN ('RESERVED','CONSUMED','RELEASED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,envelope_id,order_id),
 FOREIGN KEY(merchant_id,envelope_id) REFERENCES paypal_campaign_envelopes(merchant_id,id),
 FOREIGN KEY(merchant_id,order_id) REFERENCES orders(merchant_id,id)
);
```

ฟังก์ชัน `paypal_reserve_campaign_units(p_merchant, p_envelope, p_order, p_units)` เรียกใน transaction เดียวกับการสร้าง order จาก QR ของ campaign:
1. `SELECT envelope FOR UPDATE`; ต้อง `APPROVED`, `now() BETWEEN starts_at AND ends_at`
2. `p_units ≤ max_units_per_order`
3. `used := SUM(units) WHERE state IN ('RESERVED','CONSUMED')`; `used + p_units ≤ max_units` ไม่งั้น `CAMPAIGN_SOLD_OUT`
4. INSERT units `RESERVED`
5. ถ้า `used + p_units = max_units` ยังไม่ปิด envelope (อาจมี RESERVED ที่หมดอายุแล้วคืน) — ปิด `SOLD_OUT` เมื่อ CONSUMED = max_units

ปล่อยสิทธิ์: hook ใน `releaseReservation()` เดิม (ไฟล์เดิม 1 จุด) → `UPDATE … SET state='RELEASED' WHERE order_id AND state='RESERVED'`
หมดเวลา: worker ทุกนาที → envelope `ENDED/TIME`, revoke promotion target ผ่าน flow เดิม (`revoke`)
ขยายเวลา/เพิ่มจำนวน = แก้ envelope → `version+1`, `state='DRAFT'` ต้อง approve ใหม่

### ราคา campaign มาจากไหน
- ใช้ `promotion_campaigns.discount_percent` + `promotionPrice()` เดิม ผ่าน scoped offer pipeline เดิม (`quote_scoped_promotions`) → quote freeze ราคา
- envelope เพิ่มแค่ "จำนวนรวม" + "ต่อ order" + "ช่วงเวลา" ไม่คิดราคาเอง
- ถ้า scoped offer เดิมจำกัด `quantity_limit=1` ต่อ session (027) — P0 ใช้ 1 ชิ้นลดราคาต่อ session ตามเดิม แล้วให้ `max_units_per_order=1` **[ตัดสินใจหลังอ่านโค้ด scoped offer ใน h2: ถ้าแก้ให้ >1 ได้ปลอดภัยค่อยขยาย]**

## 8. `405_paypal_agent_trace.sql`

```sql
CREATE TABLE paypal_agent_runs(
 merchant_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), actor text NOT NULL,
 intent text NOT NULL CHECK(char_length(intent) BETWEEN 3 AND 600), language text NOT NULL CHECK(language IN ('th','en')),
 kind text NOT NULL CHECK(kind IN ('model','rules_baseline')),
 provider text, model text, state text NOT NULL DEFAULT 'RUNNING' CHECK(state IN ('RUNNING','DRAFTED','NEEDS_INPUT','REJECTED','FAILED')),
 failure text, steps int NOT NULL DEFAULT 0, input_tokens int, output_tokens int, cost_microusd bigint,
 campaign_id uuid, envelope_id uuid, started_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 PRIMARY KEY(merchant_id,id)
);
CREATE TABLE paypal_agent_steps(
 merchant_id uuid NOT NULL, run_id uuid NOT NULL, seq int NOT NULL CHECK(seq BETWEEN 1 AND 12),
 kind text NOT NULL CHECK(kind IN ('model_call','tool_call','tool_result','validation','final')),
 tool text, args jsonb, result jsonb, violations jsonb, provider_request_id text, latency_ms int,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,run_id,seq), FOREIGN KEY(merchant_id,run_id) REFERENCES paypal_agent_runs(merchant_id,id)
);
```
- `result` เก็บแบบย่อ (เช่น `{products:3, matched:"Croissant", stock:8}`) ไม่เก็บ prompt ทั้งก้อน
- `intent` เป็นข้อความของเจ้าของร้าน ห้ามมีข้อมูลลูกค้า (UI เตือน)

## 9. Seed ร้านเดโม (`tools/paypal/seed-paypal-cafe.sql`)

- merchant ใหม่ UUID คงที่ `70707070-7070-4070-8070-707070707070` (31 ต.ค.: `33333333-…` ชนกับ Muse Café ของ Meta บน DB จริง จึงเปลี่ยน), ชื่อ `BitPOS PayPal Café`
- price version ใหม่ `USD` 2 ทศนิยม: Croissant 4.50, Latte 5.00, Americano 3.50, Matcha 5.50, Banana bread 4.00, Cold brew 4.50 (เป็น fixture ระบุชัด)
- stock: Croissant 8, อื่นๆ 30
- 2 โต๊ะ + 1 device (browser terminal) + 1 slot สำหรับ Mini
- `merchant_payment_assets` ของร้านนี้ไม่เปิด USDG/USDC/USDT → หน้าจ่ายมีแต่ PayPal
- `paypal_merchant_settings(enabled=true, payee_merchant_id=<sandbox>)`
- staff: owner demo account สำหรับ `BITPOS_DEMO_QUICK_SIGNIN` (ใช้กลไกเดิมของ demo-auth)
- seed รันซ้ำได้ (`ON CONFLICT DO NOTHING`/`UPDATE`) และมี `tools/paypal/reset-demo.sql` สำหรับก่อนกรรมการทดสอบ: เติม stock, จบ campaign เก่า (`ENDED`), ปล่อยจอ — **ไม่ลบ** order/ledger/trace เพื่อให้หลักฐานยังตรวจย้อนได้
