# แผนส่งเดโมด้วย omp — 8 ตุลาคม 2026

สถานะ: แผนแบ่งงาน ยังไม่ได้เปิด mission หรือส่งงานให้ subagent

อัปเดตการเตรียม harness: มี project config, native agent roles และ completion gate แล้ว ตั้ง isolation=true/apply=false เพื่อให้ coordinator รวม patch ทีละชุด ต้องตรวจผล isolation จริงก่อนเริ่ม task เขียน product

ผู้ใช้อนุญาต YOLO/browser automation และเลื่อนการสแกนจ่ายผ่าน Phantom บน Android จริงออกจากรอบปัจจุบัน ให้ implement/test ส่วนอื่นก่อน ผล browser fixture ต้องระบุว่าเป็นจำลอง และมือถือยังรอทดสอบ WiFi provisioning เก็บ private แล้ว

## ขอบเขต

ส่งชุดถ่ายวิดีโอ 10 ตุลาคม 18:00 ประเทศไทย: เลือกอาหาร → บิล/ลูกค้า/wallet → sponsored USDG devnet → ยืนยัน finalized → POS และจอจริงสำเร็จ WiFi + WebSocket

Supabase บน OCI เป็นระบบใช้งานจริงของ BitPOS หนึ่งชุด ไม่มี staging อีกชุด ไม่ใช้ฐานข้อมูล CryptoClock ร่วมกัน ระบบเงินจริง/mainnet ยังอยู่นอกขอบเขต ใช้ชุดที่เริ่มสร้างไว้แทนการสร้างซ้ำ ตรวจ authentication, migration, backup และทรัพยากรก่อนถือว่าพร้อม

## การควบคุมงาน

Codex ดูแล harness, checkpoint และการปฏิบัติการที่ได้รับอนุญาต omp เป็นเจ้าของ implementation ใน Terminal UI ใช้ native task และ persistent goal ของ omp

นำแนวทาง BMAD มาใช้สำหรับ brief, architecture, stories, acceptance และการตรวจงาน ไม่เพิ่ม runtime orchestration อีกระบบ งานทั้งหมดอยู่ใน BitPOS และอ่าน CryptoClock ได้เฉพาะ reference

ใช้ค่า owner ตาม harness ล่าสุด: openai-codex/gpt-6.1-sol low; architect และ independent reviewer high ตรวจ catalog ก่อนเปิดจริง ไม่คัดลอกบัญชี credentials หรือ acceptance เก่ามา

## หน้าที่

| หน้าที่ | ขอบเขต/ผลส่งมอบ |
|---|---|
| Coordinator / architect | ล็อก API และ event contract, แบ่ง stories, รวมงานและหลักฐาน |
| POS / customer web | เมนู ตะกร้า customer edit deterministic avatar และ wallet challenge UI |
| Payment / backend | tenant permissions, challenge verification, quote, sponsor/verifier, stock/outbox/reconciliation |
| Firmware | build อิสระ, touch/display, WiFi/WebSocket, version/dedup/ACK/offline |
| Independent reviewer | ตรวจ source และหลักฐาน ทดสอบข้อผิดพลาด ไม่แก้ implementation เอง |

ทำงานคู่ขนานหลังตรวจ task isolation เท่านั้น แต่ละ writer ใช้ worktree ของตัวเอง หนึ่ง writer ต่อ checkout Coordinator รวมงานแบบลำดับ หาก isolation ไม่ผ่าน ให้ task วิเคราะห์/ตรวจแบบ read-only และ implementation writer ทำ stories ตามลำดับ ห้ามหลาย agent แก้ checkout เดียวพร้อมกัน

migration, OCI deploy และ USB flash มีผู้ปฏิบัติคนเดียวผ่าน coordinator ไม่ให้แต่ละ agent เปิด Supabase หรือยิง transaction ซ้ำ งาน scaffold ที่ยังไม่ commit ต้อง checkpoint และตรวจ secret ก่อนใช้เป็นฐาน worktree

## ลำดับส่งงาน

1. 8 ต.ค.: ตรวจ harness/locks/catalog, กู้สถานะ scaffold, ยืนยัน backup; ล็อก contracts; payment spike กับ firmware shell และเว็บแบ่งงานได้
2. 9 ต.ค.: รวม flow จริง, permissions/customer binding, finalized settlement/outbox, reconnect และจอจริง หาก flow ไม่ผ่านหยุด AI/NFT
3. 10 ต.ค. ก่อน 18:00: freeze, เดโมจริง 10 รอบ, setup/reset/URL/transaction links และหลักฐานจอ ส่งทีมวิดีโอ
4. 11 ต.ค.: เพิ่ม AI campaign/NFT เฉพาะบน baseline ที่ผ่าน
5. 12 ต.ค.: ตรวจ deadline และ submission ทั้งสองช่องทาง

เกณฑ์ตรวจ: amount/mint/recipient/reference ผิดต้องไม่ paid, challenge ปลอม/หมดอายุถูกปฏิเสธ, tenant แยก, duplicate/restart ไม่หัก stock หรือเสียงซ้ำ, guest และประวัติลูกค้าใช้งานได้ วัด finalized verification → physical render ACK 30 รอบ เป้าหมาย p95 < 1 วินาที แยกเวลา chain finalization

## สถานะจริงที่ต้องแก้ก่อนประกาศพร้อม

- omp 18.6.0 รองรับ native task; harness reference ตั้ง maxConcurrency=1 และ isolation=false จึงยังไม่ใช่ parallel writer configuration
- Scaffold POS/API/database/payment adapter และ firmware dependency extraction ยังไม่ใช่ demo ที่ผ่าน
- OCI ชุดใหม่ชื่อ bitpos-staging: database healthy แต่ auth/rest/storage มีปัญหา authentication ต้องแก้ และเปลี่ยน lifecycle ให้เป็น BitPOS actual-use ชุดเดียวโดยไม่ลบ volume
- สำรองแฟลชจอเดิมครบ 16,777,216 bytes เก็บ private ใน BitPOS ยังไม่ได้เขียน firmware ใหม่
- ต้องตรวจพื้นที่ดิสก์และ RAM อีกครั้งก่อน deploy; ตัดบริการเสริมที่ไม่ใช้ เช่น Studio/analytics ออกจากชุดเดโม ไม่ลบ Docker ของระบบอื่นโดยเดา

อ้างอิง: https://github.com/bmad-code-org/BMAD-METHOD และ /Users/cryptoclock/.codex/skills/omp-harness-engineer/SKILL.md
