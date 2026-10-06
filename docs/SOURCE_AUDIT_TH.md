# Source audit และขอบเขตการย้าย

ตรวจจาก local filesystem วันที่ 7 ตุลาคม 2026; ยังไม่ได้ทดสอบ runtime หรือยืนยัน production topology

## POS สอง snapshot ที่พบ

| แหล่ง | Git HEAD | สถานะ POS ที่ตรวจ |
|---|---|---|
| `/Users/cryptoclock/Desktop/CashlessThailand/cashlessthailand` | `d35d4c2` | POS components/service/API/page เป็น untracked; เว็บไซต์มี local work อื่น |
| `/private/tmp/cashless-bilingual-push` | `ac673c3` บน `feat/bilingual-ui` | POS components/service/API/page tracked; path ที่ตรวจไม่มี local changes; UI/Reports/CSS ต่างจากชุดแรก และมีงานไทย/อังกฤษเพิ่ม |

ข้อเสนอ: ใช้ snapshot `ac673c3` เป็น candidate สำหรับเฟส 1 และเทียบ local changes ของชุดแรกก่อนย้าย เพื่อไม่ทิ้งฟีเจอร์เฉพาะชุดใดชุดหนึ่ง ต้องเก็บ source snapshot ที่จำเป็นออกจาก `/private/tmp` เมื่อเริ่ม extraction เพราะ path ชั่วคราวไม่ใช่ที่เก็บระยะยาว

การตรวจครั้งนี้เห็น remote-tracking `origin/main` ที่เก็บไว้เป็น `8c39bfe` และ checkout แรกตามหลัง ref นี้; fetch ผ่าน credentials เริ่มต้นไม่สำเร็จ และ fetch ด้วยบัญชี `cryptoclocks` ตอบ `Repository not found` จึงไม่รับรองว่า snapshot ใดเป็น remote ล่าสุด ไม่มีการ reset/pull หรือเปลี่ยน code ต้นทาง

Destination ของงานใหม่คือ `cryptoclocks/BitPOS` ไม่ใช่ repo ของเจ้าของต้นทาง

## Dependency closure ที่ต้องนำมาเฉพาะส่วน

| Path ต้นทาง | การนำมาใช้ |
|---|---|
| `src/components/pos/POSApp.jsx` | UI merchant + navigation 25 หน้า + roles/demo/cart |
| `src/components/pos/ReportPanel.jsx` | reports, filters, charts, export/printing |
| `src/components/pos/pos.css` | styles และ responsive behavior |
| `src/lib/pos/service.ts` | business rules, API actions, permissions, stock/report calculations; แยก domain จาก storage |
| `src/lib/pos/storage.ts` | types, seed, adapter boundary; demo ใช้ fixture ใหม่; target เป็น Supabase ไม่ใช่ Google live storage |
| `src/lib/pos/service.test.ts` | existing meaningful tests ที่ต้องรักษาและปรับตาม adapter |
| `src/pages/api/pos.ts`, `pos-demo.ts` | route boundaries; เปลี่ยน wiring เป็น service ของ BitPOS |
| `src/pages/services/pos.astro` | entry page; เปลี่ยน site Layout เป็น BitPOS layout |
| `src/components/LocalizedText.tsx`, `src/lib/i18n/*` | เอาเฉพาะ dependencies/dictionaries ที่ POS ใช้ รวม locale persistence |

ไม่ย้ายเว็บไซต์ marketing/shop/blog/navigation ทั้งชุด, payment/CCP schema ทั้งชุด, Google deployment configuration, `.env` หรือข้อมูลลูกค้า รูปสินค้าและ CSV ใช้ adapter ที่เป็นของ BitPOS

## พฤติกรรมที่ต้องปรับก่อน Solana

- POS เดิมเรียก `sale` แล้วบันทึกบิล/หัก stock ทันที ช่องทางจ่ายเป็น label; ไม่ใช่ asynchronous chain/payment confirmation flow
- เพิ่ม order/payment attempt/reservation state ก่อนใช้ USDG หรือ Stripe PromptPay; ยังรักษา cash flow ที่มี receipt/change
- Storage เดิมมี JSON demo และ Google Apps Script revision-based storage สำหรับ Sheets/Drive การย้ายไป Supabase ต้องออกแบบ transactional writes ไม่เอา whole-store JSON update เป็นโครงสร้างหลัก
- `bills.void` คืน stock แต่ไม่ใช่หลักฐานว่า Stripe/Solana คืนเงินแล้ว
- Session/role logic เดิมต้องถูก map ไป merchant membership และ server authorization; ไม่ copy session namespace ของ Cashless Thailand มาใช้ร่วมกัน

## CryptoClock references: ฐาน firmware หน้าร้านและ optional adapter

Workspace: `/Users/cryptoclock/Desktop/CryptoClockPro`

- `apps/server/apps/api/src/ccp/ccp.service.ts`: reference การสร้าง Stripe PromptPay quote/QR ฝั่ง server; ห้ามนำ CCP top-up domain มาเป็นการขายร้าน
- `apps/server/apps/api/src/billing/billing.service.ts`: reference verified webhook และ dispatch event; ต้องสร้าง BitPOS webhook ของตนเอง
- `docs/operations/OCI_SUPABASE_MIGRATION_MASTER_PLAN_TH.md`: เป็นแผน migration/operational gates ไม่ใช่หลักฐานว่า self-hosted Supabase ปัจจุบันพร้อมแล้ว
- `device/firmware/`: ฐาน ESP-IDF/LVGL ที่จะ extract สำหรับเครื่องหน้าร้านในเฟส 1B; project ยังชื่อ `cryptoclock_pro`, CMake version ที่เห็นเป็น `0.0.6.68` ซึ่งไม่ใช่การยืนยัน production release
- `device/firmware/main/app_main.c`: bootstrap/package readiness และ event hooks ที่ต้องปรับให้เป็น BitPOS
- Components สำหรับ board/display/UI/network/storage/audio/OTA/security และ schemas: audit ตาม [แผน firmware](FIRMWARE_EXTRACTION_TH.md); ยังไม่ได้ copy หรือ build
- Device/API/event transport ที่มีอยู่: reference สำหรับ BitPOS contract และ legacy/home-device adapter; ไม่แก้ firmware/production ต้นทางในเฟสวางแผน

ผู้ใช้ระบุว่ามี OCI อยู่แล้ว; เฟส data/deployment ต้องตรวจว่า Supabase instance ใดเป็นจริง, capacity, credentials boundary, Auth callbacks, backup และ network ก่อนเลือก shared infrastructure หรือ dedicated service ห้ามสร้าง schema ปนระบบเดิมโดยอาศัยสมมติฐาน

Update 2026-10-07: ตรวจ live OCI แบบ read-only แล้ว พบสอง Supabase stacks ที่รายงาน healthy และ rehearsal services; RAM/disk ยังมี headroom สำหรับ staging ขนาดเล็ก รายละเอียดใน [OCI preflight](OCI_PREFLIGHT_TH.md) ยังไม่ได้เลือก/สร้าง BitPOS database/Auth boundary หรือทำ production migration

## หลักฐาน

`source-inventory.json` เก็บ SHA-256/ขนาด/สถานะ tracked ของไฟล์ POS ที่เลือกจากสอง snapshot และไฟล์ firmware/contracts ที่เลือกจาก CryptoClock Pro โดยไม่คัดลอกเนื้อหา เป็นหลักฐานเฉพาะไฟล์ที่ตรวจ ณ เวลานั้น ไม่ใช่ audit ทั้งระบบหรือผลทดสอบ

การตรวจสิทธิ์/ownership สำหรับการเปิด public และการใช้ artwork/licensed dependencies ต้องจบก่อนเผยแพร่ แต่การสร้างแผนใน private repo ทำต่อได้
