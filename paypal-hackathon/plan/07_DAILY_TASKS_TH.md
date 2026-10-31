# 07 · งานรายวัน (1–12 พ.ย. 2026, เวลาไทย)

> ส่วนหนึ่งของ [แผน implement](../IMPLEMENTATION_PLAN_TH.md) · แต่ละวันมีงาน, commit ที่คาดว่าจะได้, และ gate ตอนจบวัน · ถ้า gate ไม่ผ่าน ห้ามเริ่มงานของวันถัดไปที่พึ่งพามัน · ID ของ test อ้างอิง [05](05_TESTS_TH.md)

## ส. 1 พ.ย. — Phase 0 เตรียมระบบ + spike

| # | งาน | ใช้เวลา | ผู้ทำ |
|---|---|---|---|
| 1.1 | ยืนยัน D1–D7 | 10 นาที | ผู้ใช้ |
| 1.2 | Import POS จาก h2 ที่ commit ที่ระบุ (ไม่รวม `infra/oci/compose.yaml`, ops scripts, `docs/plans`, `.omp` WIP, figcraft ที่ห้าม); secret scan | 1 ชม. | Claude |
| 1.3 | `pnpm install`, `pnpm typecheck`, `pnpm test` บน fixture DB — บันทึก test ที่ fail อยู่ก่อนแล้ว (ไม่แก้ ไม่ลบ) | 1 ชม. | Claude |
| 1.4 | ผู้ใช้วาง Client ID/Secret ลง `~/.bitpos-paypal/paypal-sandbox.env` และบอก sandbox business/buyer ที่ใช้ | 15 นาที | ผู้ใช้ |
| 1.5 | `tools/paypal/sandbox-smoke.ts`: token → create USD 4.50 → พิมพ์ลิงก์ approve → ผู้ใช้กด approve ด้วย buyer → capture → GET | 1.5 ชม. | Claude + ผู้ใช้กด approve |
| 1.6 | S-02, S-03, S-04 (idempotency และชื่อ issue จริง) | 45 นาที | Claude |
| 1.7 | ทดลองหน้า HTML เล็กๆ ใน fixture ด้วย JS SDK v6 (createInstance/findEligibleMethods/session.start) จด network domains | 1 ชม. | Claude |
| 1.8 | บันทึก `evidence/phase0-spike.md` + อัปเดตค่า [spike] ใน 01 | 30 นาที | Claude |

Commits: `Import current POS from codex/bitpos-h2-local-scope-20261027 at <sha>` · `PayPal: provenance, env example and sandbox smoke script`
**Gate:** capture จริงสถานะ `COMPLETED` ที่ตรวจจาก server ได้ ถ้าได้ `PENDING` + `RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION` → แก้ preference/ใช้ US sandbox business ก่อน

## อา. 2 พ.ย. — Phase 1–2 client + ledger

| # | งาน | ใช้เวลา |
|---|---|---|
| 2.1 | `config.ts`, `money.ts` + U-CFG, U-MNY | 1 ชม. |
| 2.2 | `client.ts` (token/create/capture/get) + U-TOK, U-HTTP, U-REQ | 2 ชม. |
| 2.3 | `verify.ts` + U-VER-01..10 | 1 ชม. |
| 2.4 | migrations 400–401 + trigger mutex + D-07..10, D-13 | 2 ชม. |
| 2.5 | อ่าน `settle_verified_attempt` ฉบับล่าสุดทีละบรรทัด, ไล่ `effective_payment_settlement` ทุกจุดที่เรียก | 1 ชม. |
| 2.6 | migration 402 `paypal_settle_capture` + `settle.ts` + D-01..06, D-11, D-14 | 2.5 ชม. |

Commits: `PayPal: sandbox client, exact money and capture verification` · `PayPal: ledger tables, payment mutex and atomic settlement`
**Gate:** D-01..D-14 ผ่าน, `pnpm test` ไม่มี fail ใหม่

## จ. 3 พ.ย. — Phase 3 checkout ลูกค้า

| # | งาน | ใช้เวลา |
|---|---|---|
| 3.1 | `checkout.ts` (create/capture/cancel) + routes ลูกค้าใน `routes.ts` + mount ใน `index.ts` | 2.5 ชม. |
| 3.2 | แก้ `expireUnpaidOrders` (D-12) และ `GET /pay/:token` เพิ่ม payment provider | 1 ชม. |
| 3.3 | `paypal-sdk.ts`, `PayPalCheckout.tsx`, i18n สถานะ, เชื่อมใน `Payment.tsx` | 2.5 ชม. |
| 3.4 | Seed ร้านเดโม + ซ่อน crypto assets ของร้านนี้ | 45 นาที |
| 3.5 | I-01..03, I-07..09 ด้วย stub; S-01 รอบแรกในเครื่อง (ผู้ใช้กด approve) | 1.5 ชม. |

Commit: `PayPal: customer checkout on the pay page with server capture`
**Gate:** S-01 ผ่าน 3 รอบในเครื่อง: QR → order → PayPal → paid → stock ลด

## อ. 4 พ.ย. — Phase 4 webhook + worker (ในเครื่อง; Meta ส่งงานคืนนี้)

| # | งาน | ใช้เวลา |
|---|---|---|
| 4.1 | migration 403 + ฟังก์ชัน inbox + D-WH-01..03 | 1.5 ชม. |
| 4.2 | `webhook.ts` offline verify (+postback สำรอง) + raw body ใน router + U-WH-01..06 | 2.5 ชม. |
| 4.3 | `reconcile.ts` + `apps/worker/src/paypal-reconcile.ts` + I-04..06, I-10..13 | 3 ชม. |
| 4.4 | S-08 webhook simulator ยิงเข้า local ไม่ได้ (ไม่มี URL สาธารณะ) → ทดสอบด้วย payload simulator ที่บันทึกไว้ + cert/key ทดสอบ | 30 นาที |

Commit: `PayPal: verified webhook inbox and reconcile worker`
**Gate:** I-01..I-13 ผ่าน; **ไม่แตะ OCI**

## พ. 5 พ.ย. — Phase 8 deploy (หลัง 09:00)

| # | งาน | ใช้เวลา |
|---|---|---|
| 5.1 | ยืนยันกับผู้ใช้ว่า Meta ส่งแล้ว + ขออนุญาต deploy | — |
| 5.2 | ขั้น 1–7 ของ [06 §3](06_DEPLOY_OPS_TH.md) | 3 ชม. |
| 5.3 | ลงทะเบียน webhook (ขออนุญาตก่อน) + S-07 ×3, S-08, S-10 | 1.5 ชม. |
| 5.4 | H-03, H-04 | 30 นาที |
| 5.5 | เริ่ม Phase 5: migrations 404–405 | 1.5 ชม. |

**Gate:** เดโมที่ host จ่ายได้และ webhook จริงตรวจผ่าน; Meta/Solana ยังทำงาน

## พฤ. 6 พ.ย. — Phase 5 agent

| # | งาน | ใช้เวลา |
|---|---|---|
| 6.1 | `campaign.ts` + `paypal_reserve_campaign_units` + hook ใน `releaseReservation` + D-CMP-01..05 | 2.5 ชม. |
| 6.2 | `agent-tools.ts` + validation codes + intent parser + U-INT-01 | 2 ชม. |
| 6.3 | `agent.ts` loop + U-AG-01..10 | 2.5 ชม. |
| 6.4 | `rules-baseline.ts` | 45 นาที |

Commit: `PayPal: bounded campaign envelope and Gemini tool-calling agent`
**Gate:** U-AG ทั้งหมด + D-CMP ทั้งหมดผ่าน

## ศ. 7 พ.ย. — Phase 5 UI + Phase 6

| # | งาน | ใช้เวลา |
|---|---|---|
| 7.1 | routes owner (`agent/runs`, `campaigns/:id/approve`, outcome, evidence) + I-14 | 1.5 ชม. |
| 7.2 | `CampaignAgent.tsx` (intent, steps, draft, edit, approve, เลือกจอ) | 3 ชม. |
| 7.3 | `outcome.ts`, `CampaignOutcome.tsx`, `EvidenceTrace.tsx` | 2.5 ชม. |
| 7.4 | I-15 ด้วย stub; acceptance Gemini จริง ≤ 6 ครั้งบนเดโมที่ host | 1 ชม. |

Commits: `PayPal: Café Copilot owner screen` · `PayPal: campaign outcome and evidence trace`
**Gate:** agent จริง → approve → จอ → QR → PayPal → outcome ครบบนเดโมที่ host

## ส. 8 พ.ย. — Phase 7 จอ + ตัดสินใจ P1

| # | งาน | ใช้เวลา |
|---|---|---|
| 8.1 | Terminal: โปร + paid USD/PayPal | 1.5 ชม. |
| 8.2 | (P1 — ต้องแก้ firmware ก่อน ดู 04 §5) Mini: branch PayPal ใน `table_settlement()`, build, แฟลช, P-01..03 | 3 ชม. ถ้าเลือกทำ |
| 8.3 | ทบทวน hard gates; **ถ้า P0 ครบ** เลือก P1 หนึ่งอย่าง (แนะนำ `explain_outcome`) | 30 นาที |
| 8.4 | P1 (ถ้ามี) | ≤ 3 ชม. |

**Gate:** P0 ครบทุกข้อ ถ้าไม่ครบ ใช้วันนี้ปิด P0 แทน P1

## อา. 9 พ.ย. — Phase 9 hardening

| # | งาน | ใช้เวลา |
|---|---|---|
| 9.1 | รัน matrix ครบ (U/D/I + S-01 ×3 บน host + S-05, S-06, S-09) | 3 ชม. |
| 9.2 | `/code-review` + `/security-review` บน diff จาก baseline; แก้ critical | 3 ชม. |
| 9.3 | Regression Solana USDG บน Purple Cafe (D-14 + smoke เดิม) | 1 ชม. |

**Gate:** ไม่มี critical/high ค้าง; matrix ผ่าน

## จ. 10 พ.ย. — Phase 10 judge packet

| # | งาน | ใช้เวลา |
|---|---|---|
| 10.1 | `JUDGES.md`, README ส่วน PayPal, PROVENANCE ตารางครบ ([08](08_SUBMISSION_TH.md)) | 3 ชม. |
| 10.2 | H-01, H-02 (fresh browser + มือถือจริง) | 1.5 ชม. |
| 10.3 | ตรวจไฟล์ที่จะ public (D7), secret scan, ขออนุญาต push → push + tag | 1 ชม. |
| 10.4 | เตรียมบทวิดีโอจากของจริง | 1 ชม. |

**Gate:** fresh setup ผ่าน, branch บน GitHub ตรงกับเดโม

## อ. 11 พ.ย. — Phase 11 วิดีโอ + Devpost (เป้าส่ง 18:00)

| # | งาน | ใช้เวลา |
|---|---|---|
| 11.1 | อัดหน้าจอตามบท ≤ 2:50 (ผู้ใช้ถือมือถือ/Mini ถ้าต้องมีภาพจริง) | 2 ชม. |
| 11.2 | ตัดต่อ + คำบรรยาย + SRT | 2 ชม. |
| 11.3 | ขออนุญาต → อัปโหลด YouTube Public | 30 นาที |
| 11.4 | ขออนุญาต → แก้ Devpost ทุกช่อง ([08 §2](08_SUBMISSION_TH.md)) → เปิดตรวจซ้ำ | 1 ชม. |

**Gate:** Devpost ตรงกับหลักฐาน ก่อน 18:00

## พ. 12 พ.ย. — สำรอง
แก้สิ่งที่ค้าง, ตรวจ H-03 อีกครั้ง; deadline จริง 13 พ.ย. 03:00

## ถ้าช้ากว่าแผน — ตัดตามลำดับนี้
1. P1 ทั้งหมด
2. Mini จริง (ใช้ terminal แทน, ระบุในวิดีโอ)
3. Redirect fallback / in-app browser
4. Outcome UI แบบเต็ม → เหลือตาราง + trace JSON
5. **ห้ามตัด:** server verify, settlement atomic, webhook verify + dedup, reconcile, AI tools + approval, JUDGES.md
