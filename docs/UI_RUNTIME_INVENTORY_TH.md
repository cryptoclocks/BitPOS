# ทะเบียน UI เทียบ FigCraft กับ runtime

อัปเดต 2026-10-21 — direct Codex; OMP ยังคงหยุด

รายการนี้อ่านทุกบอร์ดจาก screen-map.json โดยตรง ไม่ใช่เปอร์เซ็นต์งานเสร็จ เส้นทาง source เป็นจุดตรวจที่เกี่ยวข้อง ไม่ยืนยันว่าหน้าหรือพฤติกรรมนั้นทำครบแล้ว บอร์ดรวม foundations/components/states ด้วย จึงห้ามเรียกทั้งหมดว่า 192 หน้าฟีเจอร์สำเร็จ

ทุกบอร์ดยังเปิดการตรวจเทียบภาพล่าสุด การผ่าน build หรือมีไฟล์ไม่เท่ากับผ่าน UI acceptance หลักฐานราย flow ดู DIRECT_IMPLEMENTATION_STATUS.md; ใช้ข้อมูลจริงจาก API หรือแสดงสถานะ unavailable ห้ามคัดลอกคะแนน/ETA/รูป fixture มาอ้างข้อมูลจริง

## จำนวนบอร์ดตาม surface

| Surface | Boards |
|---|---:|
| guide | 2 |
| pay | 22 |
| pay-desktop | 26 |
| pos | 41 |
| rider | 32 |
| states | 16 |
| system | 10 |
| user | 43 |

## ตรวจทีละบอร์ด

| ID | Surface | แบบ | Source ที่ต้องตรวจ | ตรวจภาพล่าสุด |
|---|---|---|---|---|
| A00 | guide | Start here | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D01 | system | Design foundations | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D02 | system | Button / Primary / Default | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D03 | system | Button / Primary / Disabled | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D04 | system | Button / Secondary / Default | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D05 | system | Button / Outline / Default | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D06 | system | Button / Danger / Default | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D07 | system | Search and form fields | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D08 | system | Order status badges | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D09 | system | Food and driver cards | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| D10 | system | Navigation and feedback | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| U01 | user | ทุกมื้อดี ๆ เริ่มที่ BitPOS | `apps/mobile-customer/lib/presentation/customer_welcome.dart` + root `main.dart` | ยังไม่ผ่าน acceptance |
| U02 | user | เข้าสู่ระบบ | `apps/mobile-customer/lib/main.dart` + `presentation/customer_sign_in.dart` | ยังไม่ผ่าน acceptance |
| U03 | user | ยืนยันเบอร์โทรศัพท์ | `apps/mobile-customer/lib/main.dart` + `presentation/customer_sign_in.dart` | ยังไม่ผ่าน acceptance |
| U04 | user | ส่งความอร่อยถึงที่ | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U05 | user | ไม่พลาดทุกขั้นตอน | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U06 | user | วันนี้อยากทานอะไร? | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U07 | user | ค้นหาร้านและเมนู | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U08 | user | ค้นหาในแบบของคุณ | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U09 | user | BitPOS Coffee House | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U10 | user | Iced oat latte | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U11 | user | ตะกร้าของคุณ | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U12 | user | ที่อยู่จัดส่ง | `apps/mobile-customer/lib/delivery_address_picker_page.dart` | route/API/widget + AVD root flow ผ่าน; geometry manually calibrated to SVG, automated pixel diff/Thai capture pending |
| U13 | user | เพิ่มที่อยู่ใหม่ | `apps/mobile-customer/lib/account_page.dart` | Create/edit/archive + U12 refresh/select ผ่านบน Pixel AVD/local fixture; main SVG geometry manually calibrated to ~0–1 logical px |
| U14 | user | ปักหมุดจุดรับอาหาร | `apps/mobile-customer/lib/address_pin_page.dart` | Configurable XYZ map layer + attribution and manual-coordinate fallback implemented; provider not configured, so live tiles/AVD acceptance remain open |
| U15 | user | ตรวจสอบออเดอร์ | `apps/mobile-customer/lib/food_page.dart` | Customer root U11→U15→กลับตะกร้า ผ่าน Pixel AVD/local API; canonical quote/settlement disclosure อยู่เหนือ sticky CTA, card x=24px/สูง82px; ยังไม่ครบ visual acceptance ทุกภาษา/ชนิด delivery และไม่มี automated pixel diff |
| U16 | user | เลือกวิธีชำระเงิน | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U17 | user | กำลังตรวจสอบการชำระ | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U18 | user | ร้านรับออเดอร์แล้ว | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U19 | user | กำลังเตรียมมื้อของคุณ | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U20 | user | อาหารกำลังเดินทาง | `apps/mobile-customer/lib/food_delivery_panel.dart` + `packages/mobile_shared/lib/food_navigation_map.dart` | Pixel AVD assigned-tracking fixture ผ่าน: map 377px, zoom, route/ETA, rider/destination แยก, fixed Orders nav; manual เทียบ FigCraft แล้ว. กริด/route/ETA เป็น synthetic fixture; real map provider, field GPS และ automated pixel diff ยังไม่ผ่าน |
| U21 | user | อิ่มอร่อยได้เลย | `apps/mobile-customer/lib/food_delivery_panel.dart` + `food_review_page.dart` | เมื่อ API ยืนยัน `DELIVERED` จะเปิดหน้า success/review พร้อมยอด canonical, รีวิวที่ผ่าน eligibility API, ใบเสร็จ และ Orders nav; root AVD ผ่าน geometry anchors ภายใน≈1dp (back, success, stars, field, CTAs, nav) และเทียบภาพ FigCraft ด้วยมือ. Focused regression13/13, scoped analyze clean. In-memory review fixture เท่านั้น; tests ไม่ได้ยืนยัน HTTP/SQL; full-page pixel diff ยังไม่ทำ |
| U22 | user | รายละเอียดออเดอร์ | `apps/mobile-customer/lib/food_page.dart` + `configured_food_lines.dart` + `main.dart` | immutable snapshot/fees/address ครบ; root AVD History→detail→back PASS พร้อม single header, sticky tracking และ Orders selected. Compact row/right-aligned money. Customer109/109 PASS. Pickup root ผ่าน actual local HTTP/SQL→AVD→back (canonical270 minor units; cleanup verified). Delivery root ผ่าน canonical390 minor units HTTP/SQL→AVD พร้อม recipient expansion; two-item fixture anchors back/items/address533 ตรงภายใน1dp. Full-page pixel diff ยัง pending; ไม่มีการสั่งซื้อซ้ำ |
| U23 | user | กิจกรรมของคุณ | `apps/mobile-customer/lib/order_history_sheet.dart` + `presentation/customer_order_card.dart` | CustomerSessionPage AVD ผ่าน API/SQL: 3 ออเดอร์ canonical ที่ยัง unpaid, tenant ownership, filter/date/name; native screenshot manually reviewed. Safe-area-normalized filters/card align to measured SVG anchors (card 1dp); Customer109/109, scoped analysis clean. Full-page pixel diff/localization variants remain open |
| U24 | user | ยกเลิกออเดอร์ | `food_page.dart` + `food_cancellation_review_page.dart` + `food_cancellation_review_panel.dart` | เปิดจากรายละเอียดออเดอร์หลังอ่าน shipment ปัจจุบัน; review request ผูก order/shipment/version และ idempotency; terminal state ปิดทางส่ง. FigCraft geometry test 390×844 ผ่าน (x24/w342/h82/gap22/icon44), widget9/9, Customer106/106, scoped analyze clean; native local HTTP/SQL request→staff disposition→history flow ผ่านโดยออเดอร์/ไรเดอร์ยัง activeและไม่คืนเงิน. Root History→detail→U24→explicit reason→request→back AVD PASS (in-memory API); anchors back/first2 cards ภายใน1dp. Send requires explicit selection; no inferred preparation-status copy. ภาพตรวจด้วยมือ; full-page pixel diff ยังเปิด; API นี้ยังไม่ยกเลิกออเดอร์จริง |
| U25 | user | ติดตามการคืนเงิน | `apps/mobile-customer/lib/order_refunds_sheet.dart` | หน้าเต็มตาม FigCraft พร้อมสถานะ obligation แบบไม่อ้างว่าโอนคืน, สรุปออเดอร์, ทางลัดดูออเดอร์/ช่วยเหลือ, ledger แบ่งหน้า และ Customer bottom navigation; AVD fixture ผ่านและเทียบตำแหน่งหลักด้วยมือ (order card y≈491px/CTA y≈626px เทียบต้นแบบ486/622); ไม่มี automated pixel diff และไม่มี refund provider |
| U26 | user | คูปองของคุณ | `packages/mobile_shared/lib/presentation/feature_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| U27 | user | BitPOS Rewards | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U28 | user | ร้านโปรดของคุณ | `apps/mobile-customer/lib/favourites_sheet.dart` + `presentation/favourite_branch_card.dart` | CustomerSessionPage AVD ผ่าน save/list/remove/logout และ HTTP/SQL isolation/idempotency. Search/card top match SVG after safe-area normalization; nav y758/h86 matches. Customer109/109; touched-file analysis clean. Full-page pixel diff remains open; API ไม่มีภาพร้าน/rating/ETA/ค่าส่ง จึงใช้ placeholder ตามจริง |
| U29 | user | คุยกับไรเดอร์ | `packages/mobile_shared/lib/food_chat_page.dart` | Shared chat HTTP/SSE/text/photo/read/logout acceptance ผ่านแยกต่างหาก; Customer root Orders→detail→tracking→chat now passes Pixel AVD geometry. FigCraft anchors for back/header, two 277×78/288×77 message bubbles, grouped timestamp, composer, send and nav align within 1dp. AVD fixture is in-memory; not API/SQL proof. Full-page pixel diff/history-retention/privacy acceptance remains open. Evidence `.omp/work/flutter-delivery-20261016/evidence/customer-u29-root-avd-direct-20261021.json` and `food-chat105-multi-gallery-actual-avd-20261020.json`; physical testing deferred |
| U30 | user | ให้เราช่วยคุณ | `apps/mobile-customer/lib/help_page.dart` | ยังไม่ผ่าน acceptance |
| U31 | user | มื้อนี้เป็นอย่างไรบ้าง? | `apps/mobile-customer/lib/food_review_page.dart` | ยังไม่ผ่าน acceptance |
| U32 | user | ตั้งค่าบัญชี | `apps/mobile-customer/lib/account_page.dart` | ยังไม่ผ่าน acceptance |
| U33 | user | บัญชีของคุณ | `apps/mobile-customer/lib/account_page.dart` | ยังไม่ผ่าน acceptance |
| U34 | user | ความเป็นส่วนตัว | `apps/mobile-customer/lib/account_privacy_page.dart` | ยังไม่ผ่าน acceptance |
| U35 | user | สั่งล่วงหน้า | `packages/mobile_shared/lib/presentation/feature_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด; current native-derived commerce hero/field/card spacing mapped; focused390px geometry + shared responsive suite7/7 PASS. Full-page pixel and backend route acceptance remain open |
| U36 | user | อร่อยด้วยกัน | `packages/mobile_shared/lib/presentation/feature_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด; current native-derived commerce hero/field/card spacing mapped; focused390px geometry + shared responsive suite7/7 PASS. Full-page pixel and backend route acceptance remain open |
| U37 | user | เลือกอร่อยจากหลายร้าน | `packages/mobile_shared/lib/presentation/feature_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด; current native-derived commerce hero/field/card spacing mapped; focused390px geometry + shared responsive suite7/7 PASS. Full-page pixel and backend route acceptance remain open |
| U38 | user | กำลังหาไรเดอร์ให้คุณ | `apps/mobile-customer/lib/food_page.dart` | ยังไม่ผ่าน acceptance |
| U39 | user | เดินทางกับ BitPOS | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| U40 | user | เลือกรถที่เหมาะกับคุณ | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| U41 | user | กำลังหาคนขับ | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| U42 | user | เดินทางอย่างอุ่นใจ | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| U43 | user | ถึงจุดหมายแล้ว | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| R01 | rider | ทุกเส้นทาง มีคุณอยู่ด้วย | `apps/mobile-driver/lib/presentation/driver_welcome.dart` + root `main.dart` | ยังไม่ผ่าน acceptance |
| R02 | rider | เข้าสู่ระบบไรเดอร์ | `apps/mobile-driver/lib/main.dart` | ยังไม่ผ่าน acceptance |
| R03 | rider | ยืนยันตัวตน | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R04 | rider | ข้อมูลรถของคุณ | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R05 | rider | ตรวจสอบเอกสาร | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R06 | rider | พร้อมรับงานวันนี้ | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R07 | rider | งานใหม่ใกล้คุณ | `apps/mobile-driver/lib/food_work_page.dart` + `presentation/driver_food_offer_card.dart` | Fresh actual FoodWorkPage AVD→local API→SQL SAFETY refusalผ่าน1command/0assignment/lease; final screenshot reviewed;23widget regressionsผ่าน; live map/full-page pixel parityยังเปิด |
| R08 | rider | รายละเอียดงาน | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R09 | rider | เดินทางไปรับอาหาร | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R10 | rider | ถึงร้านแล้ว | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R11 | rider | ยืนยันรับอาหาร | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R12 | rider | กำลังนำส่งอาหาร | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R13 | rider | ยืนยันส่งอาหาร | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R14 | rider | ส่งสำเร็จ ขอบคุณครับ | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R15 | rider | ประวัติการรับงาน | `apps/mobile-driver/lib/food_history_page.dart` | ยังไม่ผ่าน acceptance |
| R16 | rider | รายได้ของคุณ | `apps/mobile-driver/lib/earnings_page.dart` | ยังไม่ผ่าน acceptance |
| R17 | rider | รอบโอนเงิน | `apps/mobile-driver/lib/earnings_page.dart` | ยังไม่ผ่าน acceptance |
| R18 | rider | รายละเอียดรอบโอน | `apps/mobile-driver/lib/earnings_page.dart` | ยังไม่ผ่าน acceptance |
| R19 | rider | คุยกับลูกค้า | `packages/mobile_shared/lib/food_chat_page.dart` | Rider assignment→chat root passes AVD geometry with in-memory work/chat fixture. Compact Rider navigation matches 62dp FigCraft bar with all labels visible; two bubbles align at x24/y246/277×78 and x78/y354/288×76, within1dp of reference. Actual chat HTTP/SSE/text/image/two-photo/read/logout and SQL binding evidence is separate. Full-page pixel diff, real API-backed root route, privacy/retention audit remain open. Evidence `.omp/work/flutter-delivery-20261016/evidence/rider-r19-root-chat-avd-direct-20261021.json` and `food-chat105-multi-gallery-actual-avd-20261020.json`; physical testing deferred |
| R20 | rider | ศูนย์ช่วยเหลือไรเดอร์ | `apps/mobile-driver/lib/help_safety_page.dart` | ยังไม่ผ่าน acceptance |
| R21 | rider | ความปลอดภัยระหว่างงาน | `apps/mobile-driver/lib/help_safety_page.dart` | ยังไม่ผ่าน acceptance |
| R22 | rider | บัญชีไรเดอร์ | `apps/mobile-driver/lib/main.dart` | ยังไม่ผ่าน acceptance |
| R23 | rider | ตำแหน่งขณะรับงาน | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R24 | rider | พักรับงาน | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R25 | rider | ส่งอาหารไม่สำเร็จ | `apps/mobile-driver/lib/food_work_page.dart` | Postpickup Cannot deliver shortcut→explicit CUSTODY report→restricted retained duty ผ่าน actual AVD/API/SQL; widget/realtime24PASS. ยังไม่ใช่ terminalFAILED/return/refund completion หรือ FigCraft fullpage parity |
| R26 | rider | ขอเปลี่ยนผู้รับงาน | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R32 | rider | ยืนยันเบอร์โทรศัพท์ | `apps/mobile-driver/lib/food_work_page.dart` | ยังไม่ผ่าน acceptance |
| R27 | rider | งานรับส่งผู้โดยสาร | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| R28 | rider | ถึงจุดรับผู้โดยสาร | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| R29 | rider | ยืนยันก่อนเริ่มเดินทาง | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| R30 | rider | กำลังเดินทาง | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| R31 | rider | จบเที่ยวเดินทาง | `packages/mobile_shared/lib/presentation/ride_ui.dart` | Presentation มีโค้ดแล้ว; opt-in native UI catalog/AVD render PASS; TH/EN320/390 text150% + loading/empty/error/offline ผ่าน. ไม่มี backend effects. Exact FigCraft parity และ production route join ยังเปิด |
| P01 | pos | ภาพรวมร้าน | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P02 | pos | หน้าขาย | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P03 | pos | บิลขาย | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P04 | pos | รายละเอียดบิล | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P05 | pos | ปิดรอบการขาย | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P06 | pos | สินค้าและเมนู | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P07 | pos | แก้ไขสินค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P08 | pos | คลังสินค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P09 | pos | รับเข้าสินค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P10 | pos | ประวัติรับเข้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P11 | pos | ปรับปรุงสต็อก | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P12 | pos | สินค้าใกล้หมด | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P13 | pos | ความเคลื่อนไหวสินค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P14 | pos | รายงานประจำวัน | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P15 | pos | รายงานการขาย | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P16 | pos | รายงานรับเข้าสินค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P17 | pos | รายงานตามช่วงเวลา | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P18 | pos | วิเคราะห์ยอดขาย | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P19 | pos | สินค้าขายดี | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P20 | pos | ส่งออกข้อมูล | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P21 | pos | ซัพพลายเออร์ | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P22 | pos | ลูกค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P23 | pos | โปรไฟล์ลูกค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P24 | pos | หมวดสินค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P25 | pos | ผู้ใช้งานและสิทธิ์ | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P26 | pos | ประวัติการใช้งาน | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P27 | pos | เครื่องพิมพ์ใบเสร็จ | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P28 | pos | ตั้งค่าร้าน | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P29 | pos | ศูนย์ออเดอร์ | `apps/web/src/components/IncomingOrders.tsx` | ยังไม่ผ่าน acceptance |
| P30 | pos | คิวครัว | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P31 | pos | ออเดอร์จากแอพ | `apps/web/src/components/Pos.tsx` + `IncomingOrders.tsx` | Scoped component browser TH/EN1440/390/320: acceptance deadline disables both actions; EXPIRED/RECOVERY/invalid deadline/busy/pending block commands. Synthetic component only; full visual/API/SQL route acceptance remains open |
| P32 | pos | จัดส่งและไรเดอร์ | `apps/web/src/pages/platform/food-dispatch.astro` | ยังไม่ผ่าน acceptance |
| P33 | pos | โปรโมชัน | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P34 | pos | ตรวจร่างแคมเปญ | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P35 | pos | โต๊ะและ BitPOS Mini | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P36 | pos | สาขาและเวลาทำการ | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P37 | pos | การยกเลิกและคืนเงิน | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P38 | pos | ยอดสุทธิและรอบโอน | `apps/web/src/pages/platform/driver-earnings.astro` | ยังไม่ผ่าน acceptance |
| P39 | pos | เข้าสู่ระบบร้านค้า | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P40 | pos | พร้อมส่งมอบให้ไรเดอร์ | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| P41 | pos | ขอคืนเงินบางรายการ | `apps/web/src/components/Pos.tsx` | ยังไม่ผ่าน acceptance |
| W01 | pay | สั่งที่โต๊ะของคุณ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W02 | pay | เมนูของร้าน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W03 | pay | เลือกเครื่องดื่มของคุณ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W04 | pay | รายการที่เลือก | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W05 | pay | ตรวจสอบรายการ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W06 | pay | ชำระเงินอย่างมั่นใจ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W07 | pay | เชื่อมต่อกระเป๋าเงิน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W08 | pay | สแกนเพื่อชำระเงิน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W09 | pay | กำลังตรวจสอบยอดชำระ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W10 | pay | กำลังยืนยันธุรกรรม | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W11 | pay | ชำระเงินสำเร็จ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W12 | pay | ใบเสร็จของคุณ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W13 | pay | อาหารพร้อมรับแล้ว | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W14 | pay | รายการนี้หมดเวลาแล้ว | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W15 | pay | ยังชำระไม่สำเร็จ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W16 | pay | กำลังตรวจสอบรายการ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W17 | pay | สถานะการคืนเงิน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W18 | pay | การเชื่อมต่อขาดหาย | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W19 | pay | ตรวจสอบและชำระเงิน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W20 | pay | เข้าร่วมโต๊ะ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W21 | pay | ช่วยเหลือเรื่องรายการนี้ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| W22 | pay | คูปองสำหรับรายการนี้ | `apps/web/src/components/CouponSelection.tsx` | Presentation มีโค้ดแล้ว; dev UI catalog. Browser320/390/1440 selection/disabled/no-overflow PASS; รูปมือถือ/desktop ตรวจด้วยมือ. ไม่เชื่อม coupon API/checkout; exact visual acceptance เปิด |
| S01 | states | ตะกร้ายังว่าง | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S02 | states | ยังไม่พบร้านที่ค้นหา | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S03 | states | การเชื่อมต่อขาดหาย | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S04 | states | ยังไม่ได้เปิดตำแหน่ง | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S05 | states | ตำแหน่งไม่ได้อัปเดต | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S06 | states | ร้านปิดรับออเดอร์แล้ว | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S07 | states | ราคามีการเปลี่ยนแปลง | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S08 | states | กำลังตรวจสถานะรายการเดิม | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S09 | states | บางรายการหมดชั่วคราว | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S10 | states | ยังไม่มีไรเดอร์รับงาน | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S13 | states | Dark mode / วันนี้อยากทานอะไร? | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S14 | states | Dark mode / พร้อมรับงานวันนี้ | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| E01 | states | English / วันนี้อยากทานอะไร? | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| E02 | states | English / ศูนย์ออเดอร์ | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S11 | states | POS mobile adaptation | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| S12 | states | POS mobile adaptation | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |
| WD01 | pay-desktop | ตรวจสอบและชำระเงิน | `apps/web/src/components/Payment.tsx` + `styles/customer-checkout.css` + generated metrics | Actual canonical quote/order→built Astro Payment/API/SQLผ่าน1440/390/320; x96/872 widths744/472ผ่าน; full asset label/quoted amount/details checked; no wallet signing/attempt; full-page parity/provider paymentยังเปิด |
| WD02 | pay-desktop | เมนูของร้านบนคอมพิวเตอร์ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD03 | pay-desktop | เชื่อมต่อกระเป๋าเงิน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD04 | pay-desktop | สินทรัพย์ที่ร้านรองรับ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD05 | pay-desktop | ตรวจคำขอเลือกสินทรัพย์เดิม | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD06 | pay-desktop | อนุมัติในกระเป๋าเงิน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD07 | pay-desktop | กำลังส่งการชำระ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD08 | pay-desktop | รอการยืนยันจากเครือข่าย | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD09 | pay-desktop | ชำระเงินสำเร็จ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD10 | pay-desktop | ใบเสร็จและหลักฐาน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD11 | pay-desktop | บิลหมดเวลา | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD12 | pay-desktop | รายการต้องตรวจสอบ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD13 | pay-desktop | การเชื่อมต่อขาดหาย | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD14 | pay-desktop | กลับมาตรวจรายการเดิม | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD15 | pay-desktop | ความยินยอมและบัญชีลูกค้า | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD16 | pay-desktop | อาหารพร้อมรับ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD17 | pay-desktop | PromptPay - Planned | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD18 | pay-desktop | ติดตามการคืนเงิน | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD19 | pay-desktop | กำลังโหลดบิล | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD20 | pay-desktop | การชำระยังไม่สำเร็จ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD21 | pay-desktop | ชำระ exact USDC ผ่าน x402 V2 | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD22 | pay-desktop | บัญชีที่ผูกกับร้านนี้ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD23 | pay-desktop | เลือกตัวเลือกเมนู | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD24 | pay-desktop | ตรวจสอบตะกร้า | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD25 | pay-desktop | ยืนยันโต๊ะของคุณ | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| WD26 | pay-desktop | เสร็จแล้วและกลับเมนู | `apps/web/src/components/Payment.tsx` | ยังไม่ผ่าน acceptance |
| A01 | guide | Developer handoff | — ต้องระบุ implementation | ยังไม่ผ่าน acceptance |

## ลำดับเก็บงาน

1. Customer: root navigation และหน้าหลัก/ร้าน/สินค้า/ตะกร้า/checkout; ตามด้วยร้านโปรด/support/reviews ที่มี API แล้ว เทียบ geometry ภาษาไทย/อังกฤษและข้อความยาว
2. Rider: onboarding/งาน/รับส่ง/หลักฐาน/รายได้/ความปลอดภัย พร้อม owner-loss และ offline states
3. POS และ Pay: ตรวจ Desktop/Mobile แยกทุก composition; รักษาฟีเจอร์ POS เดิมและสิทธิ์ server
4. คูปอง/chat/privacy/scheduling/group/multi-merchant/passenger: implement business lifecycle กับ UI ให้ครบ ห้ามวางหน้าสวยแล้วระบุว่าใช้งานได้
5. ชุดภาพและ E2E ล่าสุด พร้อม independent review; ลบภาพ scratch หลังวิเคราะห์และคงเฉพาะหลักฐานจำเป็น

## หลักฐานเฉพาะชุด Customer ล่าสุด — 2026-10-20

U11/U15, U12/U13, U23, U28 และ U31 มีการปรับ runtime ล่าสุด; ชุดทดสอบ Customer ล่าสุดผ่าน 98/98 และ analyzer ที่แตะมีเพียง style infos เดิม รายละเอียดอยู่ DIRECT_IMPLEMENTATION_STATUS.md ส่วน U31 เพิ่มทดสอบการเลื่อนและส่งรีวิวบน viewport 390×844 แล้ว U11/U15 มี actual-root Pixel AVD receipt ปัจจุบัน `evidence/food-cart-review-root-avd-20261020.json` พร้อมภาพทั้งสองสถานะ; U15 วัด item card 82px, body/settlement/footer และระยะ CTA แล้วเทียบ FigCraft ด้วยมือ ไม่มี automated pixel diff และยังไม่ตรวจครบทุกภาษา/variant/บอร์ด จึงยังไม่ถือว่าผ่าน visual acceptance ทั้งชุด

2026-10-20 — U12 delivery selector now uses a dedicated runtime route, existing account-address API data and branch delivery bounds; focused 2/2 and Customer suite 95/95 pass. Native AVD/FigCraft pixel acceptance remains open; see `evidence/customer-u12-address-picker-20261020.json`.

2026-10-20 — U12 actual AVD route/back/revisit/select-root navigation passes against local disposable API and two account-scoped addresses; no order/payment effects. Settled frame inspected against SVG after spacing/icon/back-control calibration. Primary geometry is within approximately1–6 logical pixels, but this is manual review (no automated pixel diff) and native strings are English vs Thai SVG. Native receipt `evidence/customer-u12-address-picker-root-avd-20261020.json` and screenshot `evidence/customer-u12-address-picker-root-avd-20261020.png`; full Customer suite after final spacing adjustment passes95/95.


2026-10-20 — Native U12 add-address CTA now traverses Account overview→My addresses→saved API mutation→return to U12 refreshed list, then selects the new coordinate-backed address. No order/payment effects; fixture disabled/revoked. Full Customer96/96, picker3/3. This earlier note is superseded by the 2026-10-20 U12/U13 native roundtrip entry below; U14 provider/UI acceptance remains open.


- 2026-10-20 — U12/U13 native address roundtrip extended: on Pixel AVD and disposable local API/database, create a coordinate-backed address, edit its label, archive Office, return to U12, refresh, and select both updated/new and Home. SQL confirms 3 scoped records, 2 active, 0 orders/payments; fixture session revoked and account disabled. AVD receipt/frame: `evidence/customer-u12-address-picker-root-avd-20261020.json` and `.png`. Customer Flutter suite 96/96; scoped analyzer has no errors/warnings (7 style-level brace infos in `food_page.dart`); format and diff-check pass. U14 map is still incomplete; no external tile provider/physical GPS was used, and AVD evidence is not pixel-diff certification. OMP remains stopped; full P0–P6 active.


- 2026-10-20 — U13 form reconstructed against `U13-address-edit.svg`: four inputs and the map/save actions now align to the design grid; visual measurement of the native frame is within about 0–1 logical px for the main field/button positions (manual comparison, no automated pixel diff; native labels are English while SVG labels are Thai). U14 is now a real route with truthful unavailable-map presentation plus validated manual coordinates returned to U13; no map art is presented as live data. Pixel AVD roundtrip creates, edits, archives and reselects an address; SQL asserts persisted contact, instructions and exact coordinates, 3 address rows/2 active, 0 orders/payments. Receipt `evidence/customer-u12-address-picker-root-avd-20261020.json`; frames `customer-u13-address-edit-root-avd-20261020.png` and `customer-u14-address-pin-unavailable-root-avd-20261020.png`. Customer Flutter suite 96/96, changed-file analyzer clean except 7 pre-existing style infos in `food_page.dart`, AVD integration PASS, diff-check pending after docs. Real map provider/config is still missing, so U14 map is incomplete; no physical GPS/provider test, deployment, or production mutation. OMP remains stopped; full P0–P6 goal active.
