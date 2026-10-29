# แผนพัฒนางานที่เหลือ (ฉบับ 2 หลังตรวจ 1 รอบ) — 2026-10-29

เป้าหมาย: พร้อม Demo ไม่ใช่ Production ไม่ติ๊กเช็กลิสต์โดยไม่มีหลักฐาน ใช้ devnet เท่านั้น
เช็กลิสต์หลัก: `.omp/work/h2-merchant-pricing-20261026/DIRECT_SESSION_CHECKLIST_TH.md` (เหลือ 176 ข้อ)

## กฎร่วม
- ทุกชุดจบด้วย: เทสต์ผ่าน + หลักฐาน + บันทึก CHECKPOINT + ติ๊กเฉพาะข้อที่มีหลักฐาน
- ฟีเจอร์ที่ทำไม่ได้ ให้ทำเป็นช่อง **BLOCKED** พร้อมเหตุผล ห้ามตัดเงียบๆ
- ฐานข้อมูลทดสอบ: Postgres พอร์ต 55440 (`BITPOS_BACKEND_INTEGRATION=1`) ใช้ทีละงานที่เขียน DB; งานขนานที่ต้องใช้ DB ให้สร้าง database ชื่อแยก
- การเงิน: quote ฝั่งเซิร์ฟเวอร์ จำนวนเต็ม minor units ตรวจ chain/mint/recipient/amount dedupe devnet เท่านั้น
- AI: ร่างแคมเปญต้องให้เจ้าของตรวจก่อนเผยแพร่ ห้ามโมเดลถือกุญแจ ห้ามใช้ template อ้างเป็นคำตอบโมเดล
- ไม่แตะ main checkout, Meta stack; ไม่ commit ความลับ

## คำตัดสินที่ผู้ช่วยทำแล้ว (เจ้าของมอบให้ตัดสินเรื่องเล็ก)
- W03/WD23 (guest option picker), P41 (คืนเงินรายบรรทัด), W13/W21/W22/WD16: **คงเป็นภาพแนวคิด** ไม่สร้างใน Demo → DS38 ส่วน UI และช่องที่ผูกกับเฟรมเหล่านี้เป็น BLOCKED (ไม่ใช่ตัดทิ้ง)
- DS43 โทรแบบปิดเบอร์ และ DS54 PromptPay: **BLOCKED** (ไม่มีผู้ให้บริการที่อนุมัติ) ทำเป็นสถานะ "ยังไม่เปิดใช้งาน" ที่ซื่อสัตย์

## ตารางไฟล์ที่แต่ละชุดแตะ / รันขนานได้หรือไม่
| ชุด | แตะ | ขนานกับ |
|---|---|---|
| WP2 POS/Pay/Platform web | `apps/web/**`, เล็กน้อย `apps/api` catalog | WP3a, WP6b |
| WP3a Backend เบา | `apps/api/src/{discovery,chat,privacy,rides}*`, `apps/worker`, tests, migrations ใหม่ | WP2 |
| WP3b คูปอง/ออเดอร์ล่วงหน้า/คืนเงิน | `payments.ts`, `orders.ts`, worker | ต่อกันเท่านั้น (ห้ามขนาน) |
| WP0 Customer + shared | `apps/mobile-customer`, `packages/mobile_shared` | WP2, WP3a |
| WP1 เทียบ FigCraft | อ่านเป็นหลัก แก้ CSS/FigCraft | **หลัง** WP2 ของหน้านั้นปิด |
| WP6b backup/runbook | `docs/`, `tools/` | ทุกชุด |

## WP0 — Customer และ shared states (DS03, DS04, DS34)
- DS03 U01–U04 เทียบภาพหลัง toolbar/top-align; DS04 ลำดับ home/search/filter, closed/out-of-zone/offline, cart เมื่อเปลี่ยนสาขา
- DS34 shared loading/empty/error, TH/EN, dark, large-text ทั้งเว็บและมือถือ
- ปิด: flutter test (customer, shared) ผ่าน + หลักฐานต่อข้อ

## WP2 — หน้าจอ POS/Pay/Platform (ทำก่อน WP1)
ลำดับตามคุณค่า Demo:
1. DS26 P40 ปุ่มยืนยันรหัสส่งมอบ + แจ้งปัญหา; DS21 ตัวเลือกย่อย/ลบสินค้า/draft; DS24 ฟอร์มลูกค้าและ search/error
2. DS23 รายงาน/ส่งออก (หน้าจอ), DS22 ต้นทุน/หน่วย/low-stock/suppliers (migration), DS25 printer + branch hours (storage/API)
3. DS28 options sheet + WD24–WD26 (ยกเว้น WD23 = BLOCKED), DS29–DS30 wallet/receipt/recovery/help, DS31–DS33 Platform dispatch/ledger/support
- ปิด: เทสต์เว็บ + browser smoke EN/TH 1440/390; deploy OCI (rollback tag ก่อน) เมื่อเปลี่ยนเว็บ

## WP3a — Backend เบา (ขนานกับ WP2)
- DS35–DS37: เทสต์ recovery ผ่าน UI→HTTP→SQL; no-driver/withdrawal/failed-delivery; location/ETA adapter (ไม่มีผู้ให้บริการ = BLOCKED ป้ายชัด)
- DS44 retention job + เพิกถอน wallet/device consent; DS45 openNow/hours ใน discovery
- DS46–DS48 ที่เหลือ: wait state, no-driver, requote, เทสต์ restart ของ share (1135); DS50 ต่อ ops + simultaneous edit/replay
- DS43: เทสต์ process death/upload expiry/retention; masked call = BLOCKED
- ปิด: DB-backed 0 ข้าม

## WP3b — คูปอง/ออเดอร์ล่วงหน้า/คืนเงิน (ต่อกัน ห้ามขนาน)
DS41 คูปองผูก quote→order→payment→refund (smoke 097/098) → DS42 due-work worker + payment → DS39 refund unknown + reconcile → DS40 statements/export → DS38 backend allocation (UI = BLOCKED)

## WP5 — เติบโต/POS (ลำดับต่ำ)
DS51 แบตช์/สมาชิก/แนะนำ; DS52 รางวัล + แคมเปญ AI (ร่างให้เจ้าของตรวจ); DS53 รายงานการเงิน/CSV; DS54 POS เงินสด/shift/void (PromptPay = BLOCKED); **DS49 หลายร้าน** (ใหญ่สุด ไม่จำเป็นต่อ Demo)

## WP1 — เทียบ FigCraft กับหน้าจริง (หลัง WP2/WP0 ของหน้านั้น)
ภาพ 1440/390 เทียบ PNG ใน `design/figcraft/previews/current-native/`; แก้เฉพาะช่องที่ WP ก่อนหน้าปิดแล้ว; ครอบ DS03–DS04, DS20–DS34; ติ๊กช่อง "actual render" เมื่อมีภาพ

## WP6 — คุณภาพและส่งมอบ
- 6a DS55 accessibility/offline บน AVD, iOS = ตรวจเท่าที่ทำได้ อื่นๆ BLOCKED
- 6b DS56 backup/restore บนฐานทดสอบ + runbook + load เบา (ทำขนานได้ตั้งแต่ต้น)
- 6c DS57: รันอาหารครบเส้นทางบน AVD (อ่านคำสั่งใน CHATGPT_CONTINUE_PROMPT) ; ปิดทีละข้อ 1312–1317
- 6d DS58 ข้อ 1334: ปรับรายงานส่งมอบ ระบุ W01–W18 ที่ยังเป็น BLOCKED/แนวคิด
- เฟรมแนวคิด: คงป้ายไว้

## งานของผู้ส่ง (ทำแทนไม่ได้)
ลงทะเบียนทีม, ฟอร์มส่งงาน, วิดีโอ 2 ชิ้น, สิทธิ์งานที่รับมา — `docs/SUBMISSION_CHECKLIST.md`

## ลำดับเริ่ม
1. **เริ่มเลย (ขนาน):** WP2 ขั้น 1 + WP3a (DS35–37, DS48) + WP6b
2. WP2 ขั้น 2–3, WP0 → WP3b → WP1 → WP5 → WP6a/c/d

---

# ฉบับ 3 — แผนทำต่อให้จบ (2026-10-29 ช่วงบ่าย) · ร่างก่อนตรวจ

สถานะ: เช็กลิสต์เหลือ **174 ข้อ** (ติ๊กแล้ว ~14 ข้อวันนี้) deploy ถึง #17/#18 บน OCI (migration ถึง 173) ยังไม่ merge PR #2
กลุ่มของ 174 ข้อ (จากการนับ): ช่อง "UI ตรงแบบและกดได้ / actual render เทียบ FigCraft" ประมาณ 40 ข้อ (ทุกชุด DS20–DS58), ช่องงานสร้างที่ขาด ประมาณ 90 ข้อ, ช่องที่ต้องเครื่องจริง/ผู้ให้บริการ ประมาณ 25 ข้อ, ที่เหลือเป็นช่องรับหลักฐานเดิม

## เฟส A — โครงทดสอบเต็มรูปแบบในเครื่อง (ปลดล็อกหลักฐาน UI เกือบทั้งหมด)
- ยกชุด local stack: Postgres fixture 55440 + API + worker + web (build ด้วย PUBLIC_URL ท้องถิ่น) + บัญชีร้านทดสอบ/ลูกค้าทดสอบที่สร้างเองในเครื่อง (ไม่ใช้บัญชีจริง) เพาะข้อมูล: สินค้า/ตัวเลือก/คูปอง/รางวัล/ช่วงเวลา/ออเดอร์ทุกสถานะ/โต๊ะ/คนส่ง
- เขียนสคริปต์ Playwright ที่เปิด POS/Pay/Platform/เมนูโต๊ะ ล็อกอินด้วยบัญชีทดสอบ และถ่ายภาพ 1440/390 ไทย/อังกฤษ → เก็บใน `design/figcraft/handoff/comparison-20261029/render-live/` (ภาพไม่ commit, commit รายงาน+สคริปต์)
- ทดสอบพฤติกรรมจริงที่ผู้ใช้เจอ: ลากวาง kanban, เมนูข้าง, อัปโหลดรูปสินค้า, ส่งออก CSV, สั่งใหม่หลังจ่าย
ปิดเมื่อ: สคริปต์รันผ่านซ้ำได้ + ภาพ/รายงานทุกหน้า

## เฟส B — เทียบแบบ + แก้ช่องว่างหน้าเว็บ (ใช้เฟส A)
ตามชุด: DS20–27 (POS), DS28–30 (Pay/โต๊ะ), DS31–33 (Platform; ตัดสิน PL01/PL11 ว่าแก้แอปหรือแบบ), DS34 (shared states/ธีม/ภาษา) → แก้ MAJOR → ติ๊กช่อง "actual render" เมื่อมีภาพ
ช่องงานสร้างที่ขาดของ POS (ทำคู่กัน): DS21 (ลบสินค้า/ตัวเลือก), DS22 (ต้นทุน/หน่วย/ซัพพลายเออร์ = ต้อง migration + UI), DS24, DS25 (เครื่องพิมพ์/เวลาสาขารายสาขา)

## เฟส C — แอปมือถือบน AVD (Android emulator)
build APK ลูกค้า/ไรเดอร์ → ติดตั้งเครื่องจำลอง → รันเส้นทาง: เมนู→ตะกร้า→คูปอง→สั่งล่วงหน้า→จ่าย (devnet) / แลกแต้ม / ร้านปิด / สถานะ shared → ถ่ายภาพเทียบ FigCraft U/R → ปิดช่อง UI ของ DS03–DS19, DS41–DS52 ที่เกี่ยวกับมือถือ
ต้องมี fixture API 3043 + ไม่ใช้ผู้ให้บริการภายนอก

## เฟส D — งานสร้างที่ยังขาด (ทำในเครื่องได้)
1. ฝั่งร้าน: หน้าสร้างคูปอง + เปิด/ปิดช่วงเวลาสั่งล่วงหน้า (ตอนนี้เดโมไม่ได้) — DS41/DS42
2. DS42: ลูกค้ายกเลิกออเดอร์ล่วงหน้าที่จ่ายแล้ว + ตัวรับเหตุการณ์ `SCHEDULE_DUE` ส่งครัว/จัดส่ง
3. DS43: ทดสอบ process death/upload expiry/retention; DS44: เพิกถอน wallet/device consent + คิว export/delete
4. DS45: ข้อมูลร้านรายสาขา/เอกสาร/เขตบริการ (เขตบริการต้องมีแหล่งข้อมูล)
5. DS46–DS48: เวลารอ/no-show/requote ของรถ, escalation + audit การเข้าถึง
6. DS35–DS37, DS39–DS40: เทส recovery ผ่าน UI, no-driver/withdrawal, สรุปรายการ HTTP+หน้าจอ, คืนเงิน late/second-payment
7. DS53: รายงาน net/ค่าธรรมเนียม/เวลาเตรียม ที่เหลือ; DS51/DS52: แบตช์/แนะนำ/แคมเปญ AI แบบร่างให้เจ้าของตรวจ (ไม่ใช้ template อ้างเป็นโมเดลจริง)
8. DS49: ชำระหลายร้าน (ใหญ่สุด ทำท้าย)
ทุกข้อ: เทสต์ DB 0 ข้าม + เส้นทาง + หน้าจอ + บันทึกหลักฐาน

## เฟส E — คุณภาพและส่งมอบ (DS55–DS58)
- DS55: accessibility/large-text/offline บน AVD, iOS = ตรวจเท่าที่ทำได้ (ไม่มี Xcode device) ที่เหลือ BLOCKED
- DS56: observability ที่ยังขาด (หน่วยวัด/log ที่ปิดความลับ/rate-limit abuse), ซ้อมกู้พร้อมตารางออเดอร์/การชำระ (ใส่ข้อมูลทดสอบก่อนสำรอง), แก้ worker "Attempt reconciliation unavailable" + ปิดออเดอร์เก่าที่ค้าง 4 ใบด้วยการตรวจ devnet
- DS57/58: รันอาหารครบเส้นทาง + ผู้โดยสาร บน AVD, อัปเดตรายงานส่งมอบ, ตรวจ README/JUDGE_GUIDE ไม่อ้างเกินจริง

## เฟส F — merge/ปิดงาน
ทุกเฟสจบด้วย: เทสต์ผ่าน, commit เฉพาะไฟล์ของตัวเอง, deploy (api/worker/web) พร้อมสำรอง DB เมื่อมี migration, ตรวจ OCI, บันทึก CHECKPOINT; ปลายทาง merge PR #2

## งานที่เป็นของเจ้าของ/ผู้ให้บริการ (BLOCKED — บันทึกเหตุผลไว้ ไม่ปลอมผล)
แผนที่/ETA, โทรปิดเบอร์, push/SMS จริง, PromptPay, NFT/ระดับสมาชิก, เงินสด POS (ขอเลื่อน), อุปกรณ์ iOS จริง, ฟอร์มส่งงาน/วิดีโอ/สิทธิ์ (SUBMISSION_CHECKLIST 9 ข้อ)

## ลำดับและงานขนาน
A → (B ∥ C ∥ D1–D3) → D4–D8 → E → F
ห้ามชน: B แตะ apps/web; C แตะ apps/mobile-*, packages/mobile_shared; D แตะ apps/api, apps/worker, migrations — D ใช้เลข migration ต่อจาก 173 โดยจองเลขล่วงหน้า (D=174–180) กันซ้ำ
