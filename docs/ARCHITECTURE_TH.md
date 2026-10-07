# BitPOS architecture draft

เอกสารออกแบบ ยังไม่มี services/schema/event implementation ใน repo นี้

## Product boundaries

- Merchant web: POS เดิมครบ, reports, staff roles, menu/stock, campaign และ dashboard
- Customer web: QR menu, guest/self-order, wallet binding, payment, loyalty/redeem
- Terminal client: order display, payment-channel selector, QR, idle display, success sound/animation
- Store firmware: `device/firmware/` ใน repo นี้ แยกจากฐาน CryptoClock Pro และมี product/config/build/provisioning/OTA ของ BitPOS เอง
- Backend/worker: canonical pricing, payment verification, reward issuance, outbox, reconciliation
- Database: isolated BitPOS tenant schema/Auth/storage บน Supabase ที่ตรวจ topology แล้ว
- Solana: USDG settlement และ tokens/NFT เมื่อใช้ onchain rewards
- CryptoClock เดิม: optional legacy/home-device integration ไม่เป็น dependency บังคับของ POS หรือ BitPOS firmware

Browser terminal ทำให้พัฒนาจอและ demo ได้ก่อน firmware integration แต่หลักฐานความเร็ว/ความสามารถ hardware ต้องมาจากเครื่องจริง

POS store firmware และเว็บใช้ contract order/payment/event ชุดเดียวกัน Firmware ใหม่ไม่รอ catalog/entitlements ของ CryptoClock โดยต้องออกแบบ boot/readiness ใหม่ตาม [แผน firmware](FIRMWARE_EXTRACTION_TH.md) และตรวจ dependencies ก่อนย้าย

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


## Payment revision — 2026-10-07

- Solana Pay QR/transaction requests and web/Actions/Blinks share canonical quote/payment attempt/reference and backend verifier. Test wallet/mobile compatibility.
- Evaluate isolated Kora paymaster on OCI for merchant-sponsored fees: USDG-only customer pays with zero SOL; sponsor still needs SOL. Validate order, mint/program/instructions/recipient; enforce authentication, rate limits and per-order/day budgets.
- USDG Token-2022 extensions, fees/hooks and decimals require integration tests; generic token support is insufficient.
- New module: Solana Kit + Wallet Standard; transaction version follows wallet/SDK capabilities with fallback. Keep legacy devnet tools isolated. Evaluate Commerce Kit primitives before adopting USDG checkout.
- Verify actual incoming transfer, successful transaction, exact quote, mint/program/recipient and order reference. Post-token balance or client callback alone cannot close a bill. Deduplicate signatures/effects.
- Surfpool local integration tests simulate balances without waiting for faucets; label local assets separately from Paxos devnet USDG. Retain live devnet tests.
- confirmed for feedback; finalized before irreversible fulfillment according to policy. Hardware latency target remains backend verification to render ACK.
- Demo: AI draft / owner publish → order → sponsored USDG payment → verification → terminal ACK → loyalty/voucher.

These are plans; Kora, Commerce Kit and Surfpool are not installed or implemented.

Source: https://github.com/solana-foundation/solana-dev-skill/blob/main/skills/solana-dev/references/payments.md
