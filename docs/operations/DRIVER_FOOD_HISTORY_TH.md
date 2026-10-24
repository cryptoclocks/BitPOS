# ประวัติงานส่งอาหารของไรเดอร์

2026-10-20 — local/source acceptance; ไม่ใช่ deployment หรือการตรวจส่งอาหารจริง

- หน้า Delivery history เรียก GET `/api/mobile/v1/driver/food/history` ผ่าน bearer และ narrow SECURITY DEFINER function100 ที่ตรวจ live account/session/access hash ซ้ำใน transaction
- ใช้049/058/060/061 data boundaries เดิม ไม่เปิด raw assignment/recipient tables ให้ client และไม่ขยาย merchant permissions
- เฉพาะ assignment ของ driver profile ที่เป็นของบัญชีปัจจุบัน และ `closed_at IS NOT NULL`; ไม่ต้องออนไลน์หรือมีเอกสารปัจจุบันเพื่ออ่านประวัติของตน
- เรียง `accepted_at,id` และ cursor บัญชีเดียวกัน ครั้งละ30 ใช้ timestamp precision ใน SQL; ไม่ใช้ JavaScript Date เป็น keyset anchor
- ไม่ส่งชื่อ เบอร์ ที่อยู่ พิกัดลูกค้า หรือ plate snapshot ในประวัติ
- `quotedDriverFee` เป็นค่าจัดส่งจาก quote immutable เดิมเท่านั้น ไม่ใช่ยอด earning accrual, eligibility, net payout หรือเงินโอน ต้องอ่าน ledger/verified receipt ใน Earnings แยกกัน
- `DELIVERED`, `RELEASED`, `INCIDENT` แสดงตาม assignment จริง; closed ไม่ได้ถูกเหมารวมว่าส่งสำเร็จหรือมีสิทธิ์รับเงิน
- Flutter ผูก account+session, ทิ้งผลตอบกลับเก่าหลัง owner เปลี่ยน; inactive/paused ล้างข้อมูล และ resumed โหลดใหม่; role/auth refusal ล้างหน้า แม้ SDK local session ยังอยู่
- หน้าเก่าที่โหลดไม่สำเร็จยังลอง cursor เดิมได้ ไม่เปลี่ยน snapshot เก่าเป็นข้อมูลหน้าใหม่

Migration100 เพิ่มเพียง narrow function และ partial index แยกจาก coupon096–098 ที่ยังไม่เปิดใช้งาน;099เผื่อวงจร coupon bill เดิม ไม่ได้ activation แบบ bulk.100 ใช้ rollback SQL proof ก่อนติดตั้งเฉพาะ disposable55436; actual-use ไม่เปลี่ยน

หลักฐาน: driver100-history-sql-direct-20261020.json (rollback), driver100-history-http-direct-20261020.json (3036/55436), mounted history4 tests และ analyze/TS/generatedcheck. Native driver100-history-avd receipt ต้องอ่านสถานะล่าสุดก่อนอ้างผล

ยังต้องตรวจ30/31 boundary/load, full R15 geometry/TH-EN/current independent review และ complete rider root navigation. SQL/HTTP fixtures ใช้ closed assignments ที่มีอยู่ ไม่ปลอม lifecycle หรือสร้าง payment/earning facts ใหม่ Session ใหม่ถูก revoke หลังจบ; driver/accountเดิมคงเดิม
