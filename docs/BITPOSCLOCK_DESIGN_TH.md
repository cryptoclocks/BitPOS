# BitPosClock — ชุดภาพจำลองหน้าจอ

วันที่: 7 ตุลาคม 2026 · สถานะ: visual prototype สำหรับทีม

ผู้ใช้ขอให้คู่มือออฟไลน์เปลี่ยนเป็นม่วง ใช้ภาพ BitPOS เดิม และสร้างภาพจำลองแต่ละหน้าของ BitPosClock ด้วย skill `cryptoclock-pro-design` จาก `CryptoClockPro/resources/design-system/reference/SKILL.md`

## สิ่งที่เปิดดูได้

- คู่มือหลัก: `team-guide/index.html` / `START-HERE.html`
- แกลเลอรีกดเลือกทั้ง 18 หน้า: `team-guide/clock/index.html`
- ภาพ PNG รายหน้า 480×320: `team-guide/assets/bitposclock/bpc-*.png`
- ภาพรวมเส้นทางหลัก 6 หน้า: `team-guide/assets/bitposclock/overview.png`
- ภาพรวมครบ 18 หน้า: `team-guide/assets/bitposclock/all-screens.png`
- Source สำหรับ render: `team-guide/clock/render.html`, `screens.js`, `render.js`, `device.css`

นี่ไม่ใช่ firmware หรือ POS runtime: ไม่มี transaction, wallet connection, AI call, mint, notifications หรือการ flash เครื่อง ข้อมูลราคา เวลา เมนู wallet รางวัล และ QR เป็น fixtures ทั้งหมด QR เป็นรูปประกอบที่สแกนไม่ได้ ส่วน 3.50 USDG ต่อบิล 120 THB เป็น quote สมมติ ไม่ใช่อัตราแลกเปลี่ยนปัจจุบัน

## หน้าที่เสนอ

| ID | หน้า | เฟสที่เกี่ยวข้อง |
|---|---|---|
| BPC-01 | จอพัก เวลา + SOL/USDT | 4 |
| BPC-02 | จอพัก เมนู / แคมเปญที่ owner publish | 4 / 6 |
| BPC-03 | สรุป order และเมนูก่อนจ่าย | 2 / 4 |
| BPC-04 | เลือก USDG / PromptPay / เงินสด | 3 / 4 |
| BPC-05 | USDG / Solana Action QR พร้อมเมนู | 3 / 4 |
| BPC-06 | PromptPay QR | 3 / 4 |
| BPC-07 | เงินสด รอพนักงานรับและยืนยัน | 1 / 3 / 4 |
| BPC-08 | กำลังตรวจสอบ payment ยังไม่ paid | 3 / 4 |
| BPC-09 | Paid + สถานะ / เสียงครั้งเดียว | 3 / 4 |
| BPC-10 | QR ดูหรือ claim สิทธิ์หลังจ่าย | 5 |
| BPC-11 | เปิดผลสุ่ม collectible เมื่อ grant/issuance สำเร็จ | 5 |
| BPC-12 | ความคืบหน้าแต้มและ tiers | 5 |
| BPC-13 | Voucher แลกแล้ว / ใช้ซ้ำไม่ได้ | 5 |
| BPC-14 | Paid แต่ reward ยัง pending | 5 |
| BPC-15 | Failed / QR expired / ตรวจ late settlement | 3 / 4 |
| BPC-16 | Offline / reconnect / resync | 4 |
| BPC-17 | ตัวอย่าง Wi-Fi campaign หลังผ่านเงื่อนไข | 7 |
| BPC-18 | Owner device settings / ผูกร้าน | 1B / 4 / 7 |

ID เหล่านี้เป็น inventory ของภาพจำลอง BitPosClock ที่เสนอ ไม่ใช่ package codes P001…P009 ของ CryptoClock และไม่ใช่การรับรองว่าหน้าจอบนเครื่องจริงมีแล้ว แกลเลอรีแสดง trigger, backend contract และหน้าถัดไปของแต่ละหน้า

Loyalty/NFT voucher/ตุ๊กตาขึ้นกับ policy และ stock ของร้าน; ไม่อ้างว่าทุกช่องทางได้รางวัลเหมือนกัน การ sign ไม่ทำให้ paid; เมื่อ paid แล้ว mint ล้มเหลวต้องเป็น reward pending และ retry การ claim ต้องตรวจใบเสร็จ/session และ wallet binding ไม่ให้คนอื่นหยิบ QR ไปแย่งสิทธิ์ของผู้จ่าย

## หลักการจาก design skill

- อ่าน SKILL/README, colors/typography/fonts และ clock specimens P002/P003/P007; ตรวจ `device/firmware/components/board_bsp/include/ccp_board.h`: panel-native 320×480 และ logical rotation 90° ให้ landscape 480×320
- เปลี่ยน teal brand เป็น purple ตามคำขอโดยตรงของผู้ใช้ แต่รักษา gold สำหรับ rewards และ semantic green/red พร้อมข้อความสำหรับสถานะ/ทิศทางตลาด
- ใช้พื้นทึบ, 1px borders, radius 8/12/16 และ gradient แนวตั้งสองสีใน collectible; ไม่มี blur, drop shadow, video หรือ shaders ในภาพหน้าจอเครื่อง
- Montserrat Latin, Sarabun Thai, DSEG7 เฉพาะตัวเลข/เวลาและ ghost digits; DSEG14 สำหรับ SOL-USDT จาก fonts ของ kit พร้อม license ของแต่ละ family
- Artwork กาแฟสร้างด้วย SVG ใน source ให้ render ซ้ำได้ ไม่ใช้ emoji บนจอ ภาพนี้สอดคล้อง Espresso Dawn concept ของคู่มือ ไม่ใช่ NFT ที่ออกบนเชนแล้ว
- ภาพเป็น static view; GIF / paid animation / audio เป็นพฤติกรรมที่เสนอ ต้องตรวจ current firmware decoder/contracts และ memory budgets ก่อนทำจริง
- Web font assets ไม่ใช่ device-ready LVGL fonts ต้อง bake และตรวจ glyph coverage/Thai shaping บน renderer ที่เลือก อีกทั้งต้องทดสอบ QR encoder, touch, SD, Wi-Fi, transport, audio, reconnect และ render ACK บนบอร์ดจริง

## ภาพและฟอนต์ต้นทาง

ภาพตัวเครื่องเดิมคัดลอก byte-for-byte จาก `CashlessThailand/cashlessthailand/public/images/products/bitpos-terminal/main.800.webp` เป็น `team-guide/assets/legacy/bitpos-terminal.webp` ไม่แก้ภาพและไม่อ้างว่าเป็นบอร์ด BitPosClock ภาพประกอบเดิมมี Bitcoin/card/printer ส่วนผลิตภัณฑ์ใหม่นี้ยังต้องพัฒนาตามแผน

เปิดตรวจ assets ก่อนเลือกใช้: ไฟล์ชื่อ `lifestyle-cafe` เป็นภาพรถ, `action-print` เป็นภาพคน และ `side`/`action` เป็น placeholder จึงไม่นำมาใช้เป็นภาพร้านหรือเครื่องจริง

ฟอนต์ Montserrat/DSEG7/DSEG14 มาจาก portable design kit; Sarabun มาจาก Google Fonts สำหรับคู่มือเดิม เก็บ license ใน `team-guide/assets/fonts/` และ hashes/source mapping ใน `team-guide/assets/provenance.json` ไม่มีการคัดลอกข้อมูลผู้ค้า/ลูกค้า/credentials

## Render และตรวจ

`tools/render-bitposclock.cjs` เปิด renderer ด้วย `file://` ใน offline browser context แล้วบันทึก PNG รายหน้า ตรวจข้อความไม่ออกนอกกรอบ และทำ contact sheets ด้วย native HTML ที่อ้างไฟล์ภาพ local

`tools/verify-bitposclock.cjs` ตรวจ gallery/PNG, selection, filters, deep links, keyboard, navigation และความกว้าง 390/320; `tools/verify-team-guide.cjs` ตรวจคู่มือหลัก ทุก script ต้องมี Playwright/Chrome เฉพาะเครื่องที่สร้างและตรวจ artifact คนอ่านเปิด HTML ได้ทันทีโดยไม่ต้องติดตั้งอะไร

ผลตรวจทั้งหมดเป็น local browser evidence ไม่ใช่ hardware หรือ live-chain evidence Firmware อยู่ในเฟสแยกตาม `FIRMWARE_EXTRACTION_TH.md` และต้อง build/config/provisioning/OTA เป็น BitPOS เอง
