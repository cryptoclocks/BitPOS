# Meta Global Hackathon 2026 — BitPOS × Muse

โฟลเดอร์ทำงานเฉพาะของงานแข่ง Meta (26 ต.ค. – 4 พ.ย. 2026) · ส่งงาน **4 พ.ย. 21:00 ET = 5 พ.ย. 09:00 เวลาไทย** (เป้าส่ง 4 พ.ย. 21:00 ICT)

- Worktree: `~/Desktop/BitPOS-Meta-2026` → branch `hackathon/meta-2026`
- Baseline ก่อนงาน: tag `meta-hackathon-baseline` = `9eb34ea` (push 24 ต.ค.)
- งานในโฟลเดอร์ `~/Desktop/BitPOS` เดิม (branch `codex/bitpos-demo-20261008`) **ไม่เกี่ยว** กับงานนี้

| ไฟล์ | อ่านเมื่อ |
|---|---|
| [PLAN_TH.md](PLAN_TH.md) | แผนหลัก: positioning, ไฟล์, ตาราง 9 วัน, การตัดสินใจที่ค้าง |
| [REVIEW_TH.md](REVIEW_TH.md) | รีวิวแผน 5 modules แรก (ประวัติ — แผนปัจจุบันอยู่ใน PLAN_TH) |
| [DEMO_SCRIPT_TH.md](DEMO_SCRIPT_TH.md) | วิดีโอ 3 นาทีแบบ shot-by-shot |
| [PROVENANCE.md](PROVENANCE.md) | สำหรับกรรมการ: อะไรใหม่ อะไรเก่า (อัปเดตทุกครั้งที่ commit) |
| [meta-ai.env.example](meta-ai.env.example) | ตัวแปร provider |
| [evidence/](evidence/) | ผลเทสต์/หลักฐานรายวัน |

## คำสั่งที่ใช้บ่อย

```bash
npx tsx --test tests/meta-*.test.ts
```

```bash
pnpm typecheck
```

```bash
git diff --stat meta-hackathon-baseline..HEAD
```

## กติกาของโฟลเดอร์นี้
1. โค้ดใหม่อยู่ใน path ที่มีคำว่า `meta` เท่านั้น และขึ้นต้นไฟล์ด้วย `Meta hackathon work (2026-10-26..11-04)`
2. แก้ไฟล์เก่าเมื่อจำเป็นจริง และลงตารางใน `PROVENANCE.md` ทุกครั้ง
3. migration ใหม่ใช้เลข `300–399`
4. ห้าม merge `codex/bitpos-h2-local-scope-20261027` หรือ `dev/*` เข้า branch นี้
5. ห้าม commit secret / key / ข้อมูลร้านจริง; ตรวจ history ก่อน push ทุกครั้ง
