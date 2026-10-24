# การใช้งานรายได้และรอบจ่ายไรเดอร์

สถานะ: source workflow สำหรับทดสอบ local/devnet ไม่ใช่การอนุญาตเปิดโอนเงินจริง ไม่ใช่หลักฐานว่า provider พร้อมใช้งาน การทดสอบเครื่องจริงเว้นตามคำสั่งผู้ใช้

## ไรเดอร์

1. เข้าสู่ระบบแอพไรเดอร์ เปิด Earnings and payouts รายการเป็นภาระรายได้จากงานส่งสำเร็จ ไม่ใช่ยอดเงินในกระเป๋าหรือหลักฐานโอนแล้ว จำนวนรายการที่โหลดไม่ใช่ยอดรวมทั้งประวัติ
2. เปิด Enroll / verify payout destination เลือกร้านจากรายการรายได้ที่โหลด หรือใช้รหัสร้านที่เคยส่งงานให้ รายการร้านอาจไม่ครบทุกหน้า เซิร์ฟเวอร์เป็นผู้ตัดสินสิทธิ์จริง
3. ป้อนเฉพาะ public key ผู้รับบน Solana devnet ห้ามป้อน seed phrase/private key กด Create ownership challenge
4. เลือก beneficiary ที่สร้าง ตรวจปลายทางและเวลาหมดอายุ คัดลอกข้อความตรงทุกไบต์ ให้กระเป๋าที่ถือกุญแจปลายทางลงนามข้อความ แล้ววางลายเซ็น Base58 นี่ไม่ใช่การลงนามธุรกรรมหรือส่งเงิน หากคัดลอกไม่สำเร็จใช้ข้อความแบบ selectable ที่แสดงบนจอ
5. ส่งลายเซ็นให้เซิร์ฟเวอร์ตรวจสอบ VERIFIED ยืนยันเจ้าของปลายทาง ไม่ได้ยืนยันว่ารอบจ่ายอนุมัติหรือโอนสำเร็จ
6. หากคำสั่งค้าง ให้โหลดและ Retry exact saved command ห้ามเปลี่ยน key/ข้อมูลเพื่อสร้างรายการแทน หากเซสชันเดิมยังมีสิทธิ์ ต้องจัดการสิทธิ์เดิมก่อนกู้คำสั่งด้วยเซสชันใหม่

การพักแอพซ่อนข้อมูลปลายทางและลายเซ็นที่กรอก การเปลี่ยนบัญชีปิดข้อมูลของเจ้าของเดิม ผลตอบกลับที่มาช้าต้องไม่คืนข้อมูลเดิม หน้าประวัติโหลดข้อมูลใหม่เมื่อกลับมา

## เจ้าหน้าที่การเงิน

หน้า `/platform/driver-earnings` ใช้บัญชี mobile/platform ของตน ไม่ใช้ cookie หรือสิทธิ์ owner ร้านแทน finance ต้องมี finance/administrator grant และขอบเขตร้านที่มอบหมาย

- โหลดรายการจริง เลือกเฉพาะรายการ AVAILABLE ที่เข้ากันด้านคนขับ สกุล/decimals และ frozen asset policy
- HOLD/RELEASE ต้องระบุเหตุผล PREPARE สร้าง draft เก็บ source IDs และ versions ที่ตรงกัน การอนุมัติสำรองบัญชีไม่ใช่การโอนเงิน
- หากข้อมูลเปลี่ยนให้โหลดใหม่ ห้ามแก้ expectedVersion/source version เพื่อเลี่ยง refusal
- คำสั่งค้างถูกเก็บตามบัญชีและทำ WebLock ห้ามสร้างรายการทดแทนก่อนรู้ผลเดิม

## อ่านสถานะอย่างถูกต้อง

| สถานะ readiness | การดำเนินการ |
|---|---|
| BENEFICIARY_PENDING | ให้เจ้าของพิสูจน์ปลายทางก่อน |
| PROVIDER_UNAVAILABLE | ตรวจการตั้งค่าและสิทธิ์ provider ผ่านขั้นตอนปฏิบัติการที่ได้รับอนุญาต ห้ามแสดงว่าจ่ายแล้ว |
| VERIFIED_FUNDING_REQUIRED | ต้องมีเงินทุนที่ตรวจสอบได้ ยอดเจ้าหนี้ไม่ได้แปลว่ามี liquidity |
| FUNDING_RECONCILIATION_REQUIRED / SOURCE_RECONCILIATION_REQUIRED | กระทบยอดหลักฐานเดิมก่อน ไม่อนุญาตจ่ายซ้ำ |
| AWAITING_SIGNATURE | รอ worker ลงนาม ยังไม่จ่าย |
| READY_FOR_INITIAL_BROADCAST | พร้อมส่งรายการแรก ไม่ใช่หลักฐานสำเร็จ |
| EXACT_REBROADCAST_OR_RECONCILIATION_ONLY | ส่งได้เฉพาะ signed bytes เดิมหรือ reconcile ห้ามสร้าง attempt ใหม่ |
| CLOSED | ปิดรอบอย่างเดียวไม่ใช่หลักฐานโอน ตรวจ receipt/เหตุผลและสถานะจริง |

## เกณฑ์ตรวจรับก่อนเปิด provider

ต้องมีการตรวจ chain/genesis, mint/program, recipient, exact amount, attribution และ successful finalization ฝั่ง server หลักฐาน signature/client callback ไม่พอ Worker ต้องกู้ signed bytes เดิมหลัง restart, รองรับ unknown/late receipt และไม่จ่ายซ้ำ ไม่มี private keys ใน frontend/log/Git

ชุดทดสอบ `driver-settlement-worker`, `driver-settlement-session`, `payout-provider` ผ่าน47ข้อในรอบรับช่วง Codex เป็น unit/adapter fixture เท่านั้น ยังไม่เท่ากับผล API/ฐานข้อมูล/AVD/providerจริงครบ flow ห้ามรัน script committed-smoke ที่อ้าง prior fixture IDs โดยไม่ตรวจสภาพฐานข้อมูลและ cleanup ก่อน

## ผลตรวจรับช่วง Codexล่าสุด

- Native Android own earnings/payout/logout ผ่านจริงกับ loopback API และ persisted SQL: AVAILABLEv2/CANCELLED/0attempts, revoked session/401 และ EN/TH UI ไม่อ้างเงินได้รับ
- Restricted committed worker ในฐานสำเนาทดสอบ lostack/restart/ambiguous exact rebroadcast/concurrent finalization ผ่าน1receipt/1posting และ failure/replacement/late conflicting success fence ผ่าน สำเนาถูกลบหลังจบ
- Chrome1440 direct same-origin4339→3022 finance sign-in/scoped read/logout ผ่าน ไม่มี request interception บัญชี fixtureแรกติด OTP rate limitจึงหยุด ไม่แก้limiter; ใช้ fixtureอีกบัญชีพร้อม explicit temporary finance scope แล้ว restore/deleteในfinally
- หน้าเงินหลักรองรับ zero precision/negative subunitด้วยintegerformatter แต่ผลด้าน format ไม่ใช่การเปิดรองรับสินทรัพย์ใหม่
- ยังไม่ครบ: beneficiary sign-message external wallet actual handoff, full finance mutation browser matrix/current visual check, current independent review และ real provider readiness ไม่ปิดงานจากผลอ่านอย่างเดียว
