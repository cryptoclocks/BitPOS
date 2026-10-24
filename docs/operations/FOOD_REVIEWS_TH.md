# รีวิวจากออเดอร์อาหาร —095

Customer: รายละเอียดออเดอร์ → ให้คะแนนมื้อนี้; เมนูร้าน → อ่านรีวิวจากลูกค้า
Staff: `/platform/reviews` → ร้านในขอบเขตสิทธิ์ → เหตุผลเข้าถึง → เลือกรีวิว → เผยแพร่/ไม่เผยแพร่ พร้อมเหตุผล

## Authority

Serverตรวจเจ้าของ online order, PAID, ร้านACCEPTED และ fulfillment COLLECTED สำหรับ delivery ต้องมี shipment DELIVERED และ assignment DELIVERED/closed ด้วย Clientไม่ส่งหลักฐานสถานะหรือระบุ driverIdเอง driverStarsใช้ได้เฉพาะไรเดอร์ที่ serverยืนยันจากงานส่งของออเดอร์นั้น

หนึ่งรีวิวต่อ merchant/order; คะแนน1–5 ข้อความไม่เกิน2000ตัวอักษร ไม่บังคับข้อความหรือคะแนนไรเดอร์ ไม่มีคะแนนเริ่มต้นที่ส่งให้อัตโนมัติ

SUBMIT → PENDING; เจ้าหน้าที่ที่มี exact merchant scopeตาม081จึง PUBLISH/REJECT ได้ เจ้าของที่มี staff role ก็ห้ามตรวจรีวิวของตัวเอง ทุกคำสั่งมี UUID/hash/version/sessionและ immutable receipt การอ่านคิวมี access purpose/audit แยก รายการไม่เผย accountId/driverId ต่อสาธารณะ

แก้ไขรีวิวที่เคยเผยแพร่แล้ว → PENDING และเอาคะแนนเดิมออกจาก public aggregateทันที การปฏิเสธมี feedbackให้เจ้าของอ่านได้ ลูกค้าถอนรีวิวได้ → WITHDRAWN, current bodyว่าง และไม่ถูกนับคะแนนสาธารณะอีก ทั้งนี้ไม่ใช่การลบประวัติ audit/commandตาม privacy retention (ยังต้องพัฒนาส่วน retention/eraseตามแผนหลัก)

Public branch review projectionตรวจร้านเปิดให้บริการและคืนเฉพาะ PUBLISHED พร้อมcount/starTotalจำนวนเต็ม และ keyset50รายการ Frontendคำนวณคะแนนเฉลี่ยด้วย BigInt ไม่สร้างrating/ผู้รีวิวตัวอย่างใน runtime ไม่ใช้ pending/rejected/withdrawnในการแสดงคะแนน

## Recovery

Customer secure-storage journalแยกaccountก่อนส่ง, exact command replayข้ามการปิดเปิดแอพ ห้ามแทนคำสั่งที่ยังไม่ทราบผล Web staffใช้ account-scoped journal + WebLocks และตรวจreceipt id/decision; tokenไม่ถูกเก็บในjournal

Lock timeout/deadlockเป็น retryable DISPATCH_AUTH_RETRY ทั้ง reviewและsupport APIs เพื่อไม่ลบjournalที่ยังรอผล ตรงกันข้าม VERSION_CONFLICT/INVALID_REQUESTที่ปฏิเสธแน่นอนปลดjournalให้โหลดข้อมูลใหม่ก่อนสั่งอีกครั้ง

## หลักฐานและขอบเขต

095ติดตั้งเฉพาะ disposable local55436/API3040 ไม่ใช่ actual-use OCI

- reviews095-sql-direct-20261019.json: candidate rollback lifecycle, owner/negative eligibility/forged-driver/anonymous projection/moderation/replay/withdraw/revoke
- reviews095-http-direct-20261019.json: actual8-way submit/publish replay, held-row retryable409และretry UUIDเดิมสำเร็จ, no-scope403/foreign404, edit/reject/withdraw/publiccount/scoreและrevocation
- reviews095-browser-direct-20261019.json: actualChrome4340→3040 OTP/scope/queue/publish/reject/logout, publicaggregateตรง,1440/390 no horizontaloverflow;2finalimages inspected
- customer review journal2tests, widget3tests; staff moderation journal2tests; support retry regressionรวม4tests

Androidรอบแรก initial route waitล้มเหลว; หลัง SafeArea launcherแก้แล้ว actual nativeผ่าน submit→HTTPstaffpublish→public4stars/count1→withdraw→logout (reviews095-avd-direct-20261019.json) รอบล่าสุด10182ผ่าน U31 geometryและ unchanged-review guardด้วย สองภาพสุดท้ายตรวจแล้ว ต่อมาปรับเฉพาะสี back/fieldเป็นขาวตามsource ยังต้องตรวจภาพรอบรวม Native sourceใช้U31เป็นreference แต่ globalbottomnav/fullpixelcomparisonและfullFoodPageentryยังเปิดอยู่

Synthetic staff/grants/sessionsถูกถอนสิทธิ์เมื่อrunnerจบ; reviewfixtureจบด้วยWITHDRAWNผ่านcustomerAPI และเก็บimmutableaudit ไม่มีactual-useข้อมูลหรือธุรกรรมเงิน Screenshotเก็บ4ภาพหลักฐานสุดท้าย มี1ภาพdiagnosticใน/tmpซึ่งตรวจและลบแล้ว

ยังเปิด: current independent review, field/device testing deferred_by_user_2026-10-16, rider rating aggregate/profile, attachments/report abuse/retentionตามfullscope และส่วนcoupon/scheduling/chat/privacy/ride/advancedmarketplaceในแผนหลัก ไม่ถือว่า095เป็นการปิดP3หรือทั้งplatform
