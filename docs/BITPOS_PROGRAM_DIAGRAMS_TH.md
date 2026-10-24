# แผนภาพการทำงาน BitPOS

เปิด [ตัวดูแผนภาพแบบ offline](diagrams/bitpos-20261024/index.html) — เลือกแผนภาพ ซูม และเปิด Mermaid source ได้

มี 4 ชุด: ภาพรวมระบบ, ขั้นตอนสั่งอาหาร, การยืนยันเงิน/กู้คืน และ workflow พัฒนา UI แบบ Customer/Rider/POS ทำขนาน

ไฟล์ต้นฉบับ `.mmd`, ผลลัพธ์ `.svg`, build manifest และผลตรวจ browser อยู่ใน [โฟลเดอร์แผนภาพ](diagrams/bitpos-20261024/README.md) ใช้ Pele 1.9.0 ที่ติดตั้งแยกใน `tools/diagram-renderer/` โดยไม่แก้ dependencies ของแอพ

แผนภาพอธิบาย source และกฎที่ตั้งใจให้ระบบทำงาน ไม่ใช่การยืนยันว่า integration หรือทุกหน้าผ่านครบแล้ว รายการค้างและสถานะสดให้อ่าน [checkpoint](CHECKPOINT.md) แทนภาพ TODO ของกลุ่มงานใหญ่
