# Runbook: สำรอง กู้คืน และย้อนกลับ BitPOS (WP6b / DS56)

สถานะ: ซ้อมจริง 2026-10-29 บน Postgres 17 ชั่วคราว (พอร์ต 55661, ลบทิ้งแล้ว) ไม่แตะ OCI, ฐาน fixture 55440 หรือข้อมูล actual-use ตัวเลขด้านล่างมาจากการรันนั้น ส่วนที่ทำบน OCI จริงเป็นขั้นตอนที่มีใน repo และ checkpoint เดิม ยังไม่ได้ซ้อมซ้ำในรอบนี้

## 1. สิ่งที่ต้องมี
- Postgres client 17: `/opt/homebrew/opt/postgresql@17/bin` (pg_dump, pg_restore, psql)
- ตั้ง `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` ก่อน `initdb` (ไม่งั้น locale error)
- unix socket path ต้องสั้นกว่า 103 byte: ใช้ `-k /tmp/<short>` แทน data dir ลึก ๆ
- ห้ามเก็บ dump ใน repo; dump มีข้อมูลร้าน/ลูกค้า ให้เก็บใน `local/private/db-backups` (โหมด 700/600, ถูก ignore)

## 2. ใช้ migration กับฐานใหม่ (readiness)
1. สร้างฐานว่างและ role `bitpos_app` (LOGIN) เท่านั้น; ไม่ต้องมี anon/authenticated/service_role
2. รัน `supabase/migrations/*.sql` ตามเลขลำดับ ทีละไฟล์ด้วย `psql -1 -v ON_ERROR_STOP=1 -d <db> -f <file>`
   - ต้องใช้ `-1` (ทรานแซกชันเดียวต่อไฟล์): บางไฟล์ใช้ `SET LOCAL search_path` (เช่น 160) ซึ่งไม่มีผลถ้าไม่อยู่ในทรานแซกชัน และจะล้มด้วย `ride_fare_rates does not exist`
3. ฐานใหม่เปล่าจะล้มที่ `029_coffee_copilot.sql` โดยตั้งใจ (guard: ต้องมี `ai_generation_jobs` ที่ `attempts>0` และ origin Gemini อย่างน้อย 3 แถว) ใน drill ใส่แถวสังเคราะห์ 3 แถวใต้ merchant ชื่อ `drill-synthetic` ก่อนรัน 029 ห้ามทำแบบนี้กับฐานจริง
4. ผล: 165 ไฟล์ผ่านครบ ได้ 269 ตารางใน schema `bitpos`, 494 ฟังก์ชัน, 510 index, 351 trigger

## 3. สำรอง (backup)
ฐานจริงบน OCI: `tools/runtime/backup-bitpos-db.py` (ตั้ง `BITPOS_OCI_SSH_KEY`, `BITPOS_OCI_SSH_TARGET`) รัน `pg_dump --schema=bitpos --format=custom` ใน container db, ตรวจรายการด้วย `pg_restore --list`, เก็บ `local/private/db-backups/bitpos-<stamp>.dump` โหมด 600 และ sha256 ในไฟล์หลักฐาน

คำสั่งที่ใช้ใน drill:
```
pg_dump -h 127.0.0.1 -p 55661 -U postgres --format=custom -f drill.dump drill_src
shasum -a 256 drill.dump
pg_restore -l drill.dump | grep -c "TABLE DATA"
```
ผล: ไฟล์ 2.26 MB, 0.25 วินาที, 269 TABLE DATA entries (ข้อมูลเทียม 2,000 customers + 200 products + แถวที่ migration ใส่)

## 4. กู้คืน (restore) และเทียบผล
```
createdb drill_restore
pg_restore -h ... -U postgres --exit-on-error --no-owner -d drill_restore drill.dump
```
ผล: exit 0, ใช้เวลา 0.95 วินาที จากนั้นเทียบทุกตาราง (269) ด้วย `count(*)` และ `md5(string_agg(md5(row::text) ORDER BY md5(row::text)))` ทั้งสองฐาน: ผลต่างศูนย์ (diff ว่าง), จำนวนฟังก์ชัน/index/trigger เท่ากัน (494/510/351) ตารางที่มีข้อมูล: customers 2000, products 200, payment_assets 2, ai_free_requests 3, ai_generation_jobs 3, merchants 1, merchant_payment_assets 1, ride_fare_rates 1; ตารางอื่น 0 แถวเท่ากัน
ข้อจำกัด: ตารางปฏิบัติการ (orders, payments, outbox) ว่างใน drill จึงยังไม่ได้พิสูจน์ checksum ของแถวเหล่านั้น ให้ทำซ้ำเทียบหลังกู้คืนฐานจริงก่อนอ้างว่ากู้ได้

## 5. ย้อนข้อมูล (data rollback) บนฐานที่กู้แล้ว
จำลองความเสียหาย: `DELETE FROM products` (เหลือ 0) แล้ว `pg_restore --clean --if-exists --exit-on-error --no-owner -d drill_restore drill.dump` ได้ products กลับ 200 และ checksum ทั้ง 269 ตารางตรงกับต้นทาง ก่อนทำกับฐานจริง: หยุด api/worker (`docker compose -f infra/oci/compose.yaml stop api worker web`) เพื่อไม่ให้มีการเขียนระหว่างกู้ และทำ backup ใหม่ก่อนทับเสมอ

## 6. ย้อนกลับ web/api image ด้วย rollback tag
`infra/oci/compose.yaml` ใช้ image `bitpos-runtime:current` ทุกบริการแอป (api, worker, web) ธรรมเนียมที่ใช้จริงใน CHECKPOINT (deploy #9, #10):
1. ก่อน deploy: `docker tag bitpos-runtime:current bitpos-runtime:rollback-YYYYMMDDx` (x = a, b, c… ต่อวัน) และสำรองไฟล์ที่จะถูกทับไว้ที่ `/home/ubuntu/bitpos-runtime.rollbackN-YYYYMMDD`
2. ทำ dry-run diff ของไฟล์ที่จะซิงก์ก่อน เพื่อดูว่ามีเฉพาะไฟล์ที่ตั้งใจ
3. deploy ด้วย `docker compose -f infra/oci/compose.yaml up -d --no-build <service>` เฉพาะบริการที่เปลี่ยน (เช่น `web`) อย่า recreate customer/merchant/tunnel/`bitpos-meta-meta-1`
4. ย้อนกลับ: `docker tag bitpos-runtime:rollback-YYYYMMDDx bitpos-runtime:current` แล้ว `docker compose -f infra/oci/compose.yaml up -d --no-build --force-recreate web` (เพิ่ม api/worker ถ้าเปลี่ยนด้วย); ถ้าไฟล์ถูกซิงก์ทับ ให้คืนจากโฟลเดอร์ rollback ด้วย
5. ตรวจหลังย้อน: `https://pos.cashlessthailand.com/` 200, `/api/returns` ไม่มี session 401, บน host `127.0.0.1:4321/platform` 200
Migration ย้อนไม่ได้ด้วย image: ใช้หลักเดียวกับหัวไฟล์ 029 คือ เก็บข้อมูล ปิด route/admission แล้วออก migration ใหม่ไปข้างหน้า หรือกู้จาก backup (หัวข้อ 4-5)

## 7. no-deploy (ไม่แตะระบบจริง)
repo ไม่มี flag ชื่อ `no-deploy` ในโค้ด; ใช้ข้อกำหนดเหล่านี้แทน:
- ซ้อมทุกอย่างบน cluster ชั่วคราวของตัวเอง (พอร์ตอื่นจาก 55440/55436/4321), ไม่มี `ssh` ไป OCI, ไม่ตั้ง `BITPOS_OCI_SSH_*`
- `docker compose ... up -d --no-build` เท่านั้น (ไม่ build บนเครื่องจริงโดยไม่ตั้งใจ); ใช้ `config` หรือ dry-run diff แทนการ apply เมื่ออยากดูผล
- API ใน drill ผูก `BITPOS_BIND_HOST=127.0.0.1`, `AUTH_URL` ชี้พอร์ตตาย, `DEVNET_PRIVATE_DIR` เป็นโฟลเดอร์ว่าง ไม่มี key/ผู้ให้บริการภายนอก
- ปิดงานด้วย `pg_ctl stop`, ลบ socket dir, ตรวจ `lsof` ว่าพอร์ตว่าง

## 8. Load check เบา
ระบบไม่มี health endpoint; ใน drill เปิด API (`node --import tsx apps/api/src/index.ts`, พอร์ต 3001 ผูก 127.0.0.1) ต่อฐาน drill แล้วยิง `GET /api/menu` ไม่มี session 2,000 ครั้ง concurrency 20: ได้ 401 ครบ ไม่มี error, ~7,900 req/s, p50 1.5 ms, p95 6.9 ms, p99 13.4 ms
ข้อจำกัด: นี่วัดเฉพาะเส้นทางปฏิเสธที่ยังไม่ auth (ไม่ผ่าน SQL หนัก) จึงไม่ใช่ตัวแทน load ของ checkout/payment; ยังไม่ได้ทำ load แบบ authenticated, WebSocket device หรือ worker
