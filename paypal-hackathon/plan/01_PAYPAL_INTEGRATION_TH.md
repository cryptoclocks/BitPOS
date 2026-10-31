# 01 · PayPal integration — รายละเอียดการเชื่อมต่อ

> **ผล Phase 0 (31 ต.ค., sandbox จริง) — ใช้แทนข้อสันนิษฐานด้านล่างที่ขัดกัน:** ร้านต้องเป็นบัญชี sandbox business **US** (บัญชี TH ถูกปฏิเสธตอนผู้ซื้ออนุมัติ) · capture ได้ `COMPLETED` ทันที มี gross/fee/net · capture ซ้ำ (request id เดิมหรือใหม่) ได้ 201 พร้อม capture เดิม **ไม่ใช่ 422** → ถือ 201 ที่มี capture id เดิมเป็น "already captured" · create ซ้ำหลัง capture ได้ 422 `ORDER_ALREADY_CAPTURED` → ใช้ order id ที่เก็บไว้แล้ว `getOrder()` · invoice_id ซ้ำ → capture ได้ 422 `DUPLICATE_INVOICE_ID` · create ตอบ HTTP 200 (ไม่ใช่ 201) สถานะ `PAYER_ACTION_REQUIRED` · `onApprove` ได้ `{orderId, payerId, fundingSource}` · SDK โหลดจาก `www.sandbox.paypal.com` เท่านั้น · ดู `evidence/phase0-spike.md`

> ส่วนหนึ่งของ [แผน implement](../IMPLEMENTATION_PLAN_TH.md) · ตรวจกับเอกสาร PayPal เมื่อ 31 ต.ค. 2026 (JS SDK v6 checkout, Webhooks, Idempotency, Orders v2 schema.json) · ค่าที่เขียนว่า **[spike]** ต้องยืนยันใน Phase 0 ก่อนเขียนโค้ดจริง

## 1. ข้อเท็จจริงจากเอกสารที่ใช้ออกแบบ

| เรื่อง | ค่าที่ตรวจแล้ว | แหล่ง |
|---|---|---|
| Script SDK sandbox | `https://www.sandbox.paypal.com/web-sdk/v6/core` | v6 PayPal checkout |
| สร้าง instance | `window.paypal.createInstance({ clientId, components: ["paypal-payments"] })` (ใช้ **Client ID** ตรงๆ ไม่ต้องมี client token ฝั่ง server ในตัวอย่างปัจจุบัน) | v6 PayPal checkout |
| ตรวจสิทธิ์ | `sdkInstance.findEligibleMethods()` แล้ว `eligibility.isEligible("paypal")` | v6 |
| Session | `sdkInstance.createPayPalOneTimePaymentSession({ onApprove, onCancel, onError })` | v6 |
| เริ่มจ่าย | `session.start({ presentationMode: "auto" }, createOrderPromise)`; `createOrderPromise` resolve เป็น `{ orderId }` | v6 |
| `onApprove(data)` | ได้ `data.orderId` แล้ว browser เรียก capture ฝั่ง server | v6 |
| `onError(err)` | `err.message` อาจมี `INSUFFICIENT_FUNDS`, `INSTRUMENT_DECLINED`, `TRANSACTION_REFUSED`, `DUPLICATE_INVOICE` | v6 |
| Orders status | `CREATED, SAVED, APPROVED, VOIDED, COMPLETED, PAYER_ACTION_REQUIRED` | schema.json |
| Capture status | `COMPLETED, DECLINED, PARTIALLY_REFUNDED, PENDING, REFUNDED, FAILED` | schema.json |
| เหตุผลของ PENDING/DENIED | มี `RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION`, `PENDING_REVIEW`, `UNILATERAL`, `VERIFICATION_REQUIRED`, `DECLINED_BY_RISK_FRAUD_FILTERS` ฯลฯ | schema.json |
| `custom_id` | ≤ 255 ตัวอักษร ผู้ซื้อไม่เห็น อยู่ในรายงาน | schema.json |
| `invoice_id` | ≤ 127, pattern `^[\w‘\-.,":;\!?]*$`, **ต้องไม่ซ้ำต่อ merchant account** | schema.json |
| `reference_id` | ≤ 256 | schema.json |
| `shipping_preference` | `GET_FROM_FILE, NO_SHIPPING, SET_PROVIDED_ADDRESS` | schema.json |
| `user_action` | `CONTINUE, PAY_NOW` | schema.json |
| `Prefer` | `return=minimal` หรือ `return=representation` | schema.json |
| `PayPal-Request-Id` | ต้องไม่ซ้ำต่อ request และต่อประเภท call (create กับ capture ใช้ค่าต่างกัน); ส่งค่าเดิมซ้ำ = ได้สถานะล่าสุดของ request แรก; ส่งพร้อมกันสองครั้ง ครั้งที่สองอาจ fail; ระยะเวลาเก็บ **ไม่ระบุในหน้าหลัก [spike]** | Idempotency |
| Webhook headers | `paypal-transmission-id`, `paypal-transmission-time`, `paypal-cert-url`, `paypal-transmission-sig` | Webhooks |
| ตรวจลายเซ็นเอง | ข้อความ `${transmissionId}\|${timeStamp}\|${webhookId}\|${crc32(rawBody) เป็นเลขฐานสิบ}` ตรวจด้วย SHA256 + public key ใน cert; **ห้าม parse แล้ว stringify ก่อนคำนวณ CRC** | Webhooks |
| ตรวจผ่าน API | `POST /v1/notifications/verify-webhook-signature` (fields `transmission_id, transmission_time, cert_url, auth_algo, transmission_sig, webhook_id, webhook_event`); ใช้กับ mock/simulator event **ไม่ได้** | Webhooks |
| Mock event | ตรวจเองได้ โดย webhook id คือข้อความ `WEBHOOK_ID` | Webhooks |
| Retry | ถ้าตอบไม่ใช่ 2xx PayPal ส่งซ้ำได้ถึง 25 ครั้งใน 3 วัน | Webhooks |

ผลต่อการออกแบบ:
- ไม่ต้องทำ endpoint client token เว้นแต่ spike พบว่า v6 ใน account นี้ต้องใช้ — ตัด endpoint `GET …/paypal/config` ให้เหลือแค่ `{enabled, clientId, amount, currency}` (Client ID เปิดเผยได้ ไม่ใช่ secret)
- ตรวจ webhook **แบบ offline เป็นหลัก** (ใช้ได้ทั้ง event จริงและ simulator, ไม่ต้องคง JSON เดิม) และใช้ API postback เป็นทางสำรองเฉพาะ event จริง
- เพราะ PayPal retry ได้ 3 วัน จึงกัน replay ด้วย `event_id` unique ไม่ใช้ timestamp tolerance สั้นๆ
- เก็บ `invoice_id` ไม่ซ้ำต่อ checkout (`BP` + checkout UUID ไม่มีขีด = 34 ตัว) เพราะ PayPal ปฏิเสธ invoice ซ้ำ ใช้ประโยชน์นี้เป็นด่านกันจ่ายซ้ำอีกชั้น

## 2. Configuration

| ตัวแปร | ตัวอย่าง | ตรวจ |
|---|---|---|
| `PAYPAL_ENVIRONMENT` | `sandbox` | ต้องเป็น `sandbox` เท่านั้น |
| `PAYPAL_API_BASE_URL` | `https://api-m.sandbox.paypal.com` | ต้องตรงค่านี้ทุกตัวอักษร อย่างอื่น = `LIVE_MODE_REFUSED` |
| `PAYPAL_CLIENT_ID` | (จาก dashboard) | 1–200 ตัว |
| `PAYPAL_CLIENT_SECRET` | (private) | 1–200 ตัว ห้ามขึ้นต้น `PUBLIC_`, ห้าม log |
| `PAYPAL_MERCHANT_ID` | Account ID ของ sandbox business **US** (เช่น 13 ตัวอักษร/ตัวเลข) | `^[A-Z0-9]{13}$` (ยืนยันแล้ว) |
| `PAYPAL_WEBHOOK_ID` | ได้หลังลงทะเบียน webhook | ว่างได้ใน dev (webhook ปิด) |
| `PAYPAL_CERT_HOST_SUFFIX` | `.paypal.com` | allowlist ของ `paypal-cert-url` |
| `BITPOS_PAYPAL_PUBLIC_URL` | `https://paypal-pay.cashlessthailand.com` | ใช้สร้าง `return_url`/`cancel_url` |

ไฟล์ private: `~/.bitpos-paypal/paypal-sandbox.env` (chmod 600) ในเครื่อง และ `/srv/bitpos-paypal/paypal-sandbox.env` (chmod 600, owner ของ container) บน OCI **[ยืนยัน path จริงบน OCI ตอน deploy]**

## 3. `apps/api/src/paypal/client.ts` — สัญญาของฟังก์ชัน

```ts
export interface PayPalConfig {apiBase:'https://api-m.sandbox.paypal.com';clientId:string;clientSecret:string;merchantId:string;webhookId:string|null;timeoutMs:number;}
export type PayPalFetch=(url:string,init:RequestInit)=>Promise<Response>;
export class PayPalError extends Error {constructor(readonly code:PayPalErrorCode,readonly issue?:string,readonly debugId?:string){super(code);}}
export type PayPalErrorCode='CONFIGURATION_REQUIRED'|'LIVE_MODE_REFUSED'|'AUTH_FAILED'|'OUTCOME_UNKNOWN'|'REJECTED'|'RESPONSE_INVALID'|'RESPONSE_TOO_LARGE'|'RESPONSE_MISMATCH';

accessToken(cfg,fetch):Promise<string>                 // cache ใน memory ถึง expires_in-60s; 401 ครั้งแรก → ล้าง cache แล้วลองใหม่ 1 ครั้ง
createOrder(cfg,input:CreateOrderInput,fetch):Promise<PayPalOrder>
captureOrder(cfg,paypalOrderId,requestId,fetch):Promise<CaptureResult>
getOrder(cfg,paypalOrderId,fetch):Promise<PayPalOrder>
getCapture(cfg,captureId,fetch):Promise<PayPalCapture>
verifyWebhookOffline(headers,rawBody:Buffer,webhookId,certFetch):Promise<void>   // throw PayPalError('REJECTED','WEBHOOK_SIGNATURE')
verifyWebhookPostback(cfg,headers,rawBody,fetch):Promise<void>                    // สำรอง เฉพาะ event จริง
```

กติการ่วมทุก call:
- `redirect:'error'`, `AbortSignal.timeout(cfg.timeoutMs)` (ค่าเริ่ม 15 วินาที), อ่าน body ไม่เกิน 256 KiB
- เก็บ `paypal-debug-id` จาก response header ลง log/ledger (ไม่ใช่ข้อมูลลับ ใช้ตอนขอ support)
- network error, timeout, 5xx, 429 → `OUTCOME_UNKNOWN` (ไม่ถือว่าล้มเหลว ต้อง reconcile)
- 4xx → `REJECTED` พร้อม `issue` แรกจาก `details[].issue`
- parse ด้วย zod แบบ passthrough เฉพาะ field ที่ใช้; field ที่จำเป็นหาย → `RESPONSE_INVALID`
- ห้าม log body ที่มี `payer.email_address`, ชื่อ, ที่อยู่ — เก็บเฉพาะ redacted view (§7)

## 4. Create order

ผู้เรียก: `POST /pay/:accessToken/paypal/orders` (หลังผ่าน `liveOrder(o)` + `assertOnlinePaymentAuthorization()` เดิม)

ขั้นตอนใน DB transaction A (สั้น, ไม่มี HTTP ข้างใน):
1. `SELECT … FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE`
2. ถ้ามี `paypal_checkouts` ที่ live อยู่ (`CREATING, CREATED, APPROVED, CAPTURING, PENDING, UNKNOWN`) → คืนอันเดิม (idempotent) ไม่สร้างใหม่
3. ถ้ามี `payment_attempts` สถานะ `BUILDING, READY, SUBMITTING, SUBMITTED, CONFIRMED` → `PAYMENT_PENDING` (409)
4. อ่าน quote/authority: `catalog_currency='USD'`, `catalog_decimals ∈ {2,4}`, `toPayPalValue(total_minor, decimals)` ต้องไม่เป็น `null`, quote เหลืออายุ ≥ 120 วินาที
5. `INSERT paypal_checkouts(status='CREATING', create_request_id=gen_random_uuid(), capture_request_id=gen_random_uuid(), amount_minor_cents, …)`
6. COMMIT

HTTP (นอก transaction):
```http
POST /v2/checkout/orders
Authorization: Bearer <token>
PayPal-Request-Id: <create_request_id>
Prefer: return=representation
Content-Type: application/json

{
  "intent": "CAPTURE",
  "purchase_units": [{
    "reference_id": "<order_id>",
    "custom_id": "bitpos:v1:<merchant_id>:<order_id>:<checkout_id>",
    "invoice_id": "BP<checkout_id without dashes>",
    "description": "BitPOS PayPal Café · table 4",
    "payee": {"merchant_id": "<PAYPAL_MERCHANT_ID>"},
    "amount": {"currency_code": "USD", "value": "9.00",
      "breakdown": {"item_total": {"currency_code": "USD", "value": "9.00"}}},
    "items": [{"name": "Croissant", "quantity": "2", "unit_amount": {"currency_code": "USD", "value": "4.50"}, "category": "PHYSICAL_GOODS"}]
  }],
  "payment_source": {"paypal": {"experience_context": {
    "brand_name": "BitPOS PayPal Café", "shipping_preference": "NO_SHIPPING", "user_action": "PAY_NOW",
    "locale": "en-US", "return_url": "<BITPOS_PAYPAL_PUBLIC_URL>/pay/<token>?paypal=return",
    "cancel_url": "<BITPOS_PAYPAL_PUBLIC_URL>/pay/<token>?paypal=cancel"}}}
}
```
- ใส่ `items`/`breakdown` เฉพาะเมื่อทุกบรรทัดแปลงเป็น cents ได้ exact และผลรวมตรง total; ไม่งั้นส่ง `amount.value` อย่างเดียว
- ชื่อสินค้าตัดที่ 127 ตัว ใช้ `name_en` (PayPal sandbox แสดงไทยได้ แต่กรรมการอ่านอังกฤษ)
- ข้อความใน `description` ห้ามมีข้อมูลลูกค้า

Transaction B: ถ้าได้ `id` + `status ∈ {CREATED, PAYER_ACTION_REQUIRED}` → `UPDATE paypal_checkouts SET paypal_order_id=$id, status='CREATED'` แล้วคืน `{paypalOrderId}`
- ถ้า `OUTCOME_UNKNOWN` → status `UNKNOWN`; ลองส่งซ้ำด้วย **create_request_id เดิม** ได้หนึ่งครั้งทันที ถ้ายังไม่รู้ผลให้ worker จัดการ ลูกค้าเห็น "กำลังติดต่อ PayPal ลองใหม่ในไม่กี่วินาที"
- ถ้า `REJECTED` → status `FAILED_CREATE` (ไม่ live) เก็บ issue; ลูกค้ากดลองใหม่ได้ = checkout ใหม่

## 5. Capture

ผู้เรียก: `POST /pay/:accessToken/paypal/capture {paypalOrderId}` (จาก `onApprove`) หรือ worker

Transaction A:
1. lock order + checkout (`WHERE paypal_order_id=$x AND order_id=$o`) — ID ไม่ตรง order นี้ → 404
2. ถ้า settlement มีแล้ว → คืนสถานะ order ทันที
3. เช็ก order ยัง payable: `reservation_released=false`, quote เหลือ ≥ 60 วินาที, ไม่ใช่ `PAID/RECOVERY/EXPIRED`; ไม่ผ่าน → `status='EXPIRED'` **ไม่ capture** (เงินไม่ขยับ) ลูกค้าเห็น "ราคาหมดอายุ กรุณาสั่งใหม่"
4. `status='CAPTURING', capture_started_at=clock_timestamp()` COMMIT

HTTP:
```http
POST /v2/checkout/orders/<paypal_order_id>/capture
PayPal-Request-Id: <capture_request_id>
Prefer: return=representation
Content-Type: application/json

{}
```

ผลลัพธ์ที่เป็นไปได้ → การทำงาน:

| ผล | ทำอะไร |
|---|---|
| 201/200, order `COMPLETED`, capture `COMPLETED` | `verifyCapture()` (§6) ผ่าน → transaction C: insert `paypal_captures` + เรียก `paypal_settle_capture()` → `CAPTURED` |
| capture `PENDING` | เก็บ capture + `status_details.reason` → checkout `PENDING` ลูกค้าเห็น "PayPal กำลังตรวจ" รอ webhook `PAYMENT.CAPTURE.COMPLETED` หรือ worker |
| capture `DECLINED`/`FAILED` | checkout `DECLINED` (ไม่ live) ลูกค้าจ่ายใหม่ได้ |
| 422 issue `ORDER_ALREADY_CAPTURED` **[spike: ชื่อ issue]** | `getOrder()` แล้วทำเหมือนแถวแรก |
| 422 issue `INSTRUMENT_DECLINED` **[spike]** | checkout กลับเป็น `APPROVED`-retry: ตอบ browser ให้เรียก `session.start()` ใหม่ (ตามแนวทาง restart ของ PayPal) |
| 422 issue `ORDER_NOT_APPROVED` **[spike]** | กลับเป็น `CREATED` ไม่ใช่ error ของลูกค้า |
| `OUTCOME_UNKNOWN` | คง `CAPTURING`; ส่งซ้ำด้วย **capture_request_id เดิม** หลัง 2 วินาทีหนึ่งครั้ง; ยังไม่รู้ → `UNKNOWN` ให้ worker; **ห้ามสร้าง PayPal order ใหม่** |
| ผลตรวจ §6 ไม่ผ่าน | เก็บ capture เป็น `MISMATCH` + alert ใน audit log; order **ไม่ paid**; ร้านต้องดูเอง (กรณีนี้ไม่ควรเกิดถ้า payee/amount มาจาก server) |

## 6. `verifyCapture(checkout, order)` — ทุกข้อต้องจริง

1. `order.id === checkout.paypal_order_id`
2. `order.purchase_units.length === 1`
3. `pu.reference_id === checkout.order_id`
4. `pu.custom_id === "bitpos:v1:<merchant>:<order>:<checkout>"` และ `pu.invoice_id === "BP…"` ของ checkout นี้ (ดูจาก capture ด้วยถ้ามี)
5. `pu.payee.merchant_id === PAYPAL_MERCHANT_ID` (จาก config ไม่ใช่จาก DB ที่ client แก้ได้)
6. capture: `captures.length === 1`, `status === 'COMPLETED'`, `final_capture === true`
7. `amount.currency_code === 'USD'` และ `amount.value === toPayPalValue(checkout.amount_minor_cents, 2)` (เทียบ string หลัง normalize แบบ exact)
8. `seller_receivable_breakdown.gross_amount` = amount เดียวกัน (ไม่ใช้ `net_amount`)
9. capture id ไม่เคยผูกกับ checkout อื่น (unique constraint จะกันซ้ำอีกชั้น)

## 7. ข้อมูลที่เก็บจาก PayPal (redacted)

เก็บใน `paypal_captures.redacted` เท่านั้น:
```json
{"orderId":"…","orderStatus":"COMPLETED","captureId":"…","captureStatus":"COMPLETED","statusReason":null,
 "amount":{"currency":"USD","value":"9.00"},"gross":"9.00","fee":"0.62","net":"8.38",
 "payeeMerchantId":"…","customId":"bitpos:v1:…","invoiceId":"BP…","createTime":"…","updateTime":"…","debugId":"…"}
```
ไม่เก็บ: อีเมล/ชื่อ/payer id/ที่อยู่ของผู้ซื้อ, access token, raw body ฉบับเต็ม (webhook เก็บแค่ `sha256` ของ raw body + redacted)

## 8. Webhook

Endpoint: `POST /paypal/webhooks` (ไม่ผ่าน session/cookie, ขนาด body ≤ 64 KiB, content-type `application/json`)

ลำดับ:
1. อ่าน raw body เป็น `Buffer` **ก่อน** parse (ต้องแก้ router ให้ path นี้ไม่ parse JSON อัตโนมัติ — ตรวจวิธีใน Elysia ที่ใช้อยู่)
2. ตรวจ header ครบ 4 ตัว; `paypal-cert-url` ต้องเป็น `https:` และ host ลงท้าย `.paypal.com`; ดึง cert (cache ตาม URL 24 ชม., timeout 5 วินาที, ≤ 16 KiB) ตรวจวันหมดอายุของ cert
3. `crc = zlib.crc32(rawBody) >>> 0` (Node ≥ 22.2 มี `zlib.crc32`; บนเครื่องเป็น v26 — ตรวจ version ใน image `bitpos-runtime:current` **[deploy]**)
4. `crypto.verify('sha256', Buffer.from(`${id}|${time}|${webhookId}|${crc}`), cert.publicKey, Buffer.from(sig,'base64'))`
5. ไม่ผ่าน → 400 ไม่เขียนอะไรเพิ่ม (นับใน metric `paypal_webhook_rejected`)
6. ผ่าน → parse JSON → `paypal_webhook_receive(event_id, event_type, resource_type, resource_id, transmission_id, sha256, redacted)` (SECURITY DEFINER, `ON CONFLICT (event_id) DO NOTHING`) → ตอบ **200 ทันที**
7. ประมวลผลหลังตอบ (ใน process เดียวกันแบบ fire-and-forget + worker เก็บตก):
   - แยก merchant/order/checkout จาก `resource.custom_id` (ข้อมูลนี้ PayPal เซ็นมาแล้ว และเรายังตรวจกับ DB อีกครั้ง)
   - **เรียก `getCapture()` หรือ `getOrder()` ใหม่ทุกครั้ง** ไม่ใช้ตัวเลขจาก body ของ event เป็นหลักฐาน
   - ส่งผลเข้า flow §5 ตารางผลลัพธ์เดียวกัน

Event ที่ subscribe:

| Event | ทำอะไร |
|---|---|
| `CHECKOUT.ORDER.APPROVED` | ถ้า checkout ยัง `CREATED` → `APPROVED`; ถ้าลูกค้าปิดหน้าไปก่อน onApprove worker จะ capture ให้ (ถ้า order ยัง payable) |
| `PAYMENT.CAPTURE.COMPLETED` | ดึง capture → settle (ถ้ายังไม่ settle) |
| `PAYMENT.CAPTURE.PENDING` | อัปเดต reason |
| `PAYMENT.CAPTURE.DENIED` / `PAYMENT.CAPTURE.DECLINED` | checkout `DECLINED`; ถ้าเคย settle แล้ว (ไม่ควรเกิด) → `paypal_payment_events` + audit ไม่ย้อน stock เอง |
| `PAYMENT.CAPTURE.REFUNDED` / `PAYMENT.CAPTURE.REVERSED` | insert `paypal_payment_events(kind='REFUNDED'/'REVERSED', amount)`; outcome แสดงแยก; ไม่ย้อนบิล/stock |

ลงทะเบียน webhook (Phase 8): dashboard ของแอป "BitPOS AI Hackathon 2026" → Sandbox webhooks → URL `https://paypal-pay.cashlessthailand.com/paypal/webhooks` → เลือก 7 event ข้างบน → คัด Webhook ID ใส่ env private (ผู้ใช้ทำเอง หรือ Claude ทำหลังได้รับอนุญาต ณ เวลาที่ทำ)

## 9. Worker reconcile (`apps/worker/src/paypal-reconcile.ts`)

รอบละ 15 วินาที ต่อ merchant ที่เปิด PayPal; ใช้ `pg_try_advisory_xact_lock(hashtext('paypal-reconcile:'||merchant))` กันสอง worker ทำพร้อมกัน

| เงื่อนไข | การทำงาน | จำกัด |
|---|---|---|
| `CREATING` > 30 วิ หรือ `UNKNOWN` ที่ไม่มี `paypal_order_id` | ส่ง create ซ้ำด้วย `create_request_id` เดิม | 5 ครั้ง backoff 15/30/60/120/240 วิ แล้ว `FAILED_CREATE` |
| `CREATED` ที่ quote หมดอายุ | `EXPIRED` (ไม่ต้องเรียก PayPal; order ที่ไม่ approve จะหมดอายุเองฝั่ง PayPal) | — |
| `APPROVED` (จาก webhook) ที่ order ยัง payable | capture ด้วย `capture_request_id` เดิม | 3 ครั้ง |
| `APPROVED` ที่ order ไม่ payable แล้ว | `EXPIRED` ไม่ capture | — |
| `CAPTURING`/`UNKNOWN` > 30 วิ | `getOrder()` → มี capture → verify → settle; ไม่มี capture และ `APPROVED` → capture ซ้ำด้วย id เดิม | ไม่จำกัด แต่ backoff ถึง 10 นาที; เกิน 24 ชม. → alert |
| `PENDING` | `getCapture()` ทุก 5 นาที | ถึง 72 ชม. |
| inbox `processed_at IS NULL` > 60 วิ | ประมวลผลซ้ำ | 10 ครั้ง แล้ว `last_error` + alert |

Worker ตายกลางทาง: สถานะทุกอย่างอยู่ใน DB, request id คงเดิม → รอบถัดไปทำต่อได้โดยไม่จ่ายซ้ำ

## 10. Front-end (`apps/web/src/components/paypal/PayPalCheckout.tsx`)

```ts
// โหลดครั้งเดียว (paypal-sdk.ts)
const sdk = await loadPayPalV6();                       // <script src="https://www.sandbox.paypal.com/web-sdk/v6/core" async>
const instance = await sdk.createInstance({clientId, components:['paypal-payments'], pageType:'checkout'}); // pageType [spike]
const eligible = (await instance.findEligibleMethods()).isEligible('paypal');
const session = instance.createPayPalOneTimePaymentSession({
  onApprove: async ({orderId}) => setState(await capture(orderId)),   // POST /pay/:token/paypal/capture
  onCancel: () => { void cancel(); setState('cancelled'); },          // POST /pay/:token/paypal/cancel
  onError: (err) => setState(mapError(err.message)),
});
button.onclick = () => session.start({presentationMode:'auto'}, createOrder()); // createOrder() → {orderId}
```
- ต้องเรียก `session.start()` จาก click handler โดยตรง (popup blocker) และส่ง promise ของ createOrder เข้าไป ไม่ await ก่อน
- สถานะ UI: `idle → creating → awaiting_approval → confirming → paid | pending | cancelled | declined | expired | error`
- "paid" แสดงจาก order stream/`GET /pay/:token` เท่านั้น ไม่ใช่จาก `onApprove`
- หน้า return (`?paypal=return`) ใช้กรณี redirect/full-page: เรียก capture ด้วย `paypalOrderId` จาก checkout ฝั่ง server (ไม่เชื่อ `token` ใน query เป็นหลักฐาน)
- ถ้า `eligible === false` หรือโหลด script ไม่ได้ (เช่น in-app browser) แสดงปุ่ม "เปิดใน Safari/Chrome" + ลิงก์ approve จาก `links[rel=payer-action]` (P1)
- CSP: ตอนนี้ไม่มี header CSP ใน proxy/Astro ถ้าเพิ่มภายหลังต้องอนุญาต `https://www.sandbox.paypal.com`, `https://*.paypal.com`, `https://*.paypalobjects.com` ใน `script-src`, `frame-src`, `connect-src`, `img-src` **[spike: รายชื่อโดเมนที่ SDK ใช้จริงจาก network log]**

## 11. Error mapping ที่ลูกค้าเห็น (TH / EN)

| สถานะ/รหัส | ไทย | English |
|---|---|---|
| creating | กำลังเปิด PayPal… | Opening PayPal… |
| confirming | กำลังยืนยันการชำระเงินกับ PayPal… | Confirming your payment with PayPal… |
| pending | PayPal กำลังตรวจสอบการชำระเงิน ร้านจะเห็นเมื่อยืนยันแล้ว | PayPal is reviewing this payment. The café will see it once confirmed. |
| cancelled | ยกเลิกแล้ว กดจ่ายอีกครั้งได้ | Payment cancelled. You can try again. |
| declined / `INSTRUMENT_DECLINED` | PayPal ปฏิเสธวิธีชำระนี้ ลองบัตรหรือบัญชีอื่น | PayPal declined this method. Try another card or account. |
| expired | ราคาหมดอายุ กรุณาตรวจรายการและสั่งใหม่ | This price expired. Please review and order again. |
| `PAYMENT_PENDING` (Solana ค้าง) | มีการชำระอีกช่องทางกำลังดำเนินการ | Another payment for this order is in progress. |
| error/unknown | ยังไม่ทราบผลจาก PayPal กำลังตรวจอีกครั้ง ห้ามจ่ายซ้ำ | We are still checking with PayPal. Please don't pay again. |
