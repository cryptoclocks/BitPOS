# BitPOS offline team guide

ดับเบิลคลิก `../START-HERE.html` หรือ `index.html` เพื่อเปิดใน Chrome, Edge, Firefox หรือ Safari รุ่นปัจจุบัน ไม่ต้องติดตั้ง Node, เปิด server หรือเชื่อมอินเทอร์เน็ต

## เนื้อหา

16 บท: ภาพรวมและลูกค้า, ประโยชน์ต่อร้านค้าและ Solana / เหตุผลเลือกจอ CryptoClock Pro 3.5 นิ้วและ USDG, flow จำลอง, architecture diagram, payments/Blinks, data boundaries, POS 25 หน้าจอ, firmware, loyalty/NFT, AI/campaign economics, integrations, stack/repo, phases/workstreams, OCI snapshot, Hackathon และ glossary/references

- ธีมม่วง พร้อมภาพประกอบตัวเครื่อง BitPOS เดิมที่ตรวจและบันทึก provenance แล้ว
- แกลเลอรี `clock/index.html` และภาพ PNG 18 หน้า BitPosClock ขนาด 480×320 พร้อม trigger / backend contract
- Search + keyboard shortcut, mobile navigation และสารบัญตามตำแหน่งที่อ่าน
- Diagram กดเลือก module และบันทึก standalone SVG ได้
- Flow จำลอง 3 payment methods × 4 scenarios: success / failure / duplicate / reward failure
- Collectible SVG concepts 5 แบบ ยังไม่ใช่ NFT ที่ mint แล้ว
- Campaign calculator เป็น deterministic illustration ไม่เรียก AI/provider จริง
- ปุ่มพิมพ์/PDF เปิด details ครบก่อน print
- ฟอนต์ไทย Sarabun บรรจุใน `assets/fonts/` พร้อม `OFL.txt` จาก Google Fonts repository

## การส่งให้ทีม

เก็บ `START-HERE.html`, `team-guide/` และ `docs/` ไว้ด้วยกัน ลิงก์ .md อาจแสดงเป็นข้อความหรือดาวน์โหลดตาม browser เนื้อหาอธิบายในหน้าเว็บอ่านได้โดยไม่ต้องเปิด .md

แพ็กเกจ ZIP ที่สร้างไว้ใน `../artifacts/team-guide/` เป็น output ไม่ใช่ source เมื่อเอกสารเปลี่ยนต้องสร้างใหม่ ใช้ปุ่มพิมพ์ / PDF ในเว็บหากต้องการบันทึกเอกสารจาก browser

สร้างภาพด้วย `tools/render-bitposclock.cjs` แล้วตรวจด้วย `tools/verify-team-guide.cjs` และ `tools/verify-bitposclock.cjs` ก่อนใช้ `python3 tools/package-team-guide.py` เพื่อสร้าง ZIP ใหม่

HTML/CSS/JavaScript และ SVG ใช้ไฟล์ local ไม่มี CDN, external font runtime, API calls, tracking หรือ service worker ลิงก์ไปเว็บไซต์การแข่งขัน/เอกสารภายนอกเป็น optional references ที่ต้องออนไลน์เมื่อกดเปิด

## สถานะของเนื้อหา

นี่คือคู่มือ/แบบจำลองสำหรับทีม ไม่ใช่ POS runtime หรือ firmware build ไม่รับเงินจริง ไม่เชื่อม wallet ไม่ mint NFT และไม่ส่ง notifications สถานะ audit เป็น snapshot วันที่ 7 ตุลาคม 2026 ไม่ใช่ monitoring สด

อ้างอิง plans/checkpoint ใน `../docs/` ข้อมูลการแข่งขันตรวจจาก primary sources วันที่ 7 ตุลาคม 2026 และต้องตรวจ portal ใหม่ก่อน submission เว็บนี้เป็นภาษาไทยสำหรับทีม; submission materials ต้องเตรียมภาษาอังกฤษตาม official rules

## Browser QA

`../tools/verify-team-guide.cjs` ใช้ Playwright เฉพาะตอนตรวจงาน เปิด `file://` ใน offline context และตรวจ page errors, external requests, filters, scenarios, calculator, responsive layout และ print layout

รายละเอียดการออกแบบและต้นทางดู `../docs/BITPOSCLOCK_DESIGN_TH.md` ใช้ skill ที่ผู้ใช้ระบุ ปรับ palette เป็นม่วงตามคำขอ และเก็บ font licenses ครบ; ภาพจำลองยังไม่ใช่ firmware ที่ทำงานจริง

สำหรับเครื่องที่มี Playwright และ browser อยู่แล้ว สามารถรันด้วย Node โดยตั้ง `BITPOS_PLAYWRIGHT_MODULE` และ `BITPOS_CHROME_EXECUTABLE` ตามตำแหน่งจริง ไม่ต้องใช้เครื่องมือเหล่านี้เพื่ออ่านคู่มือ

## Latest runtime references — 9 October 2026

The guide remains fully local/offline documentation and concepts, not a live POS. Current status banners now distinguish the actual0.3.1 table-entry QR/guest menu/devnet/physical flow from historical0.2.4/0.3.0 cohorts. Three current guest rounds have original physical ACK759/859/1094ms; no30/p95/subsecond acceptance claim. Latest native review/gate status belongs to `../docs/CHECKPOINT.md`, not a static guide badge.

`../docs/DEMO_VIDEO_TH.md` has the current table Scan-to-order→guest photo/cart→canonical bill→distinct exact-order paymentQR→marked browserfixture→finalized assigned physical display shot plan and English narration. Android Phantom physical scan/payment remains explicitly deferred; framebuffer decode, host mocks and browser test-wallet fixtures are not phone/camera/acoustic proof. Full25-screen POS parity and post-submission integrations remain roadmap. Actual Brave `file://` offline reload proved local Sarabun,25inventory entries,zeroHTTP runtime requests/zero page errors/no horizontal overflow; evidence `.omp/work/evidence/public-table-offline-guide-current.json`.
