# แอป Customer / Rider เชื่อม OCI (เดโม)

แอปทั้งสองต่อกับ API บน OCI ผ่าน `https://pay.cashlessthailand.com/api/mobile/v1/` (ไม่ใช่ MacBook อีกต่อไป) ข้อมูลเป็นของร้านเดโม **BitPOS Purple Cafe** บนฐานข้อมูล BitPOS เดียวกับ POS เว็บ ราคา/การชำระเงินเป็น Solana **devnet** (รายการเดโม 0.10 USD ต่อชิ้น) ไม่ใช่เงินจริง

## ล็อกอิน (OTP ทดสอบ ไม่มี SMS จริง)
GoTrue ของ OCI ตั้ง `GOTRUE_SMS_TEST_OTP` ให้ 3 เบอร์เท่านั้น เบอร์อื่นล็อกอินไม่ได้ (ตรวจแล้ว: ขอ OTP/ยืนยันเบอร์อื่นได้ 401)

| บทบาท | เบอร์ | รหัส |
|---|---|---|
| ลูกค้า | +66900000001 | 123456 |
| ไรเดอร์ | +66900000002 | 123456 |
| ลูกค้าคนที่สอง | +66900000003 | 123456 |

## ติดตั้งแอป
`bash tools/runtime/try-apps-install.sh oci emulator-5554` (หรือ serial มือถือ) สร้างแอปที่ชี้ OCI โดยไม่ใช้ fixture/`adb reverse`

## ลำดับเดโมที่ทำได้จริง
1. ลูกค้าเลือกร้าน BitPOS Purple Cafe → ลาเต้เย็น (มีตัวเลือกนม/ท็อปปิ้ง) → คูปอง `DEMO5` / เลือกช่วงเวลา → ชำระด้วยกระเป๋า devnet ผ่านเว็บ pay.cashlessthailand.com
2. ร้านรับออเดอร์และกดทำเสร็จใน POS `https://pos.cashlessthailand.com` (หน้า Incoming orders)
3. ส่งข้อเสนองานให้ไรเดอร์เดโม (แอปไม่มี UI dispatcher): บน OCI
   `docker exec bitpos-runtime-api-1 node --import tsx tools/runtime/oci-demo-dispatch.ts` (ใส่ orderId ต่อท้ายได้)
   สคริปต์สร้างสิทธิ์ dispatcher ชั่วคราว 1 ชม. เฉพาะร้านเดโม แล้วเพิกถอนเมื่อจบ ไม่แตะข้อมูลการชำระเงิน
4. ไรเดอร์ออนไลน์ → รับงาน → ถึงร้าน → รหัสรับ → ถึงปลายทาง → รหัสส่งมอบจากลูกค้า

## ข้อเท็จจริงและขอบเขต
- seed (`tools/runtime/oci-demo-seed.ts`) เพิ่มสาขา/นโยบายส่ง/คูปอง/ช่วงเวลา/รางวัล/ตัวเลือกลาเต้/ที่อยู่ลูกค้า/ไรเดอร์เดโมให้ร้านเดโมที่มีอยู่แล้ว ใช้ป้ายเดโมชัดเจน ไรเดอร์ไม่ผ่าน KYC จริง (`verification_reference` ระบุ synthetic)
- ไม่มี SMS, แผนที่/ETA, push จริง; ไรเดอร์ถูกส่งงานด้วยสคริปต์ dispatcher
- ย้อนกลับ: โฟลเดอร์ `/home/ubuntu/bitpos-runtime.rollback21-20261030` (compose staging, runtime.env, ไฟล์เดิม) + dump `/home/ubuntu/bitpos-backups/pre-deploy21-20261030.dump`; image `bitpos-runtime:rollback-20261030c`
