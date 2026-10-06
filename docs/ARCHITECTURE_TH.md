# BitPOS architecture draft

เอกสารออกแบบ ยังไม่มี services/schema/event implementation ใน repo นี้

## Product boundaries

- Merchant web: POS เดิมครบ, reports, staff roles, menu/stock, campaign และ dashboard
- Customer web: QR menu, guest/self-order, wallet binding, payment, loyalty/redeem
- Terminal client: order display, payment-channel selector, QR, idle display, success sound/animation
- Backend/worker: canonical pricing, payment verification, reward issuance, outbox, reconciliation
- Database: isolated BitPOS tenant schema/Auth/storage บน Supabase ที่ตรวจ topology แล้ว
- Solana: USDG settlement และ tokens/NFT เมื่อใช้ onchain rewards
- CryptoClock: optional terminal/home-device integration ไม่เป็น dependency บังคับของ POS

Browser terminal ทำให้พัฒนาจอและ demo ได้ก่อน hardware adapter แต่หลักฐานความเร็ว/ความสามารถ hardware ต้องมาจากเครื่องจริง

## Data flow

1. POS staff หรือ customer web สร้าง order; backend คำนวณราคาและสำรอง stock
2. Backend สร้าง immutable quote และ payment attempt; terminal แสดงรายการ/ยอด/order เดียวกัน
3. PromptPay: Stripe สร้าง QR; Solana: Actions API ประกอบ transaction ของ order ให้ client sign/send
4. Verified webhook หรือ chain watcher ตรวจหลักฐาน; transaction ของฐานข้อมูลบันทึก payment และเปลี่ยน order/stock พร้อม durable outbox
5. Outbox ส่ง paid event ไป terminal; terminal dedup/render/ACK
6. Reward worker ประเมิน campaign snapshot และออกแต้ม/NFT/voucher; แยก pending/issued/failed และ retry
7. Analytics อ่าน order/payment/reward records; chain reconciliation แก้ indexed state เมื่อพบความคลาดเคลื่อน

Actions ไม่ได้ยืนยันการจ่ายให้เอง และไม่ถือ client callback เป็น paid

## Source of truth

| ข้อมูล | แหล่งหลัก |
|---|---|
| เมนู, ราคา/ต้นทุน, order, stock, roles, campaign, fulfillment | Supabase/Postgres |
| Stripe payment/refund | Stripe verified records; index ลงฐานข้อมูล |
| Solana payment/token/NFT ownership | Solana transaction/account state; index ลงฐานข้อมูล |
| แต้ม offchain/voucher redemption | Database ledger และ atomic redemption |
| Token/NFT reward บนเชน | Chain ownership + database issuance/eligibility/fulfillment record |
| Terminal state | order backend; device ACK ใช้วัดการส่งถึง ไม่ใช่หลักฐาน payment |

ฐานข้อมูลและเชนไม่มี transaction เดียวที่ commit พร้อมกันได้ ต้องใช้ idempotency/reconciliation และ UI ที่แยก payment paid จาก reward pending

## Proposed domain entities

`merchants`, `merchant_members`, `locations`, `terminals`, `products`, `categories`, `suppliers`, `customers`, `customer_wallets`, `orders`, `order_items`, `payment_attempts`, `payments`, `refunds`, `stock_reservations`, `stock_movements`, `shift_closes`, `campaigns`, `campaign_versions`, `reward_grants`, `loyalty_ledger`, `vouchers`, `redemptions`, `fulfillments`, `outbox_events`, `device_deliveries`, `notification_preferences`, `external_orders`, `audit_logs`

นี่คือ domain inventory ไม่ใช่ final SQL; เฟส 2 ต้องเลือก constraints/indices/RLS/transactions พร้อม tests

## Proposed event contract

```json
{
  "schemaVersion": 1,
  "eventId": "evt_example",
  "type": "order.payment_confirmed",
  "merchantId": "merchant_example",
  "terminalId": "terminal_example",
  "orderId": "order_example",
  "occurredAt": "2026-10-07T00:00:00Z",
  "display": {
    "messageKey": "payment.success",
    "currency": "USDG",
    "amountMinor": "3500000",
    "decimals": 6,
    "animation": "payment-success",
    "sound": "success"
  },
  "rewardStatus": "pending"
}
```

ตัวเลข/decimals เป็นตัวอย่าง event เท่านั้น; production ตรวจ mint metadata/configuration จริง ไม่รับ currency/amount ที่ client ส่งมาเป็นยอดชำระ

Terminal รับเฉพาะ merchant/device ที่ token ของมันอนุญาต; transport เลือก WebSocket หรือ MQTT ให้สอดคล้องระบบที่มี แยก topic/auth namespace ของ BitPOS, event IDs, retry/ACK และ state resync ไม่ใส่ wallet/customer identifiers บนจอสาธารณะโดยไม่จำเป็น

## AI boundary

AI เข้าถึงข้อมูล merchant ที่ได้รับสิทธิ์และ query tools จำกัดขอบเขต ร่าง campaign เป็น structured output; deterministic rules ตรวจราคา/margin/budget/eligibility ก่อน owner publish บันทึก version ที่ใช้คำนวณรางวัล

ใช้ order history ที่ผูกกับ wallet อย่างถูกต้อง ไม่ถือว่า address หนึ่งระบุคนหนึ่งได้เสมอ และไม่ให้ AI ตัดสินว่าธุรกรรม paid หรือถือ treasury signing keys

## Environment and deployment

BitPOS มี local/staging/production configuration, webhook endpoints และ signing/service credentials ของตัวเอง การใช้ OCI เดียวกันทำได้ถ้ามี service/database boundary และ capacity ที่ตรวจจริง; ไม่หมายความว่าต้องสร้าง VM ใหม่ทุกครั้ง

Devnet test assets ต้องแยกป้ายจาก USDG จริง; mainnet demo เริ่มเมื่อ canonical mint, wallet support, webhook secrets และ operational checks พร้อม การ deploy และการแก้ production configuration ไม่ได้ทำในเฟส 0

## Technical references checked 2026-10-07

- [Solana Actions/Blinks](https://solana.com/docs/tools/actions): UI metadata, signable transactions, actions.json/CORS และ fallback website
- [signatureSubscribe](https://solana.com/docs/rpc/websocket/signaturesubscribe): confirmation notification; ไม่แทนการตรวจ transaction details
- [Stripe PromptPay](https://docs.stripe.com/payments/promptpay): QR payment integration
- [Supabase Docker self-hosting](https://supabase.com/docs/guides/self-hosting/docker): deployment/operational prerequisites
