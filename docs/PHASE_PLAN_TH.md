# แผนพัฒนา BitPOS เป็นผลิตภัณฑ์และ repository แยก

วันที่วางแผน: 7 ตุลาคม 2026

## ข้อเสนอที่ยึดเป็นฐาน

แยก BitPOS ไปที่ `Desktop/BitPOS` และ GitHub ของ `cryptoclocks` เหมาะกับขอบเขตงานนี้ เพราะ merchant POS, customer ordering, payment, campaign และ loyalty มีวงจรพัฒนาของตัวเอง Firmware เครื่องหน้าร้านแยกจาก CryptoClock Pro มาอยู่ `device/firmware/` ใน repo BitPOS ด้วย โดย BitPOS ต้องทำงานผ่าน browser ได้ด้วย ส่วนเครื่อง CryptoClock เดิม เช่นเครื่องที่บ้าน เชื่อมผ่าน adapter ภายหลัง

ย้าย **UI และฟีเจอร์ POS เดิมทั้งหมด** พร้อมฐาน firmware ที่จำเป็นสำหรับเครื่องหน้าร้าน แต่ไม่ย้ายทั้งเว็บไซต์ Cashless Thailand หรือทั้งระบบ CryptoClock การรักษาฟีเจอร์หมายถึงรักษาพฤติกรรมทางธุรกิจ ไม่จำเป็นต้องรักษา storage/auth implementation เดิมเมื่อเปลี่ยนไป Supabase

ใช้ Supabase/Postgres เป็นฐานข้อมูลการทำงานของร้าน และเก็บหลักฐานการจ่าย/สิทธิ์บน Solana ไม่ลงเมนู รายละเอียดลูกค้า หรือรายการงานภายในร้านทั้งหมดบนเชน

รอบนี้ทำเฉพาะแผนและ repo ใหม่ การย้ายโค้ดเริ่มในเฟส 1

## เฟสและเงื่อนไขจบ

| เฟส | งาน | ผลลัพธ์ที่ต้องตรวจได้ก่อนผ่าน |
|---|---|---|
| 0 — แยกโครงการและสำรวจ | สร้าง repo, บันทึกต้นทางสองชุด, feature matrix, dependency และขอบเขตข้อมูล | แผนและ provenance ชัด; repo อยู่บัญชี cryptoclocks; ไม่มี secrets/ข้อมูลจริงปน |
| 1 — แยก POS และ firmware | 1A: ย้าย 25 หน้าจอ, reports, CSS, UI dependencies, server business rules, demo/tests; 1B: แยก ESP-IDF/LVGL firmware และ dependency ที่ต้องใช้สำหรับร้าน | POS รันแยก, ไทย/อังกฤษ/roles/parity ครบ; firmware build ได้จาก repo BitPOS เองและเข้า POS shell บนเครื่องทดสอบโดยไม่ต้องพึ่ง catalog ของ CryptoClock |
| 2 — ฐานข้อมูลและการสั่ง | Supabase schema/Auth/RLS, tenant roles, เมนู, stock, order, customer self-order, guest และ wallet binding | ร้านอื่นอ่าน/แก้ข้อมูลกันไม่ได้; พนักงานหรือ QR ลูกค้าสร้าง order เดียวกันได้; ราคา/ส่วนลดคิดฝั่ง server; ไม่ oversell เมื่อซื้อพร้อมกัน |
| 3 — รับชำระเงินจริง | Cash, Stripe PromptPay, USDG บน Solana, Actions/Blinks และเว็บสำหรับมือถือ | order ผูก quote/payment attempts/signature; ยืนยันจากผู้ให้บริการ/เชน; replay ไม่ปิดบิลหรือตัด stock ซ้ำ; ปฏิเสธ wrong mint/amount/recipient |
| 4 — หน้าจอหน้าร้าน | Terminal web/emulator และ BitPOS firmware, QR ตาม order, แตะสลับ PromptPay/USDG, paid animation/เสียง, idle ticker/GIF/โฆษณา | order บน POS ตรงกับ terminal; event มี ACK/dedup/reconnect; วัด latency หลัง backend ยืนยัน; demo บนจอจริงหลัง firmware integration ผ่าน |
| 5 — Loyalty และของรางวัล | แต้ม/ระดับสมาชิก, CLOCK reward ตามแบบที่เลือก, NFT 5 แบบ, สุ่ม, voucher เครื่องดื่ม, แลกของจริง, QR claim | แจกให้ wallet ตามเงื่อนไขที่ร้านกำหนด; แจก/claim/แลกซ้ำไม่ได้; payment paid แต่ mint fail แสดง reward pending และ retry ได้ |
| 6 — AI สำหรับร้าน | ร่าง campaign จากเมนู/margin/ยอดขาย, วิเคราะห์ยอดชำระ Solana, segmentation และผลแคมเปญ | AI ใช้ข้อมูลที่ตรวจสอบได้; owner preview/publish; จำกัด budget และ eligibility ด้วย code; วัด conversion และต้นทุนรางวัลได้ |
| 7 — เชื่อมช่องทางและนำร่อง | Notifications, home-device opt-in, online-order adapter เช่น Grab, tip/check-in/WiFi campaign, production hardening | ทุก integration ระบุ real/mock ชัด; ช่องทางที่ไม่มีสิทธิ์ API ไม่อ้างว่าเชื่อมจริง; backup/restore, observability, deployment และ pilot ผ่าน |

หลังเฟส 2 ส่วน AI เริ่มทำบน fixture/ข้อมูล staging ได้ และ terminal เริ่มบน emulator ได้ ไม่จำเป็นต้องรอให้ทุก integration เสร็จ แต่ต้องผ่าน flow end-to-end เดียวกันก่อน demo

## เฟส 1: รายการ POS ที่ต้องรักษาครบ

ต้นทางมี navigation 25 หน้า; ตารางนี้เป็น checklist สำหรับ extraction parity ยังไม่ใช่การรับรองว่าทุกพฤติกรรมผ่านทดสอบแล้ว

| กลุ่ม | หน้าเดิม | สิ่งที่ต้องรักษา |
|---|---|---|
| ภาพรวม | `dashboard`, `pos` | สรุปยอด, ค้นหาสินค้า, รูปสินค้า, ตะกร้า, quantity, ส่วนลด, ลูกค้า, เงินสด/เงินทอน |
| ขาย | `bills`, `shift` | ดู/พิมพ์บิล, void ตามสิทธิ์, คืน stock ตามกฎ, ปิดยอดประจำวัน |
| คลัง | `products`, `stock`, `receive`, `rcvHistory`, `adjust`, `lowstock`, `movement` | สินค้า/ราคา/ต้นทุน, stock, รับเข้าและประวัติ, ปรับ stock พร้อมเหตุผล/สิทธิ์, สินค้าใกล้หมด, movement |
| รายงาน | `repDaily`, `repSales`, `repReceive`, `repPeriod`, `analytics`, `top`, `exportC` | ช่วงวันที่และ filters, charts, สรุปยอด, สินค้าขายดี, CSV/export history |
| ข้อมูลหลัก | `suppliers`, `customers`, `categories` | CRUD และความสัมพันธ์กับสินค้า/การขาย |
| ระบบ | `users`, `activity`, `printer`, `settings` | owner/manager/staff, enforcement ฝั่ง server, activity log, receipt/print settings, store settings |

รักษา responsive/mobile navigation, light/dark UI, login/logout/demo role และภาษาไทย/อังกฤษด้วย ต้องตรวจสิทธิ์ API จริง ไม่ใช้แค่ซ่อนปุ่มใน UI

เปลี่ยน image references จาก Google Drive เป็น storage adapter ของ BitPOS; รูป/CSV และ business records ย้ายด้วยขั้นตอน migration ภายหลัง ไม่คัดลอก production snapshots เข้าระหว่างพัฒนา

### เฟส 1B: Firmware เครื่องหน้าร้าน

แยก ESP-IDF project มาอยู่ `device/firmware/` ใน repo เดียวกับ POS โดยรักษา board/display/touch, LVGL, Wi-Fi, transport, audio, SD และ OTA ที่ต้องใช้ ออก product/version/config/provisioning/OTA namespace ของ BitPOS เอง ไม่ผูก path หรือ symlink กลับไป CryptoClock Pro

ต้นทางมี bootstrap ที่รอ catalog และแพ็กเกจ CryptoClock จึงต้องแทนด้วย POS boot/readiness contract ไม่เช่นนั้น copy/build ผ่านก็ยังเปิดหน้าขายไม่ได้ งานนี้ต้องตรวจ dependencies ของ WASM/package/rendering ก่อนตัดออก และรักษา fixes ด้าน display memory, SD, watchdog และ rollback

อ่าน [แผน firmware](FIRMWARE_EXTRACTION_TH.md) สำหรับรายการต้นทางและ acceptance gate การ build/flash/OTA เป็นงานเฟสถัดไป ไม่ได้ทำในรอบวางแผนนี้

## เฟส 2–3: สิ่งที่ต้องออกแบบก่อนต่อ payment

- แยก `order`, `payment_attempt`, `stock_reservation`, `reward_grant` และ `outbox_event`; แยกสถานะการจ่ายออกจากการจัดเตรียมสินค้า
- ใช้ server-side THB quote และ conversion quote สำหรับ USDG ที่มี expiry; เก็บ rate/source/rounding policy ให้ตรวจย้อนหลังได้
- จำนวนเงินบาท/โทเคนใช้ integer minor units; token decimals และ mint/program อ่านและตรวจจาก configuration ที่ยืนยันแล้ว ไม่สมมติชื่อ token เพียงอย่างเดียว
- ลูกค้าเปลี่ยนช่องทางจ่ายใช้ order เดิมได้ แต่แต่ละ attempt มี ID; ห้ามทำให้ order paid สองครั้ง หากทั้งสองช่องทางสำเร็จจริงต้องเก็บเงินทั้งสองรายการและเปิด recovery/refund case
- สำรอง stock ก่อนชำระ แล้ว commit/release ตามสถานะ; เงินจ่ายเข้าช้าเมื่อหมดอายุหรือ stock หมดต้องมี reconciliation/fulfillment/refund workflow
- Stripe webhook ตรวจ signature จาก raw body และ dedup provider event; QR หรือ payment intent creation ยังไม่เท่ากับ paid
- Solana ตรวจ successful transaction, commitment policy, mint/program, recipient, amount และ order reference; watcher มี polling/reconciliation รองรับกรณี notification หาย
- `void` บิล, ยกเลิก order และ refund เงินเป็นคนละ operation ต้องมีหลักฐาน/สิทธิ์แยก ไม่ถือว่าการคืน stock คืนเงินแล้ว
- Actions ใช้ GET/POST/OPTIONS, CORS และ `actions.json`; QR เปิดเว็บเมนู/order เป็น fallback สำหรับมือถือที่ไม่แสดง Blink
- USDG จริงต้องตรวจ mint/availability ของ network; devnet ใช้ test token ที่ติดป้ายชัด ห้ามอ้างว่าเป็น USDG ที่ redeem ได้

## เฟส 4: เป้าหมายความเร็วที่วัดได้

วัด `backend ยืนยัน paid → อุปกรณ์ render สำเร็จ/ACK` โดยตั้งเป้า p95 ต่ำกว่า 1 วินาทีบนสภาพแวดล้อมทดสอบที่กำหนด แล้วรายงานผลจริงแยกจาก `ลูกค้ากด sign → chain confirmation` ซึ่งไม่รับประกันต่ำกว่า 1 วินาทีทุกครั้ง

หน้าจอแสดง awaiting payment, confirming, paid และ reward pending/issued แยกกัน ไม่แสดงแจกสำเร็จก่อน mint/สิทธิ์สำเร็จ หาก offline ให้ sync state ปัจจุบัน และไม่เล่นเสียง success เก่าซ้ำเมื่อ reconnect

BitPOS มี terminal contract กลางก่อน แล้วทำ adapter ไป CryptoClock หากเครื่องนั้นไม่มี input/touch ที่จำเป็น ให้เลือกวิธีสลับช่องทางที่รองรับจริงในเฟส hardware validation

## เฟส 5–7: ฟีเจอร์ใหม่ทั้งหมดในขอบเขต

| ฟีเจอร์จากการคุย | เฟส | ขอบเขต |
|---|---|---|
| พนักงานเลือกเมนูให้ลูกค้า หรือสแกน QR สั่งเอง | 2–3 | ใช้ order และ pricing ฝั่ง server ชุดเดียวกัน |
| จ่าย USDG และเลือก PromptPay/Cash | 3 | loyalty eligibility กำหนดต่อช่องทางได้; จ่าย USDG ใช้ campaign Solana ได้ |
| จ่ายแล้วจอเปลี่ยน/มีเสียง; idle SOL/USDT และ GIF/เรียกแขก | 4 | ticker data source, sound preference, device ownership |
| AI matching เมนูและ campaign สำหรับผู้จ่าย Solana | 6 | ใช้ประวัติซื้อ/เมนูที่มีสิทธิ์เข้าถึง; ไม่อนุมานข้อแพ้อาหารจาก wallet |
| Wallet usage analytics | 6 | opt-in, ไม่ระบุเจ้าของ wallet จาก chain เอง; query จำกัดขอบเขตและต้นทุน |
| CLOCK token/reward | 5 | เริ่มด้วย loyalty ที่ไม่มีเงื่อนไขบังคับซื้อ token; ตัดสินใจ token spec ก่อน mint |
| NFT 5 แบบและ random collectible | 5 | prototype artwork/metadata, reward policy, ตรวจความซ้ำ; ถ้าใช้ randomness บน server ระบุ trust model; อย่าเรียกว่า provably fair |
| แต้มหลายระดับ, voucher, NFT หรือของจริง เช่นตุ๊กตา | 5 | ledger, threshold, redemption, inventory/fulfillment ของรางวัล |
| Tip/check-in/NFT กิจกรรม/WiFi access | 7 | เจ้าของร้านเลือก action; WiFi ต้องเชื่อมระบบ hotspot จริง; token/key ไม่เปิดบน public chain |
| Notification ลูกค้า | 7 | inbox/web/app ที่เราเป็นเจ้าของ; wallet notification เฉพาะ provider ที่รองรับและผู้ใช้ subscribe |
| CryptoClock ที่บ้านลูกค้า | 7 | optional adapter, opt-in, binding, quiet hours, TTL และ dedup |
| Online orders เช่น Grab | 7 | adapter + external order IDs; ตรวจสิทธิ์ partner/API ก่อน; mock ระบุชัด |

การส่ง notification ไปอุปกรณ์ของร้านในเฟส 4 เป็นคนละขอบเขตกับ marketing notification ไปบ้านลูกค้า

## เส้นทางสำหรับ Hackathon

เป้าหมาย demo หนึ่งเส้นทางที่จบจริง:

1. Owner ใช้ AI ร่างแคมเปญจากเมนูจริง เช่น “จ่าย USDG รับ collectible และรับ voucher เมื่อสะสมครบ” แล้ว preview/publish
2. พนักงานเลือกเมนู หรือผู้ใช้สแกนเลือกเอง; POS และ terminal แสดง order/ยอดเดียวกัน
3. ผู้ใช้เปิดเว็บ/Blink และจ่าย USDG; backend ยืนยันจากเชน
4. จอหน้าร้านเล่น success animation/เสียง พร้อม order paid ใน POS
5. Wallet ได้ reward หรือเห็น pending พร้อม retry ที่ตรวจได้; voucher แลกได้ครั้งเดียว
6. Dashboard แสดงธุรกรรม Solana, ผลแคมเปญ และต้นทุนที่เกิดขึ้นจริง

เลือกการสาธิต Solana + AI + หน้าร้านเป็นแกน ส่วนการย้าย POS ครบยังเป็นงานที่ต้องทำในเฟส 1 ไม่ตัดออกจาก roadmap เพื่อให้ดูเหมือนเสร็จทั้งหมด งานจำนวนนี้ไม่ควรรับประกันว่าจะเสร็จทั้งหมดก่อนกำหนดส่ง ต้อง freeze demo scope ตามสถานะที่ทดสอบแล้ว

ก่อน submission: ตรวจ deadline/eligibility ของทั้งสองงาน, ข้อกำหนด public repo, เปิดเผย POS/Stripe/UI ที่พัฒนามาก่อนการแข่งขัน, แยกส่วนสร้างใหม่, จัด README/video/live deployment และระบุทุก mock/test network อย่างชัดเจน

## โครงสร้างเป้าหมาย (ยังไม่ได้สร้าง runtime)

```text
BitPOS/
  apps/web/                  # merchant POS + customer ordering + browser terminal
  apps/api/                  # POS API, Actions, payments, authenticated webhooks
  apps/worker/               # confirmation watcher, outbox, rewards, reconciliation
  packages/contracts/       # shared schemas/events
  packages/ui/              # POS UI + Thai/English support
  packages/domain/          # order, stock, loyalty rules
  device/firmware/         # ESP-IDF/LVGL store terminal, independent build/config/OTA
  device/schema/           # device contracts and configuration schema
  device/assets/           # BitPOS terminal artwork/audio/fonts, licensed assets only
  integrations/cryptoclock/ # optional legacy/home-device adapter
  supabase/migrations/      # BitPOS schema and tenant policies
  infra/                    # separate staging/production runtime
  docs/
```

ต้นทางเป็น Astro + React + Elysia; เฟส 1 ควรรักษา stack ที่มีอยู่เพื่อให้ตรวจ parity ง่ายก่อน การแยก API/worker process และ workspace tooling ให้ตัดสินใจจาก runtime/dependencies จริงในเฟสนั้น ไม่ทำ framework rewrite พร้อม extraction โดยไม่มีเหตุจำเป็น

## การตรวจและความเสี่ยงหลัก

- Extraction: existing domain tests + UI smoke ทุกกลุ่ม/role/language; อย่าอ้างว่าผ่านทั้งหมดจากการเห็น source
- Data: tenant isolation, concurrent stock/order mutations, migration parity, no production data in repo
- Payments: wrong token/destination/value, forged callback, duplicate/late payment, multiple successful attempts, worker restart, refund/void mismatch
- Rewards/devices: retry/replay, reconnect, stale success sound, redeem once, payment succeeds but reward fails
- AI: malformed output, impossible margin, budget/eligibility limits, no autonomous fund movement
- Operations: verified hosting topology, service isolation, environment separation, backup/restore and monitoring

อุปสรรคปัจจุบัน: fetch repo ต้นทางไม่ได้ด้วยสิทธิ์ GitHub ที่มี แต่มี POS snapshot ที่ tracked และสะอาดใน worktree อีกชุด ต้องตรวจความใหม่อีกครั้งก่อน extraction ถ้าสิทธิ์ต้นทางพร้อม ห้ามล้าง local work เพื่อแก้เรื่องนี้

แหล่งข้อกำหนดทางเทคนิค: [Solana Actions](https://solana.com/docs/tools/actions), [Solana signatureSubscribe](https://solana.com/docs/rpc/websocket/signaturesubscribe), [Stripe PromptPay](https://docs.stripe.com/payments/promptpay), [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)
