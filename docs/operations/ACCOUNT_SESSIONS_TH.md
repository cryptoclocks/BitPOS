# รายการ session ของบัญชีลูกค้า

สถานะ 2026-10-20: source API/Flutter และ local fixture acceptance; ยังไม่ deploy actual-use และยังไม่มี independent review ล่าสุด

- Settings → Signed-in sessions อ่านจาก `GET /api/mobile/v1/account/sessions` ของบัญชีที่ผ่าน bearer authentication เท่านั้น คืนครั้งละ30รายการพร้อม cursor ของบัญชีเดียวกัน
- แสดง session ที่ยังไม่ถูกเพิกถอนและ refresh lease ยังไม่หมด แม้ access token เดิมหมดอายุแล้ว ไม่อ้างว่าเป็นเครื่อง physical คนละเครื่องหรือมีข้อมูลรุ่น/ตำแหน่ง/last-used ที่ฐานข้อมูลไม่มี
- เวลาแสดงเป็นเวลาท้องถิ่นของโทรศัพท์; `createdAt` คือเวลาสร้าง session และ `expiresAt` คือวันหมดอายุ refresh lease ไม่ใช่เวลาพบเครื่องครั้งล่าสุด
- ไม่มี access/refresh hash, bearer, device UUID หรือ auth subject ใน response
- PUT `/account/sessions/{id}` body `{revoked:true}` เป็น absolute idempotent operation ของบัญชีเดียวกัน ผลซ้ำไม่เพิ่ม audit ซ้ำ ไม่มีการใช้คำตอบ client เป็นหลักฐาน
- Session ปัจจุบันต้องใช้ logout เดิมเพื่อเพิกถอนและล้าง secure local session; API ปฏิเสธ self revoke409 รวม UUID ตัวพิมพ์ใหญ่
- การเพิกถอน serialize ที่บัญชีและ reauthenticate ภายใน transaction; ผลกับ audit commit พร้อมกัน มี lock timeout2s/statement timeout5s และ retryable409 แทนรอไม่สิ้นสุด
- Paging ใช้เวลาเต็ม precision ใน SQL ไม่ผ่าน JavaScript Date anchor จึงไม่ข้ามรายการที่เกิดในมิลลิวินาทีเดียวกัน
- ถ้าคำตอบ PUT หาย UI คงความไม่แน่นอนและให้ Refresh อ่านสถานะจริง การลอง PUT เดิมซ้ำปลอดภัยจากผลซ้ำ; ไม่อ้างว่า session ถูกยกเลิกก่อน server receipt
- Owner retirement ปิด route เฉพาะของตนและทิ้งผลลัพธ์ที่มาช้า ไม่กระทบ route ของเจ้าของใหม่

หลักฐาน HTTP: `account-sessions-http-direct-20261020.json` ใน `.omp/work/flutter-delivery-20261016/evidence/` ทดสอบ35รายการ/precision paging, foreign account/cursor/revoke,12 concurrent effects, revoked bearer, expiry, uppercase self fence, held-lock retryไม่มีผลข้างเคียง บน3035/55436 fixtureเท่านั้น

Native joined acceptance และ screenshot ให้ดู receipt account-overview-avd-direct-20261020.json ล่าสุด; ห้ามใช้ receipt เวอร์ชันเก่าที่ไม่มี SESSIONS_REVOKE เป็นหลักฐานฟีเจอร์นี้ ชุด API3034 nativeก่อน guard delta กับ3035 HTTPล่าสุดแยกขอบเขตชัด ไม่ใช่ proof notification delivery หรือ device field testing

ใช้049 schema ที่มีอยู่ ไม่เพิ่ม migration หรือ grant ไม่มีเงินจริง/ข้อมูลลูกค้าจริง แยก fresh synthetic accounts และ revoke/disable เมื่อจบ
