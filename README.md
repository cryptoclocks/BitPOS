# BitPOS

Standalone merchant POS, customer ordering, Solana payments, loyalty and AI campaigns.

สถานะ: **วางแผน / Phase 0** ยังไม่มี POS runtime ใน repository นี้ แต่มีเว็บคู่มือทีมที่เปิดออฟไลน์ได้

เปิด [START-HERE.html](START-HERE.html) หรือ [คู่มือทีม](team-guide/index.html) ใน browser; ไม่ต้องติดตั้งหรือเปิด server

- GitHub owner: `cryptoclocks`
- Repository: [cryptoclocks/BitPOS](https://github.com/cryptoclocks/BitPOS)
- Local workspace: `/Users/cryptoclock/Desktop/BitPOS`
- Repository เริ่มเป็น private; ตรวจข้อกำหนด Hackathon ก่อนเปิด public และส่งงาน
- แยก lifecycle, deployment, secrets และฐานข้อมูลของ BitPOS จาก CryptoClock
- มี[แกลเลอรี BitPosClock 18 หน้า](team-guide/clock/index.html) และ PNG 480×320 สำหรับทีม เป็น visual prototype
- Firmware เครื่องหน้าร้านแยกมาเป็น BitPosClock (store terminal) ใน `device/firmware/` ภายใน repo นี้ มี build/config/version/OTA ของตัวเอง
- CryptoClock เดิม เช่นเครื่องที่บ้าน เป็น integration ผ่าน adapter ตามความสมัครใจ
- ย้าย UI และฟีเจอร์ POS เดิมครบ โดยรักษางานภาษาไทย/อังกฤษและสิทธิ์ผู้ใช้
- Supabase เก็บข้อมูลธุรกิจ; Solana เป็นหลักฐานการชำระและสิทธิ์บนเชน

เริ่มอ่าน [แผนเฟส](docs/PHASE_PLAN_TH.md), [แผนแยก firmware](docs/FIRMWARE_EXTRACTION_TH.md), [รายการต้นทาง](docs/SOURCE_AUDIT_TH.md), [สถาปัตยกรรม](docs/ARCHITECTURE_TH.md) และ [checkpoint](docs/CHECKPOINT.md)

รอบนี้ยังไม่คัดลอก runtime, `.env`, ข้อมูลลูกค้า หรือ secrets และยังไม่ deploy
