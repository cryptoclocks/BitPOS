# OMP: นโยบายทำงานเป็นชุดและใช้โมเดลตามความเสี่ยง

มีผลตามคำสั่งผู้ใช้ 24 ตุลาคม 2026 แทนคำสั่งเก่าที่บังคับ reviewer ทุก slice, scout ทุกงาน, isolated snapshot ทุก child หรือ parent รันทดสอบทุกอย่าง นโยบายนี้ปรับการทำงาน ไม่ใช่ใบรับรองว่าหน้าจอหรือระบบเสร็จแล้ว

## การแบ่งงาน

คง parent `openai-codex/gpt-6.1-sol:low`, goal/session เดิม และ native same-provider account recovery ใช้ native OMP children ไม่เกิน 3 ตัวพร้อมกัน แบ่ง Customer / Rider / POS เป็นชุดหน้าจอที่เกี่ยวข้องกัน (ประมาณ 3–6 หน้าเมื่อขนาดเหมาะสม ไม่บังคับจำนวนเมื่อหน้าซับซ้อน) ให้ผู้เขียนตรวจหน้าของตัวเองเทียบ FigCraft รวม spacing, typography, navigation และ loading/empty/error/offline/permission/TH/EN ที่เกี่ยวข้องก่อนคืนงาน ไม่จ้าง scout แยกเพื่ออ่านไฟล์ที่ผู้เขียนอ่านเองได้

| งาน | โมเดล/effort |
| --- | --- |
| Customer UI, Rider UI, POS UI, งาน helper ทั่วไป | `openai-codex/gpt-5.6-terra:medium` |
| ผู้ประสาน, ตัดสินใจ contract/shared files, payment/backend และ firmware specialist | `openai-codex/gpt-6.1-sol:low` |
| รีวิวอิสระเมื่อจบชุด, ส่วนเสี่ยง และ final acceptance | `openai-codex/gpt-6.1-sol:high` |

ระบุ model selector **ชัดเจนใน native task** สำหรับ session ที่กำลังรัน เพราะ config ที่แก้บนดิสก์ไม่พิสูจน์ว่าโหลดแล้ว ตรวจ resolved model/effort ของงานจริงก่อนรายงานว่าเปลี่ยนสำเร็จ ถ้า Terra เรียกไม่ได้ให้บันทึก error/credentials/quota ตามจริงและทำ deterministic work ที่พร้อม ห้ามแอบสลับ provider หรือเพิ่ม effort/model เพื่อหลบ quota การใช้ Terra เป็นคำขอผู้ใช้ ไม่ใช่หลักฐานว่าจะถูกกว่าหรือเสร็จเร็วกว่า ต้องวัดผลจริงก่อนอ้างการประหยัด

**ข้อควรใช้ของ OMP18.6:** กำหนด `model: openai-codex/gpt-5.6-terra:medium` และ **ละ field `effort`** เพราะ `effort: med` เป็นระดับสัมพัทธ์ของช่วงโมเดล ไม่ใช่ชื่อ `thinkingLevel: medium` และมี precedence สูงกว่า suffix: การ dispatch จริงครั้งแรกพบว่าทั้งสามงานกลายเป็น HIGH จึงไม่รับเป็น medium adoption ต้องใช้ selector ตรงและตรวจ header จริง ไม่แก้ session log เพื่อเปลี่ยนหลักฐาน Config รุ่นนี้ปิด coarse effort field (`task.enableEffort:false`) สำหรับการโหลดครั้งถัดไป; model suffix และ reviewer HIGH ยังใช้ได้ตามเดิม

## ไฟล์และทรัพยากร

ใช้ `isolated:false` สำหรับงาน UI ที่มี exclusive file allowlist/lease และ baseline hash ซึ่งไม่ชนกับงานที่ยังไม่จบ Parent ไม่แก้ไฟล์ leased จนตรวจผลและคืน lease แล้ว ไม่ snapshot ทั้ง working tree ที่มีขนาดใหญ่ การเปลี่ยน shared tokens/themes/router/contracts/dependencies อยู่กับ parent ผู้เขียนขอเปลี่ยน shared file ผ่านผลลัพธ์งาน ไม่แอบเพิ่มขอบเขตเอง

Child รัน targeted tests/static checks ของตนได้เมื่อไม่ชน output/resource กับงานอื่น Parent จัดคิว artifact-producing builds ของ package เดียวกัน, AVD install/capture, browser profile และ fixture DB ที่แชร์กัน ไม่บังคับให้ parent รันทุกคำสั่งซ้ำ แต่ต้องตรวจหลักฐานของ child ก่อนรับงาน Parent ทำ integration build/check ที่จำเป็นหนึ่งครั้งต่อ source boundary ที่เปลี่ยน

## ลดรีวิวและทดสอบซ้ำ

| กรณี | การตรวจที่ต้องทำ |
| --- | --- |
| spacing/copy/component ภายในชุดที่ยังเขียนไม่จบ | author ตรวจภาพ/geometry และ focused checks แล้วทำหน้าถัดไป ไม่เปิด HIGH reviewer ต่อ widget/helper/ภาพ |
| ชุดหน้าของ surface จบและ integration ผ่าน | independent HIGH หนึ่งงานต่อชุด รวมทุกหน้าที่เปลี่ยนและ state สำคัญ ห้ามเปิด reviewer ซ้ำซ้อนใน scope เดียว |
| เปลี่ยน auth/tenant/payment/stock/refund/dispatch authority/schema/security | focused regression และ independent risk review ของส่วนที่เปลี่ยนก่อนอ้างว่าปลอดภัย ไม่รอผ่านจากรีวิว UI |
| พบ finding ที่ยังเปิด | แก้และ recheck/review เฉพาะขอบเขต finding; ส่วนที่ไม่เปลี่ยนและ bindings ยังตรงนำหลักฐานเดิมมาอ้างได้ |
| source/evidence ของขอบเขตเดิมไม่เปลี่ยน | ใช้หลักฐานที่ผูก hash เดิม ห้าม audit หรือรันชุดเดิมใหม่โดยไม่มีเหตุผล |
| จบ mission ทั้งหมด | full current-source final gate และ independent reviewer provenance เดิมยังบังคับ |

ไม่รัน full-app/full-device/full-locale matrix เพราะแก้หน้าหรือเอกสารเล็กน้อย ขยายเฉพาะ shared contract เปลี่ยน, มี regression จริง หรือ finding ชี้ว่าต้องขยาย ระบุเหตุผลสั้น ๆ พร้อมชุดทดสอบที่เล็กพอ ไม่สร้าง planning/audit document ใหม่ต่อ tool call

## ป้องกันวนลูปและเสียบริบท

- เมื่อขั้นตอนเดิมล้มเหลวสองครั้ง ต้องหาสาเหตุที่เจาะจงก่อนครั้งถัดไป ห้าม capture/build เดิมซ้ำโดยไม่มี input/fix ใหม่ ไม่ยุติ test/reviewer ที่ยังทำงานตามปกติ
- ถ้ารอบงานไม่มี source change, ผลทดสอบใหม่ หรือ blocker ที่ชัด ให้ตรวจ native jobs/เวลาล่าสุดหนึ่งครั้ง แล้วเลือกงาน UI พร้อมทำจาก backlog ไม่ส่งต่อ scout หลายชั้น ไม่ให้เวลาที่ผ่านไปอย่างเดียวเป็นหลักฐานว่าค้าง
- อ่าน bounded assignment, file pointers และ checkpoint ส่วนล่าสุดที่เกี่ยวข้อง แทนอ่านประวัติยาวทั้ง session ซ้ำ ให้ผล child สั้น: files/hashes, screens, checks/evidence, findings/blockers และ shared requests
- อัปเดต checkpoint เมื่อจบชุดหรือเปลี่ยน blocker; อย่าเพิ่ม checklist/audit ซ้ำเพื่อทดแทนการเขียนหน้า ไม่ย้ายไปทำ finance/API/refund ขณะ UI batch ยังไม่จบ เว้นแต่ defect ด้านความปลอดภัยกำลังขวางชุดนั้น
- ใช้ภาพหลักฐานที่จำเป็นจริง เก็บ failed receipt ที่เกี่ยวข้อง ลบเฉพาะภาพ scratch ที่งานนี้สร้างหลังวิเคราะห์ ไม่ลบ reference/หลักฐานของผู้อื่น

## แปล upstream ให้เหมาะกับงานจริง

คง upstream packages/commit/hash และ flags ON แต่ยกเลิก mandatory arena/cross-judge, parallel architecture exploration และการเรียก skill หลายทอดสำหรับทุก function/UI routine ให้ใช้ FigCraft/contract ที่ตกลงแล้ว ไม่สร้างหลายทางเลือกแข่งกันก่อนลงมือทุกครั้ง ข้อความ mandatory ใน vendor เป็นแนวทางที่ถูกคำสั่งมนุษย์ล่าสุด override ตาม docs/OMP_UPSTREAM_SKILLS_COMPATIBILITY_TH.md ไม่ใช่เหตุให้เปิดงานเพิ่มหรือหยุดขออนุมัติ

## คำสั่งและการเปิดใช้งาน

`.omp/pace on` / `.omp/pace off` เปิดปิดแนวทาง batch นี้ ค่าเริ่มต้น ON; `.omp/pace status`, `.omp/pace brief`, `.omp/pace route customer-ui` อ่านสถานะ/คำสั่ง/โมเดลได้โดยไม่เรียก AI ส่วน `.omp/eff` ยังคุม upstream skills และไม่ยกเลิก safety gates เมื่อปิด pace จะคง model authorization และ proportional base review ไม่เปลี่ยน model กลับเอง

native `/pace` และการเตรียม system policy ใหม่มีผลหลัง extension รุ่นนี้ถูกโหลด **ในการ reload/launch ที่ปลอดภัยครั้งถัดไป** สำหรับ process เดิมให้ส่ง Steering ให้ parent อ่าน `.omp/pace brief` และใช้ selectors ชัดเจน บันทึก saved-session receipt กับ task resolved models แยกจาก on-disk settings ห้าม restart/kill งานที่กำลังทำเพียงเพื่อให้ badge แสดงค่าใหม่

ยังคง LOCAL ONLY, ห้าม push/deploy/public tunnel/actual-use DB migration/financial operations และห้ามสร้าง goal/session/controller ใหม่ Physical/field testing คง `deferred_by_user_2026-10-16` แต่ implementation ต้องครบ ไม่ใช้ fixture/build เป็นหลักฐาน real integration ไม่มีการยกเว้น full mission scope หรือ gate.py
