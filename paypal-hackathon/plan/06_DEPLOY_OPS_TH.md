# 06 · Local dev, deploy และดูแลช่วง judging

> ส่วนหนึ่งของ [แผน implement](../IMPLEMENTATION_PLAN_TH.md) · คำสั่งด้านล่างเป็นแผน ยังไม่ได้รัน · ทุกขั้นที่แตะ OCI, Cloudflare, PayPal dashboard หรือ push ต้องยืนยันกับผู้ใช้ ณ เวลาที่ทำ

## 1. เครื่อง local

```bash
cd ~/Desktop/BitPOS-PayPal-2026
pnpm install
pnpm fixture:up          # Postgres disposable ของโปรเจกต์ (ถ้า fixture เสีย ให้ fixture:reset ก่อน; ห้ามใช้ DB จริง)
pnpm db:migrate          # 001–176 + 400+
psql "$DATABASE_URL" -f tools/paypal/seed-paypal-cafe.sql
set -a; . ~/.bitpos-paypal/paypal-sandbox.env; set +a
pnpm dev:api & pnpm dev:worker & pnpm dev:web
```
- webhook ในเครื่อง: ใช้ simulator + offline verify เท่านั้น (ไม่เปิด tunnel สาธารณะจากเครื่อง) → webhook จริงทดสอบหลัง deploy
- Gemini ในเครื่อง: ไม่ตั้ง `BITPOS_AI_API_KEY` = ใช้ stub/rules baseline; ตั้งเฉพาะตอน acceptance

## 2. Env private (ไม่ commit) — `~/.bitpos-paypal/paypal-sandbox.env`

```
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_MERCHANT_ID=
PAYPAL_WEBHOOK_ID=
BITPOS_PAYPAL_PUBLIC_URL=https://paypal-pay.cashlessthailand.com
```
ไฟล์ที่ commit: `paypal-hackathon/paypal.env.example` มีชื่อตัวแปรเดียวกัน ค่าว่างทั้งหมด

## 3. Deploy OCI (หลัง 5 พ.ย. 09:00 ไทย)

ข้อมูลจาก session Meta (31 ต.ค., ใช้เครื่อง OCI เดียวกัน): host/key อยู่ในเครื่องผู้ใช้นอก repo (ไม่เขียนลงเอกสารนี้)
- DB จริงตัวเดียว: container `bitpos-staging-db-1` (BitPOS Supabase stack เดียว ห้ามสร้าง stack ที่สอง)
- Backup ก่อน migration ทุกครั้งด้วย `python3 tools/runtime/backup-bitpos-db.py` **รันจาก `~/Desktop/BitPOS`** (script นี้ไม่ได้อยู่ใน branch PayPal โดยตั้งใจ); apply ใน transaction เดียว + `SET lock_timeout='5s'` + บันทึกชื่อใน `public.bitpos_migrations`
- เลขที่ใช้แล้ว: 0xx/1xx (ถึง 176), 3xx (Meta ถึง 327) → PayPal ใช้ 4xx (ยังว่าง)
- พอร์ต 127.0.0.1 ที่ใช้แล้ว: 3001, 3011, 3102, 4100, 4321, 4323–4325, 4331, 8644, 18080–18783 → PayPal ใช้ **3103** bind 127.0.0.1 เท่านั้น
- container แยก compose project `bitpos-paypal`; deploy แบบ tar ที่ไม่มี `.env`/key → สลับโฟลเดอร์ src แบบ atomic → health check → rollback อัตโนมัติถ้าไม่ผ่าน (เขียน script ของ PayPal เอง ไม่คัดลอกไฟล์ Meta); ห้ามแตะ `bitpos-runtime-*`, `bitpos-meta-*`, `ccp-*`
- Cloudflare: เพิ่ม hostname ใหม่ใน tunnel เดิมเท่านั้น ผู้ใช้ต้องอนุมัติใน dashboard
- ร้านเดโม: ห้ามแก้ BitPOS Purple Cafe และ Muse Café → ใช้ร้าน PayPal ของตัวเอง (D2)

ก่อนเริ่ม:
- [ ] ยืนยันกับผู้ใช้ว่า Meta ส่งงานแล้ว และตกลงช่วงเวลา deploy
- [ ] อ่าน memory/กติกา shared resource ของ Meta ซ้ำ (route `/meta/` ต้องอยู่ก่อน, ห้าม restart `bitpos-meta`/`bitpos-staging`, ห้าม prune)
- [ ] `df -h` บน OCI; ถ้าเหลือ < 3 GB หยุดและแจ้งผู้ใช้

ขั้นตอน:
1. Backup: `pg_dump --schema=bitpos -Fc` → `/srv/backups/bitpos-pre-paypal-<date>.dump` + ตรวจขนาด/`pg_restore --list`
2. คัด source ของ branch ขึ้น `/srv/bitpos-paypal/src` (rsync จาก tag ที่ build ผ่าน; ไม่ copy `.env`)
3. Migrations: รันเฉพาะไฟล์ 400+ ผ่าน `tools/runtime/migrate.ts` (ตรวจว่า script ข้ามไฟล์ที่ apply แล้ว) แล้ว `SELECT` ตรวจตาราง `paypal_*`
4. Seed ร้านเดโม
5. Compose project `bitpos-paypal`: service `api` (+ worker ใน container เดียวกันหรือแยก) image `bitpos-runtime:current`, mount source read-only, env file private, `127.0.0.1:3103:3000`, restart `unless-stopped`, mem limit 512m
6. Cloudflare tunnel: เพิ่ม ingress `paypal-pay.cashlessthailand.com` และ `paypal-pos.cashlessthailand.com` → `http://127.0.0.1:3103` (หรือพอร์ต merchant/customer proxy ตามโครง h2) **ต่อท้าย** ก่อน catch-all; ไม่ย้าย route เดิม; DNS CNAME ผ่าน `cloudflared tunnel route dns`
7. ตรวจ: `curl -sI https://paypal-pay.cashlessthailand.com/` 200, `/paypal/webhooks` POST ว่าง → 400; `meta-pay.` และ `pay.` ยัง 200
8. ลงทะเบียน webhook ใน PayPal dashboard (01 §8) → ใส่ `PAYPAL_WEBHOOK_ID` → restart **เฉพาะ** `bitpos-paypal`
9. S-07 webhook จริง

Rollback:
- โค้ด: `docker compose -p bitpos-paypal down` (เฉพาะ project นี้) แล้วกลับ tag ก่อนหน้า
- DB: migrations 400+ เป็น additive; ถ้าต้องถอนให้ปิด `paypal_merchant_settings.enabled` และ `DROP TRIGGER paypal_block_solana_attempt` (ตัวเดียวที่แตะตารางเดิม) — ไม่ restore ทั้ง schema เพราะจะทับข้อมูล Meta/Solana
- Tunnel: ลบ 2 ingress ที่เพิ่ม

## 4. Monitoring ช่วงส่งงานและ judging (ถึง 15 ธ.ค. 23:00)

| สิ่งที่ดู | วิธี | ความถี่ |
|---|---|---|
| เดโมเปิดได้ + จ่ายได้ | `tools/paypal/judge-check.ts` (ไม่จ่ายเงินจริง แค่ create order แล้วไม่ approve) | ทุกวันถึง 15 ธ.ค. (ตั้ง scheduled task ถ้าผู้ใช้อนุญาต) |
| checkout ค้าง UNKNOWN/PENDING > 1 ชม. | query + alert ใน log | ทุกวัน |
| inbox ที่ fail | `last_error IS NOT NULL` | ทุกวัน |
| sandbox credentials | ห้ามหมุน secret ระหว่าง judging ถ้าไม่จำเป็น | — |
| stock ร้านเดโม | `tools/paypal/reset-demo.sql` เติม stock/จบ campaign เก่า (ไม่ลบ ledger) | ก่อน 2 ธ.ค. และทุกสัปดาห์ |
| ดิสก์ OCI | `df -h` | ทุกสัปดาห์ |

## 5. Git และ push

- commit เล็กๆ ตาม phase บน `hackathon/paypal-2026` ข้อความอังกฤษ ลงท้ายด้วย Co-Authored-By ตาม attribution
- ก่อน push ทุกครั้ง: secret scan, ตรวจว่าไม่มีไฟล์ที่ D7 ห้าม, ขออนุญาตผู้ใช้
- ห้าม merge `dev/*`, ห้าม merge history ของ h2, ห้ามแตะ `hackathon/meta-2026`
- tag `paypal-hackathon-submission` ตอนส่ง (Phase 10) และไม่ force-push หลัง deadline
