# คุณค่าของ BitPOS และเหตุผลเลือกองค์ประกอบ

วันที่: 7 ตุลาคม 2026 · สถานะ: product hypotheses / แนวทางตามแผน

อธิบายใน `team-guide/index.html#benefits` ซึ่งเป็นบทที่ 02 ของคู่มือ 16 บท ผู้ใช้ขอให้ทีมเข้าใจว่าร้านได้อะไร Solana ได้อะไร ทำไมเลือกฐาน CryptoClock Pro จอทัชสกรีน 3.5 นิ้ว และทำไมเลือก USDG

## ร้านค้า

ร้านใช้ POS เดิมครบตามแผน พร้อมเลือก cash / PromptPay / USDG เชื่อม order, quoted amount และ verified payment ให้ตรงกัน พนักงานคีย์หรือลูกค้าสแกนเว็บเพื่อสั่งเองได้ จอหน้าร้านช่วยให้ลูกค้าเห็นยอดและผลชำระร่วมกับร้าน

Loyalty, collectible, voucher เครื่องดื่มและของจริงสร้างเหตุผลให้กลับมาร้าน โดยอิง paid order, eligibility และ redemption policy แคมเปญ AI ใช้เมนู/ต้นทุน/stock/ยอดขาย ให้ owner ตรวจ budget และเผยแพร่ก่อนใช้งาน

ประโยชน์เหล่านี้ยังไม่ใช่ผลที่พิสูจน์แล้ว ต้องวัด checkout completion, เวลาปิดบิล, staff intervention, repeat visits, redemption และ margin หลังรวมค่าบริการ/FX/ต้นทุนรางวัลใน pilot

## Solana ecosystem

สมมติฐานของทีมคือร้านที่รับ USDG จะเพิ่ม stablecoin payment volume ที่ผูกกับสินค้าจริงและเปิดทางให้ลูกค้าใช้ wallet กับร้านซ้ำ จาก payments ไปสู่ loyalty/ownership และสิทธิ์ตามแคมเปญ

Reusable order/Action/payment verification/device event/reward interfaces ช่วยให้นักพัฒนาต่อยอดกับร้านและงานอีเวนต์ได้เมื่อเปิดเผยตามแผน Metrics ที่ควรรายงานคือ active merchants, verified USDG volume, active paying wallets และ repeat paying wallets ไม่อ้างว่าจำนวน QR scans เท่ากับจำนวนผู้ใช้ที่จ่ายเงินจริง

## CryptoClock Pro 3.5 นิ้ว → BitPosClock

เลือกเป็นฐานเพราะทีมมีอุปกรณ์และ display/touch/Wi-Fi/audio/LVGL อยู่แล้ว แยก firmware/config/provisioning/OTA ของ BitPOS ตามแผน การ reuse ลดงานตั้งต้น แต่ยังต้องทำ extraction/build/test และ protocol integration

Landscape 480×320 เหมาะกับยอดหนึ่งบิล รายการสั้น QR และการแตะสลับวิธีจ่าย POS 25 หน้าและการจัดการร้านยังอยู่บนเว็บ จอ idle แสดงเวลา ticker/GIF/เมนู และหลัง backend ยืนยัน payment จึงเปลี่ยนสถานะ/ส่งเสียง/แสดง reward

ฮาร์ดแวร์เป็นส่วนเสริม ลูกค้าใช้มือถือและร้านใช้เว็บได้ ประโยชน์ของจอเฉพาะคือแสดงผลที่เคาน์เตอร์ต่อเนื่องและให้ร้าน/ลูกค้าเห็นสถานะร่วมกัน ต้องพิสูจน์ระยะสแกน QR, touch targets, audio, disconnect recovery และ latency หลัง backend ยืนยันบนบอร์ดจริง ไม่อ้างว่ามีผลเหนือมือถือโดยยังไม่มี pilot

ขนาดจอ 3.5 นิ้วเป็นฐานผลิตภัณฑ์ตามโจทย์ผู้ใช้; resolution/orientation/touch/audio ตรวจจาก `CryptoClockPro/device/firmware/components/board_bsp/include/ccp_board.h` และ design reference การทดสอบรอบนี้เป็น browser mockup เท่านั้น

## USDG

เลือกเป็น stablecoin แรกของเดโม เพราะออกแบบให้อิง USD มี issuer/reserve disclosures มีบน Solana และสอดคล้องกับรางวัล USDG ของ Superteam AI × Solana track ที่ทีมจะส่ง โครงการยังไม่อ้างว่า sponsor ให้คะแนนเพิ่มเพราะใช้เหรียญนี้

USDG ใช้รับชำระ; SOL ใช้ network fee; CLOCK เป็นทางเลือก loyalty ไม่บังคับซื้อ CLOCK ก่อนซื้ออาหาร การ fee sponsor เป็นงานออกแบบเพิ่ม ยังไม่ได้ทำให้ลูกค้าใช้งานโดยไม่ต้องมี SOL แล้ว

ราคา THB ยังต้องใช้ conversion quote/source/expiry เพราะ stable กับ USD ไม่ใช่ THB การเลือก off-ramp, account eligibility และค่าบริการ/FX spread เป็นส่วนของร้านนำร่อง Stablecoin ตัวอื่นเพิ่มได้ผ่าน payment adapter เมื่อกำหนดและตรวจ network/mint/token program อย่างถูกต้อง เงินสด/PromptPay ยังเป็นทางเลือก

## ข้อเท็จจริงและแหล่งทางการที่ตรวจ 7 ต.ค. 2026

- [About USDG](https://globaldollar.com/about-usdg): USDG อิง USD, redemption basis 1:1 และมีบน Solana เป็นหนึ่งในหลายเชน
- [Paxos mint and redeem](https://www.paxos.com/mint-and-redeem): reserve assets เป็น USD deposits, US Treasuries / cash equivalents; reserve reports / attestations รายเดือน และ direct access ผ่าน institutional account
- [How payments work on Solana](https://solana.com/docs/payments/how-payments-work): wallet/token account/mint/token program, fee payer และ SOL fee; ต้องตรวจ mint/program ไม่ใช้ชื่อ token เป็นหลักฐาน
- [Superteam AI × Solana track](https://superteam.fun/earn/listing/ai-solana-track): prize denomination USDG; ใช้เป็นบริบทการเลือกในเดโม ไม่ใช่ technical requirement ของ Solana

ประโยชน์ทางธุรกิจและ ecosystem ในเอกสารนี้เป็นการวิเคราะห์ของทีมจาก flow ที่เสนอ แยกจากข้อเท็จจริงของ issuer/network ไม่มีผลทดลองที่รับรองยอดขายหรือ retention แล้ว
