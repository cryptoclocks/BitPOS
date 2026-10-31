# 08 · Judge packet, provenance และ Devpost

> ส่วนหนึ่งของ [แผน implement](../IMPLEMENTATION_PLAN_TH.md) · ทำหลังซอฟต์แวร์ผ่าน hard gates เท่านั้น · ทุกการเผยแพร่ (push, YouTube, Devpost) ต้องได้รับอนุญาต ณ เวลาที่ทำ

## 1. `paypal-hackathon/JUDGES.md` (อังกฤษ) — โครง

1. **What this is** (3 บรรทัด): owner intent → bounded AI agent → approved offer on the table screen → customer pays with PayPal Sandbox → server-verified capture → outcome with evidence
2. **Try it in 5 minutes**
   - Merchant: `https://paypal-pos.cashlessthailand.com` → "Demo sign-in (BitPOS PayPal Café)"
   - Open *Promotions → Café Copilot*, type the example intent, review, approve, choose *Terminal table 2*
   - Customer: open the terminal link (or scan its QR) → add the offer → *Pay with PayPal* → sign in with the sandbox buyer (credentials in Devpost testing instructions, or any PayPal sandbox personal account you own)
   - Back on merchant: *Outcome* → *Evidence*
3. **What is new for this hackathon** (ตารางชี้ไฟล์: `apps/api/src/paypal/*`, migrations `400–405`, components `paypal/*`, worker, tests)
4. **What already existed** (POS, table QR ordering, promotion approval + device delivery, Solana devnet payments, BitPOS Mini firmware) และ import จาก h2
5. **How payment proof works** (ย่อ 01 §5–§8)
6. **How the agent is bounded** (ย่อ 03 §1, §3, §4)
7. **Tests and evidence** (จำนวน test, ลิงก์ `evidence/`, test IDs ที่รันบน sandbox จริง)
8. **Limits** (sandbox only, USD only, one product per campaign, ไม่มี live, Mini optional, AI free tier)
9. **Run it yourself** (ขั้นตอน local จาก 06 §1 + env example)

## 2. Devpost — ช่องที่ต้องแก้ (submission 1259502)

| ช่อง | ตอนนี้ | แก้เป็น |
|---|---|---|
| Tagline | "A proposed AI-assisted commerce workflow…" | ประโยคที่บอกว่าทำงานแล้ว (หลัง gate) |
| Story | ระบุว่าเป็นแผน / ยังไม่ integrate | Inspiration, What it does, How we built it (PayPal Orders v2 + JS SDK v6 + webhooks + Gemini tools), Challenges, Accomplishments, What's next, Provenance (ของเดิม vs ใหม่) |
| Built with | Node.js ฯลฯ | + PayPal Orders API, PayPal JS SDK v6, PayPal Webhooks, Gemini, PostgreSQL, Astro, React, ESP32-S3 |
| Try it out / hosted URL | `pos.cashlessthailand.com` + ป้าย "NOT PAYPAL" | `paypal-pos.` + `paypal-pay.` |
| Testing instructions | ขั้นตอนของ baseline | ย่อ JUDGES §2 + sandbox buyer (ถ้าช่องนี้เห็นเฉพาะกรรมการ — **ตรวจก่อน** ถ้าเป็น public ให้บอกให้ใช้บัญชี sandbox ของกรรมการเองแทน) |
| Video | `CpH5YrbKWWs` (vision) | วิดีโอใหม่ ≤ 3 นาที |
| Gallery | FigCraft 14 ภาพ (concept) | screenshot จริง 6–8 ภาพ + คง concept บางภาพพร้อมป้าย |
| Sponsor tools | None | เลือกตามที่ใช้จริงเท่านั้น |
| Code | branch URL เดิม | เดิม (ตรวจว่า README ด้านบนเป็นส่วน PayPal) |

## 3. วิดีโอ (≤ 2:50) — โครงจากของจริง

| เวลา | ภาพ | เสียงบรรยาย (อังกฤษ) |
|---|---|---|
| 0:00–0:15 | ร้าน + ตู้ครัวซองต์ที่เหลือ | ปัญหา: ของเหลือท้ายวัน ร้านไม่มีเวลาทำโปร |
| 0:15–0:50 | Copilot: พิมพ์ intent → steps → ร่าง | agent ใช้ tools อ่านสต็อก/ยอดขาย/ขอบเขต, server ตรวจราคา |
| 0:50–1:10 | แก้ + approve + เลือกจอ | owner เป็นคนอนุมัติ ไม่มี auto-publish |
| 1:10–1:40 | Mini/terminal แสดงโปร → มือถือสแกน → PayPal popup → จ่าย | ลูกค้าอนุมัติใน PayPal |
| 1:40–2:00 | จอ paid + เสียง, บิล, stock ลด | server capture + verify ก่อนแจ้ง paid |
| 2:00–2:25 | Outcome + Evidence + replay webhook ไม่นับซ้ำ | ตรวจย้อนได้ทุกขั้น |
| 2:25–2:50 | สรุป + ของใหม่ vs ของเดิม + ลิงก์ | provenance |
ใส่ป้าย "PayPal Sandbox" บนจอทุกฉากที่มีเงิน, ใช้ข้อมูล fixture ที่ระบุว่าเป็นตัวอย่าง

## 4. PROVENANCE — ตารางที่ต้องมี

| Date | Commit | Files | What | Shared with other entries? |
|---|---|---|---|---|
| (ทุก commit ของ PayPal) | | | | |

พร้อม:
- baseline tag + `git diff --stat paypal-hackathon-baseline..paypal-hackathon-submission`
- รายการไฟล์เดิมที่แก้ทุกไฟล์ (คาดไว้: `apps/api/src/index.ts`, `apps/api/src/order-closure.ts`, `apps/api/src/orders.ts` (releaseReservation hook), `apps/web/src/components/Payment.tsx`, `apps/web/src/components/Promotions.tsx`, `apps/worker/src/index.ts`, `README.md`)
- การ import จาก h2 (commit เดียว, sha ต้นทาง, เหตุผล)
- AI ที่ใช้ช่วยพัฒนา (Claude Code / Codex) แยกจาก AI ในผลิตภัณฑ์ (Gemini)
- เนื้อหาที่เป็น fixture/concept

## 5. Checklist ก่อนกด Save ใน Devpost

- [ ] ทุกคำว่า "working / verified / real" มีหลักฐานใน `evidence/`
- [ ] ไม่มีข้อความเก่าที่บอกว่ายังไม่ integrate
- [ ] ลิงก์ทุกอันเปิดได้จาก browser ที่ไม่ได้ login
- [ ] วิดีโอ Public, ≤ 3 นาที, มีคำบรรยาย
- [ ] ข้อมูล sandbox buyer ไม่อยู่ในช่องสาธารณะ (ถ้าไม่แน่ใจ ไม่ใส่)
- [ ] Save แล้วเปิดหน้า project ใหม่ตรวจทุกช่อง
