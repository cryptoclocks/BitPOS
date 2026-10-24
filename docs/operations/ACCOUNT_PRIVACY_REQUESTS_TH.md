# เมนูตั้งค่าและคำขอข้อมูลบัญชี

2026-10-20 — source/local fixture เท่านั้น ไม่มี deployment หรือ actual-use migration

Account overview → Account settings เป็นเมนูแยกจากฟอร์ม Profile and language, Signed-in sessions, Privacy and notifications และ Sign out all devices. Android back จากฟอร์มกลับเมนู จากเมนูกลับ overview; ไม่สร้างบัญชี/session/cart ใหม่

Privacy page แสดงข้อเท็จจริงเรื่องที่อยู่ที่กรอกเองและข้อมูลจัดส่ง พร้อม existing account-bound notification controls เมื่อ root มี controller จริง ไม่สร้าง marketing consent หรือ GPS permission status ที่ไม่ได้อ่านมา

Request a data copy / Request data deletion เปิด support form093 พร้อม subject เฉพาะ ไม่ผูก merchant/order และผู้ใช้ระบุข้อความ/ยืนยันส่งเอง ใช้ durable support command เดิมและ RLS/account ownership/recovery/staff general-inbox094 ไม่มีการสร้าง fake download/erase receipt

นี่เป็นการรับและติดตามคำขอ ไม่ใช่ระบบ export/erase อัตโนมัติ: ยังต้อง implement policy/retention/redaction และ execution/export artifact ของข้อมูลครบทุก domain รวม historic support/review command receipts และข้อมูลที่เกี่ยวข้องกับ order/payment ก่อนรับรอง privacy scope เสร็จ ห้ามปิด ticket แล้วอ้างว่าลบข้อมูลเสร็จจาก state support เพียงอย่างเดียว

หลักฐาน mounted16tests รวมสอง subject copy/delete, context order=null, owner-loss ปิด privacy+support และ settings/back/session/logout/analyzer. Native joined receipt ต้องมี PRIVACY_REQUEST จึงนับได้: การพบ support case แปลเพียงรับคำขอสำเร็จ ไม่ใช่ดาวน์โหลดหรือข้อมูลถูกลบแล้ว

ยังเปิด scope เดิมทั้งหมด: marketing preferences จริง, location permission/native workflow, full U32/U34 exact design, complete data export/erasure/retention และ independent review
