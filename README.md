# BitPOS

Standalone merchant POS, customer ordering, Solana payments, loyalty and AI campaigns.

สถานะ: **วางแผน / Phase 0** ยังไม่มีแอปที่รันได้ใน repository นี้

- GitHub owner: `cryptoclocks`
- Repository: [cryptoclocks/BitPOS](https://github.com/cryptoclocks/BitPOS)
- Local workspace: `/Users/cryptoclock/Desktop/BitPOS`
- Repository เริ่มเป็น private; ตรวจข้อกำหนด Hackathon ก่อนเปิด public และส่งงาน
- แยก lifecycle, deployment, secrets และฐานข้อมูลของ BitPOS จาก CryptoClock
- CryptoClock เป็นอุปกรณ์หนึ่งที่เชื่อมผ่าน integration contract
- ย้าย UI และฟีเจอร์ POS เดิมครบ โดยรักษางานภาษาไทย/อังกฤษและสิทธิ์ผู้ใช้
- Supabase เก็บข้อมูลธุรกิจ; Solana เป็นหลักฐานการชำระและสิทธิ์บนเชน

เริ่มอ่าน [แผนเฟส](docs/PHASE_PLAN_TH.md), [รายการต้นทาง](docs/SOURCE_AUDIT_TH.md), [สถาปัตยกรรม](docs/ARCHITECTURE_TH.md) และ [checkpoint](docs/CHECKPOINT.md)

รอบนี้ยังไม่คัดลอก runtime, `.env`, ข้อมูลลูกค้า หรือ secrets และยังไม่ deploy
