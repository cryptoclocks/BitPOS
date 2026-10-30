<!-- Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md. -->
# BitPOS × Muse · ไฟล์ออกแบบ FigCraft ของงาน Meta

เปิด **[BitPOS-Muse-UI.figcraft](BitPOS-Muse-UI.figcraft)** ใน FigCraft แล้วเริ่มที่หน้า `00 · เริ่มที่นี่` ทุกการ์ดและปุ่มกดไปหน้าถัดไปได้ (Prototype)

แยกจากไฟล์ของฝั่ง Solana (`design/figcraft/`, sol-) โดยสิ้นเชิง ทั้งธีม (ฟ้าแบบ Meta ของเราเอง ไม่ใช้โลโก้ Meta), เส้นทาง และการจ่ายเงิน (Stripe sandbox อย่างเดียว ไม่มีคริปโต)

| หน้า (Page) | เนื้อหา | ขนาด |
|---|---|---|
| 00 | สารบัญ · ผลตรวจการเชื่อมโยง (A01) · ความต่างจาก sol- (A02) | 1600 |
| 01 | สี ตัวอักษร ปุ่ม คอมโพเนนต์ | 1600 |
| 10 | meta-pay ลูกค้า: แตะ NFC → ยินยอม → โปร → Stripe, สั่งที่โต๊ะ, ใบเสร็จ, คืนเงิน (C01–C27) | 390×844 |
| 11 | Messenger (ภาพจำลอง): ยินยอม สั่ง เมนูการ์ด ใบเสร็จ จองโต๊ะ ออเดอร์ของฉัน | 390×844 |
| 12 | meta-pay เดสก์ท็อป (CD01–CD03) | 1440×1000 |
| 20 | meta-pos ร้าน (MP01–MP25 · คิวครัวมีแถบสั่งล่วงหน้า, MP24 เวลารับจองโต๊ะ, MP25 หน้าตาร้าน) | 1440×1000 |
| 21 | meta-pos มือถือ (MPM01–MPM03) | 390×844 |
| 30 | BitPOS Mini · เฟิร์มแวร์ Meta (B01–B13, ธีมมืดแบบเดียวกับจอจริง, ภาษาอังกฤษเป็นค่าเริ่มต้น + ปุ่ม ไทย/EN ที่หัวจอ, ปุ่มสแกน QR เข้า Messenger, โปรเคลื่อนไหว) | 480×320 |
| 31 | จอโต๊ะนับถอยหลัง (T01–T04) | 1024×768 |
| 40 | สถานะพิเศษ (S01–S06) | 390×844 |
| 50 | ส่งต่อทีมพัฒนา: เส้นทางจริง | 1600 |

- สร้างใหม่ได้ทุกเมื่อ: `python3 design/figcraft-meta/source/build_meta_ui.py` แล้ว `python3 design/figcraft-meta/source/diff_vs_sol.py`
- ผลตรวจลิงก์: `reports/link-audit.json` (กฎ: ปลายทางมีจริง · ทุกหน้าไปถึงได้จาก A00 · ไม่มีหน้าทางตัน)
- เทียบกับ sol-: `reports/diff-vs-sol.md` · ตรวจหน้าจริงที่มีอยู่ตอนนี้: `reports/live-pages-audit.md`
- ส่งต่อ: `handoff/screen-map.json`, `handoff/interaction-map.json`, `handoff/tokens.json` · ภาพตัวอย่าง: `previews/`
- รูปเมนูและโลโก้มาจาก `design/figcraft/assets/` (มีอยู่ก่อนแข่ง เป็นของโปรเจกต์) · ชื่อ ราคา ออเดอร์ และ QR ทั้งหมดเป็นข้อมูลสมมติ
