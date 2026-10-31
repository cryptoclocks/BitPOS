# BitPOS × PayPal AI Hackathon

แผนสำหรับส่ง BitPOS เข้าร่วมการแข่งขันอีกหนึ่งรายการ จัดทำ **12 ตุลาคม 2026 (Asia/Bangkok)** สถานะ: **วางแผน — ยังไม่ได้สมัคร ส่งผลงาน หรือติดตั้ง PayPal integration**

## แนวทางที่เสนอ

**BitPOS Café Copilot — Sell today's surplus with a bounded AI agent and verified PayPal payments.**

โจทย์หลัก: “ช่วยขายครัวซองต์ที่เหลือ 8 ชิ้นก่อน 16:00 ลดไม่เกิน 10%” — เป็นตัวอย่างโจทย์ ไม่ใช่ข้อมูลร้านจริง AI อ่านข้อมูลที่ตรวจได้ เสนอโปรผ่าน typed tools → server ตรวจจำนวน/ราคา/เวลา → คนขายตรวจ เลือกจอและยืนยัน → ลูกค้าสแกน QR สั่งและจ่าย **PayPal Sandbox** → server ตรวจ capture → BitPOS Mini แจ้งผล → แสดงจำนวนและยอดที่ตรวจสอบย้อนกลับได้

จุดแข็งที่ต้องพิสูจน์คือ agent ทำงานภายใต้ขอบเขตที่ร้านอนุมัติ เชื่อม stock/offer/PayPal/จอจริง และอธิบายผลด้วยหลักฐาน ไม่รับรองว่าเป็นแนวคิดแรกในตลาดหรือช่วยลดของเสียแล้ว ผล sandbox ต้องแยกจากยอดขายจริง

ผู้ใช้ต้องการเพิ่มโอกาสชนะถึง 80%; **ยังไม่มีข้อมูลรองรับการรับรองโอกาสนั้น** จึงปรับแผนเพื่อเพิ่มความสามารถแข่งขันและทดสอบจุดอ่อนก่อนส่ง ดู `WIN_STRATEGY_TH.md` (private, not in the public repo) คะแนนความพร้อมภายในเป็นเครื่องมือตรวจงาน ไม่ใช่เปอร์เซ็นต์ชนะ

## อ่านตามลำดับ

| เอกสาร | ใช้ทำอะไร |
|---|---|
| [IMPLEMENTATION_PLAN_TH.md](IMPLEMENTATION_PLAN_TH.md) | แผน implement ละเอียดพร้อม checklist ราย phase, data model, endpoints, test matrix และตารางเวลา 1–12 พ.ย. (31 ต.ค.) |
| [RULES_TH.md](RULES_TH.md) | เงื่อนไขส่งผลงาน กำหนดเวลา สิทธิ์ และประเด็นที่ต้องตรวจ |
| [PLAN_TH.md](PLAN_TH.md) | ขอบเขต MVP สถาปัตยกรรม เกณฑ์ผ่าน และลำดับงาน |
| `WIN_STRATEGY_TH.md` (private, not in the public repo) | จุดต่าง คู่เทียบ แผนเก็บหลักฐาน และเกณฑ์ตัดสินใจเพิ่ม/ตัดงาน |
| `MERCHANT_CASHFLOW_RESEARCH_TH.md` (private, not in the public repo) | สำรวจ API ล่าสุดและข้อเสนอ AI ช่วยวางแผนรายรับ/จ่าย supplier, utilities และ ads พร้อมข้อจำกัดไทย/x402 |
| [PROVENANCE.md](PROVENANCE.md) | ฐาน BitPOS ที่มีแล้ว งานร่วมที่กำลังทำ และงานใหม่ของรายการนี้ |
| [SUBMISSION_EN.md](SUBMISSION_EN.md) | ร่างคำอธิบายอังกฤษ checklist และบทเดโม 2:50 นาที |
| [SOURCES.md](SOURCES.md) | แหล่งทางการที่อ่านและข้อจำกัดของการตรวจครั้งนี้ |

**Deadline:** 12 พฤศจิกายน 2026 เวลา 12:00 PST = **13 พฤศจิกายน 2026 เวลา 03:00 น. ไทย** ตาม [Official Rules §1](https://paypalaihackathon.devpost.com/rules) เป้าภายในของทีม: ส่งให้เสร็จ **11 พฤศจิกายน เวลา 18:00 น. ไทย**

## ขอบเขตโฟลเดอร์

`PayPal/` เก็บแผนและชุดเตรียมส่งของการแข่งขัน ไม่สำเนา POS หรือ firmware อีกชุด เมื่อเริ่มพัฒนาจะต่อ adapter ใน `apps/`, `packages/`, `supabase/` และ `device/firmware/` ของ BitPOS ตามขอบเขตเดิม ใช้ Supabase BitPOS บน OCI ชุดเดียว ส่วน local tests แยกข้อมูลทดสอบ

เก็บ credentials นอก Git และ web roots เอกสารนี้ไม่มี sandbox credentials หรือข้อมูลลูกค้าจริง คู่มือ `team-guide/` เดิมยังเป็นเอกสาร offline ส่วน PayPal checkout และการเรียก AI ในแผนนี้ต้องใช้อินเทอร์เน็ต

การมีแผนนี้ยังไม่ใช่หลักฐานว่า PayPal, AI หรือ firmware รุ่นใหม่ผ่าน acceptance ดูสถานะและช่องว่างใน [PROVENANCE.md](PROVENANCE.md) ก่อนนำไปกล่าวอ้างใน submission
