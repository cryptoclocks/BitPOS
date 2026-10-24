# W01: local fixture ที่เริ่มใหม่ได้ —21 ตุลาคม2026

เป็น test harness ที่แยกจาก actual-use OCI และ OMP ไม่ใช่ staging stack หรือการ deploy. ไม่อ่าน .env/credentials ของระบบจริง ไม่เปิด worker/ซื้อบริการ/ส่ง SMS/ทำธุรกรรม. Local runtime admission ไม่ใช่การรับรองทุกฟีเจอร์ว่าเสร็จ.

## คำสั่ง

จาก root BitPOS (ต้องมี pnpm, Node และ PostgreSQL17 ของ Homebrew):

```sh
pnpm fixture:up
```

รัน foreground จนขึ้น `W01_FOREGROUND_STARTED` หลัง APIตอบจริง. อีก Terminal ใช้:

```sh
pnpm fixture:status
pnpm fixture:doctor
pnpm fixture:verify
pnpm fixture:stop
pnpm fixture:reset
pnpm fixture:up
```

- up: PostgreSQL127.0.0.1:55446 / DB `bitpos_w01_fixture`, synthetic auth55447, API3046. Portถูกใช้แล้วจะปฏิเสธ ไม่หยุดprocessของคนอื่น.
- doctor: ตรวจ manifest inventory/sourceSHA,102applied migrations, actualschema SHAจากpg_dump, candidate absence, current API source fingerprint, generatedTS/DartตรงOpenAPI, actualpubliccatalogHTTP.
- verify: doctor + actual synthetic OTP/login/account/logout/revoked-tokenSQL/API; fixed synthetic accountถูกdisabledและsessionsrevokedหลังทดสอบ. ต้องใช้ fixtureว่างก่อนรอบfoodseed; ไม่ใช่providerOTPจริง.
- stop: ตรวจlivecontrollercommandและส่งTERMเฉพาะownedcontroller; cleanupownedAPIprocessgroup+Postgres. Ctrl+Cที่foregroundทำcleanupเช่นกัน.
- reset: ลบเฉพาะdirectoryที่มีownershipmarkerตรงproject/purpose และcontroller/postmasterหยุดแล้ว; ไม่dropDBจากURLที่ผู้ใช้ส่งมา. ปฏิเสธsymlink. คืนfixtureว่างสำหรับseedของแต่ละjourney.

Private runtime/log/data: `~/.local/share/bitpos-w01-fixture/` นอกrepo; ห้ามcommit/copydata. Existing55440/API3043และweb4324ไม่ถูกควบคุม. หากcrashเหลือlock/postmaster ให้ตรวจPIDจริงก่อนrecovery; harnessไม่ลบlockหรือkillprocessด้วยhistoricalIDอัตโนมัติ.

Android AVDใช้ `http://10.0.2.2:3046`; webใช้server environment `BITPOS_WEB_API_ORIGIN=http://127.0.0.1:3046` ก่อนเริ่มเว็บตามคำสั่งdev/buildปกติ. W01เริ่มDB/auth/API; ไม่เปิดAVD/webแทนsessionของผู้ใช้และไม่รันfoodjourneyแทนW02.

## Schema admission

`tools/runtime/fixture/migrations.json` เป็นexplicit source-hashed manifest แยก local-runtime กับ private candidate อย่างชัดเจน (จำนวนปัจจุบันอ่านจาก `tools/runtime/fixture/migrations.json`; รอบตรวจล่าสุด 102 runtime + 16 candidate รวม 096–098,107–119). ไม่auto-admitไฟล์ใหม่; sourceหรือinventoryเปลี่ยนต้องreviewmanifestใหม่. Appliedsource/effectivehash/overrideเก็บในpublic.bitpos_fixture_migrations; schemafingerprintจับDDL/function/policy/grant drift. DBธุรกิจเริ่มว่าง ไม่มีproductionrecord/merchantwallet/keyถูกคัดลอก.

ข้อยกเว้น029เฉพาะfixtureว่าง: ลบเฉพาะassertionที่ต้องมีhistoricalGemini startsอย่างน้อย3ครั้ง โดยexactmatchและrecordsource/effectivehash. ไม่สร้างusageปลอม ไม่แก้productionmigration ไม่เปลี่ยนreserve/budgetlogic. Freshbootstrapทุกตัวอื่นใช้sourceตรงตัว.

ห้ามใช้ `pnpm db:migrate` แทนfixture:up: general runnerไม่ใช่candidateadmissionworkflow. W01ไม่อนุญาตactual-usemigration. Candidateพร้อมเมื่อผ่านfeature-specificauthority/lifecycle/reviewแล้วเท่านั้น.

## Verification completed

- Fresh fullschema102DDLผ่าน; stop/reset/freshupผ่าน; restartexistingผ่าน.
- schemaเพิ่มdriftprobe → doctorFAIL; ลบprobe → doctorPASS.
- resetขณะcontrollerlive → denied; portconflictไม่kill/restartserviceอื่น.
- generatedcontractscheckPASS; rootTypeScriptPASS; actualHTTPcatalog/OTP/login/account/logout/revokedtokenPASS,SQLorders0/payments0.
- เคยพบdoctorendpointผิด(/food/branches)แก้เป็นactual/branches; pg_dumpdefaultbufferไม่พอแก้bounded32MiB; TIME_WAITbindfalsepositiveแก้SO_REUSEADDR โดยlistenerจริงยังถูกปฏิเสธ. Failuresไม่ถูกนับเป็นpass.

สิ่งที่อยู่นอกW01: businessseed/scenarioordersและfoodE2E(W02), UIparity, provider/networkintegration, finance/coupon/scheduleadmission, externalreleaseและphysicalfieldtests.

### Controller หายแต่บริการยังอยู่

`fixture:status` แสดง `controllerRunning`, actual listener PID และ `orphanedServicesNeedOwnershipReview` แยกกัน จึงไม่สรุปว่าบริการหยุดจาก controller PID ที่หายเพียงอย่างเดียว. หลังแน่ใจว่าไม่มี test ที่กำลังทำงาน ใช้ `python3 tools/runtime/fixture/runtime.py recover-stop` เพื่อตรวจ process/cwd ของ API, auth listener ที่เป็น processเดียวกัน และ PostgreSQL marker/path/port/currentcommand ก่อน graceful stop เฉพาะบริการชุดนี้. ไม่ใช้ historical PID, ไม่ kill OMP, ไม่ restart ขณะ test ยังทำงาน. หาก identity ไม่ตรงจะปฏิเสธก่อนส่ง signal. จากนั้นเริ่ม `fixture:up` ใหม่; reset ไม่จำเป็นเพราะต้องรักษาข้อมูลสำหรับ recovery proof.
