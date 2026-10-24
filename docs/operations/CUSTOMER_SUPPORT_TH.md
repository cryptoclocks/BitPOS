# ศูนย์ช่วยเหลือลูกค้า — implementation093/094

Customer: บัญชี → ศูนย์ช่วยเหลือ → หมวด U30 → คำร้อง/ข้อความ หรือรายละเอียดออเดอร์ → ขอความช่วยเหลือออเดอร์นี้ (แนบ merchantId/orderId จาก server order snapshot; server ตรวจเจ้าของซ้ำ)

Staff: `/platform/support` มี Desktop สองคอลัมน์ และ Mobile รายการ/บทสนทนาแยกมุมมอง รองรับไทย/อังกฤษ เข้าสู่ระบบด้วย mobile staff identity แยกจาก merchant session ปกติ ไม่ขยายสิทธิ์พนักงานร้านโดยอัตโนมัติ

## สิทธิ์และสถานะ

- ออเดอร์ร้าน: ต้องมี live platform role support/dispatcher/administrator พร้อม exact merchant scope ตาม081
- เรื่องทั่วไป: ต้องมี live support/administrator grant และ explicit `platform_support_general_grants` เพิ่มเติม ขอบเขตทั่วไปไม่ให้สิทธิ์เปิดเรื่องของร้านอื่น
- ทุก list/read/action ของ staff มี access purpose/action reason และบันทึก actor/session/grant การตอบ/เปลี่ยนสถานะมี immutable command receipt/audit ไม่เปิด raw tables ให้ app role
- OPEN → WAITING_CUSTOMER / RESOLVED; RESOLVED ต้อง REOPEN ก่อนส่งข้อความเพิ่ม ลูกค้าส่งข้อมูลกลับขณะ WAITING_CUSTOMER แล้วกลับ OPEN
- ทุกข้อความเพิ่ม case version; staff ต้องส่ง expectedVersion ปัจจุบัน ป้องกันปิดเรื่องจาก snapshot ที่ไม่เห็นข้อความใหม่
- คำร้อง/ข้อความลูกค้าผูกบัญชีด้วย RLS และ linked order ownership trigger; staff author ไม่ปลอมผ่าน customer POST หรือ restricted direct INSERT
- การรับเรื่อง/ปิดคำร้องไม่แก้ payment, refund, delivery, earnings หรือสถานะอาหาร

## การส่งซ้ำและ recovery

Customer บันทึกคำสั่งใน secure storage แยก account ก่อนส่ง ขาด response/formatผิดเก็บ UUID/body เดิมเพื่อกู้คืน ข้อความยาวสุด4000 หัวข้อ160; สร้างได้20คำร้อง/24ชั่วโมงและ500ข้อความ/คำร้อง

Web staff บันทึก command ใน account-scoped localStorage (มีข้อความร่าง/เหตุผล แต่ไม่มี access token) ใช้ browser Web Locks ป้องกันคำสั่งชนข้ามแท็บ คำสั่งยังไม่ทราบผลต้อง replay UUID/body เดิมก่อนสร้างใหม่ การตอบกลับผิด case หรือ logout ระหว่างรอไม่ลบ recovery; terminal VERSION_CONFLICT/INVALID_REQUEST ที่ server ปฏิเสธแน่นอนจึงปลด journal ให้โหลดใหม่ ข้อความที่ยืนยันผลแล้วถูกลบจาก journal

List เป็น keyset50รายการเรียง created_at/id; cursorต้องอยู่ใน owner/case/queue เดิม ไม่อนุญาต cursorข้ามบัญชี UI โหลดข้อความผ่าน refresh ไม่มี live-agent SLA, push หรือ attachment ที่ยังไม่ได้ implement

## หลักฐาน local

- support093-http-direct-20261019.json:12 concurrent create/message replay, isolation, chronology, invalid/unknown cursor, revoked session
- support094-sql-direct-20261019.json และ support094-sql-applied-direct-20261019.json: actual restricted role, explicit general/merchant scope, forged author, stale versions, replay, close, revoke; rollback fixture facts
- support094-http-direct-20261019.json:8 concurrent staff repliesหนึ่งeffect, state workflow/customer-visible reply/revoked grant
- support094-avd-direct-20261019.json: actual Android Help → create → real HTTP staff reply → follow-up → logout/private route removal;2finalcaptures
- support094-browser-direct-20261019.json: actual Chrome same-origin4340→3040 login/read/reply/resolve/logout, SQL one reply,1440/390 layouts;2finalcaptures
- journal tests: web3/customer2; mounted Help/Support owner/order-context and existing Account tests แยกผลใน checkpoint

ภาพทั้ง4เป็นหลักฐานที่เลือกเก็บ ไม่ใช่ scratch ไม่มีการส่งข้อความถึงบุคคลจริงหรือส่งเงิน Fixture audit/command/case ของ flowเจ้าหน้าที่คงไว้ตาม FK/immutability; synthetic accounts disabled และ sessions/grants revoked เมื่อ runnerจบ

## งานที่ยังเปิด

Migration093/094 ติดตั้งเฉพาะ disposable local DB55436 ไม่ได้ใช้กับ actual-use OCI ไม่มีการ deploy/push การตั้งสิทธิ์จริงยังเป็น operations task ที่ต้องอนุญาตตามขอบเขตเดิม

U30 มี Help geometry ตาม source แต่ global bottom navigation ของทุก route และ pixel acceptance ของ192boardsยังไม่ครบ Order-entry source เพิ่มหลัง native receiptล่าสุดและมี widget context proofแยก ไม่ใช่ native owned-order acceptance ทุกกรณี ยังต้อง current independent review, paging/load/accessibility acceptance และส่วน P3–P6 ที่ค้างในแผนหลัก (coupon/scheduling/chat/review/privacy/ride/advanced marketplace) Physical/field testing deferred_by_user_2026-10-16 ขณะที่ implementationยังเป็นข้อกำหนด
