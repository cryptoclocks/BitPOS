# แผนแข่ง Meta Global Hackathon 2026 — BitPOS × Muse

> ฉบับที่ 2 · 2026-10-27 · branch `hackathon/meta-2026` · baseline tag `meta-hackathon-baseline` (`9eb34ea`)
> ฉบับที่ 1 (BitPOS Sight: กล้องนับขนม + local inference) ถูกแทนทั้งหมด เหตุผลอยู่ใน §8

## 0. สถานะจริง (28 ต.ค. 2026) — ตัวเลข/ที่อยู่ในส่วนล่างของแผนเป็นฉบับร่างเดิม
| เรื่อง | ที่ทำจริง |
|---|---|
| Migrations | 300 ledger AI · 301 แท็ก+tap session · 302 ตัวตน Messenger · 303 โปรตอนแตะ · 304 Stripe ของการแตะ · 305 พนักงาน · 306 quote กลาง+ออเดอร์ agent · 307 สั่งผ่านแชท · 308 อนุมัติโปร+Allow All (ตาราง `meta_vision_observations`/`meta_agent_runs`/`meta_agent_policies` ใน 300 ไม่ได้ใช้แล้วหลังตัดกล้อง) |
| URL | แตะ `/meta/t/:tagId` · Messenger `/meta/messenger/webhook` · Stripe `/meta/stripe/webhook` · ลูกค้า `/meta/offer-page`, `/meta/order` (เสียง/พิมพ์) · พนักงาน `/meta/staff`, `/meta/staff/offers`, `/meta/staff/ledger` · MCP `POST /meta/mcp/<merchantId>` |
| Runtime | container `bitpos-meta` แยกบน OCI หลัง `pay.cashlessthailand.com/meta/*` (ไม่แตะ `bitpos-runtime`) · deploy ด้วย `tools/meta/deploy-oci.sh` |
| ยังไม่ทำ | ตั้งค่าสติกเกอร์จริง (ใช้ `tools/meta/sim-tap.ts` แทน) · Muse Image บนจอ (ตัด: ต้องแตะ worker ของ runtime) · ถ่ายทำ/ตัดต่อวิดีโอ |

## 1. ข้อเท็จจริงที่ตรวจแล้ว และสิ่งที่ยังต้องยืนยัน

| เรื่อง | ข้อเท็จจริง | ต้องทำ |
|---|---|---|
| ส่งงาน | **4 พ.ย. 21:00 ET = 5 พ.ย. 09:00 เวลาไทย** | เป้าส่ง **4 พ.ย. 21:00 ICT** (buffer 12 ชม.) |
| Track | **Startup** (สมัครแล้ว) | — |
| Models ที่หน้า official ระบุ | Muse Spark 1.3 (Meta Model API), Muse Image, SAM 3.1, Muse Spark Open, Muse Code | ยืนยัน Official Rules: เกณฑ์คะแนน, ความยาววิดีโอ, กฎ provenance |
| Muse จ่ายเงิน | ผ่าน **Stripe Link** (wallet ของผู้ใช้; ร้านนอกเครือข่าย Link ได้บัตร virtual ใช้ครั้งเดียว) + Shop Pay + PayPal; ผู้ใช้ยืนยันยอดทุกครั้ง; **ผู้ใช้ฝั่ง Muse เปิดเฉพาะสหรัฐฯ** | ลองเข้า muse.ai จากไทย |
| Muse connectors | อ่าน `platform.muse.ai/docs` แล้ว (27 ต.ค., เปิดจากไทยได้): connector ต้อง **ทำ checkout ให้จบใน Muse** (ส่งลิงก์ให้ผู้ใช้ไปจ่ายเองไม่ผ่านเกณฑ์); จ่ายเงิน = *sensitive write* ผู้ใช้กด Allow once ทุกครั้ง; ต้องแยกสถานะ quoted/pending/confirmed/failed/cancelled, กันจ่ายซ้ำ, มีใบเสร็จ/ยกเลิก/คืนเงิน; รีวิวต้องยืนยันธุรกิจ + บัญชีทดสอบ + อธิบายวิธีทดสอบโดยไม่ตัดเงินจริง; ห้ามใช้ข้อมูลจาก connector ทำโปรไฟล์/โฆษณาอื่น | รีวิวไม่น่าทันวันส่ง → เดโมด้วย agent ของเรา |
| Stripe agent payment | Agent ส่ง **Shared Payment Token (SPT)** ให้ร้าน ร้านสร้าง PaymentIntent ด้วย `payment_method_data[shared_payment_granted_token]`; sandbox มี test helper สร้าง SPT จาก `pm_card_visa` ได้ (public preview); **SPT รองรับเฉพาะ US, Canada และยุโรปบางประเทศ — ไม่มีไทย** | ✅ 27 ต.ค.: sandbox "BitPOS Meta US demo" (US) สร้าง SPT และตัดเงินผ่าน `stripe.ts` ได้จริง, retry ไม่ตัดซ้ำ, SPT ใช้ซ้ำ/เกินวงเงิน/บัตรถูกปฏิเสธ = FAILED (ดู evidence) |
| Messenger | `m.me/<page>?ref=<value>` ส่ง ref มาที่ webhook (`messaging_referrals` ถ้ามีห้องแชทอยู่แล้ว / `messaging_postbacks` หลังกด Get Started ถ้าห้องใหม่); ref ใช้ได้เฉพาะ `A-Z a-z 0-9 - _ =`; Meta ไม่การันตีทุกเครื่อง | สร้าง Page + App (development mode ใช้กับบัญชีทดสอบได้) |
| Baseline | `9eb34ea` เป็น snapshot เดียว (24 ต.ค.) **มี voice copilot แล้ว**; **ยังไม่มี Stripe เลย** ในโค้ด API | Stripe ทั้งหมดเป็นงานใหม่ |

## 2. Positioning

**"BitPOS × Muse — ร้านเล็กในไทยที่ Muse สั่งได้ จ่ายได้ และรู้จักลูกค้าด้วยการแตะ"**

Meta ทั้งเส้นทาง: Messenger (ตัวตน + ความยินยอม + ส่งโปร) → Muse Spark (เลือกโปร, agent สั่งอาหาร, ร่างโปร) → Muse Image (ภาพโปร) → Muse/Link ผ่าน Stripe (จ่ายเงิน) → จอ BitPOS Mini ในร้าน

- **ของใหม่ (ไฮไลต์ได้):** Tap Auth ด้วย NTAG424 DNA, ตัวตน+ความยินยอมผ่าน Messenger, โปรเฉพาะคนที่ Muse Spark เลือก, BitPOS Muse Connector (MCP), การจ่ายผ่าน Stripe (test mode), Allow All policy, AI ทั้งระบบบน Meta, evidence ledger
- **ของเก่า (ฉากหลัง + ป้าย "existing BitPOS"):** POS, QR สั่งอาหาร, จอ BitPOS Mini และ paid animation, promotion approval/device pipeline, pickup notice, voice ordering (มีอยู่แล้ว; ช่วงแข่ง rebuild บน Muse Spark — PROVENANCE เขียนแค่นี้ ไม่เทียบ provider)
- **ไม่โชว์ในงานนี้:** Solana / USDG / USDC / USDT / x402 (โค้ดยังอยู่ แต่ไม่อยู่ในเดโมและไม่อ้าง)
- **ไม่ทำ:** ใบหน้า, ติดตามคนผ่าน social media, PN532, firmware NFC, inference บนเครื่อง local, สต็อกตามสูตร, อ่านใบส่งของ

## 3. ระบบที่จะสร้าง

### 3.1 Tap Auth (NTAG424 DNA สติกเกอร์บน BitPOS Mini)
```
มือถือแตะ ─► https://<host>/t/<tagId>?e=<PICCData เข้ารหัส>&m=<CMAC>
            server: ถอดรหัส → UID + counter, ตรวจ CMAC, counter > ค่าล่าสุด (UPDATE แบบ atomic)
            ─► tap_session (ใช้ครั้งเดียว, อายุ 120 วิ, ผูกกับ device ที่ติดสติกเกอร์)
            ├─ มี cookie ลูกค้า (เคยลงทะเบียน) ─► รู้ตัวทันที ─► หน้าโปร + จอทักทาย
            └─ ไม่มี ─► m.me/<page>?ref=<tapSessionId> ─► webhook (ตรวจ X-Hub-Signature-256)
                       ─► PSID ─► ลูกค้ากดยินยอมใน Messenger ─► magic link ─► ตั้ง cookie บนโดเมนร้าน
```
- iPhone ต้องกดแจ้งเตือน 1 ครั้ง, Android เปิดเอง; ลงทะเบียนครั้งแรก ~2–3 ครั้งกด; ครั้งต่อไป 0–1
- QR บนจอใช้ลิงก์ tap_session เดียวกัน (สำรองสำหรับคนปิด NFC / Android ที่ ref ไม่ทำงาน)
- กุญแจ: master key อยู่ใน secret ของ server เท่านั้น, กุญแจต่อแท็ก derive จาก master + UID; ห้ามใช้กุญแจค่าเริ่มต้น (ศูนย์)
- ตั้งค่าแท็กด้วยแอปบนมือถือ (เช่น NXP TagWriter หรือแอปเขียน Bolt Card) — **ต้องลองวันแรก**

### 3.2 โปรตอนแตะ
- server สร้างรายการโปรที่ใช้ได้กับคนนี้ (โปรที่อนุมัติแล้ว + ประวัติที่ลูกค้ายินยอม) เป็น enum
- Muse Spark เลือก 1 รายการ + เหตุผลสั้นๆ จาก enum เท่านั้น; ราคาคำนวณด้วย BigInt จาก `promotionPrice()` เดิม
- แสดงบนมือถือ + ส่งใน Messenger (เฉพาะคนที่ยินยอม) + จอ BitPOS Mini (ถ้าทำทัน, §3.6)
- ลูกค้าเห็น "ทำไมได้โปรนี้" และกด "เลิกเชื่อมต่อ/ลบข้อมูลฉัน" ได้

### 3.3 จ่ายเงินด้วย Stripe (test mode เท่านั้น)
- Checkout Session (card + Link; PromptPay ถ้า test mode รองรับ) จาก quote เดิมของ BitPOS เป็น satang (integer)
- จ่ายสำเร็จได้จาก **webhook ที่ตรวจลายเซ็น Stripe แล้ว** เท่านั้น: ตรวจ amount, currency, `metadata.orderId/quoteId` ตรง quote; dedupe ด้วย event id; ปิดออเดอร์ผ่าน order-closure เดิมใน transaction เดียว
- redirect กลับจาก Stripe ไม่ใช่หลักฐานการจ่าย
- การใช้เงินจริง (live mode) ต้องได้รับอนุญาตแยกต่างหาก

### 3.4 BitPOS Muse Connector (MCP)
- tools (ระบุ Read / Write / Sensitive write ตามเกณฑ์ Muse):
  - Read: `list_menu`, `get_quote` (quote เดิมของ server: ราคารวม, สกุลเงิน, เงื่อนไขยกเลิก), `order_status`, `my_offers` (ต้องผูกตัวตน)
  - Sensitive write: `complete_checkout(quoteId, payment.credential=SPT)` → server สร้าง PaymentIntent ด้วยยอดจาก quote เท่านั้น + idempotency key ต่อ checkout → ตอบ "confirmed" หลัง PaymentIntent `succeeded` เท่านั้น; ล้มเหลวตอบ `payment_failed` ให้ agent ขอวิธีจ่ายใหม่
  - Write: `cancel_order` (ก่อนเริ่มทำ) + คืนเงินผ่าน Stripe
- agent ไม่เห็นเลขบัตร (ได้แค่ SPT) และไม่มี secret key; Stripe key ฝั่ง server ใช้ restricted key สิทธิ์ PaymentIntents write
- v1 ไม่ต้อง login (สั่งรับเองหน้าร้าน), v2 OAuth PKCE ผูกกับลูกค้าที่ลงทะเบียนผ่าน Messenger
- **ความเสี่ยงใหญ่:** Muse ตัวจริงจ่ายร้านไทยไม่ได้ตอนนี้ (SPT ไม่รองรับไทย, ผู้ใช้ Muse อยู่สหรัฐฯ, connector ต้องผ่านรีวิว) → เดโมหลักใช้ **agent ของเราบน Muse Spark ใน Messenger** เรียก tools ชุดเดียวกัน และจ่ายด้วย SPT จาก test helper ของ Stripe sandbox (จำลองการจ่ายของ agent แบบเดียวกับ Link) ถ้า sandbox ของบัญชีไทยสร้าง SPT ไม่ได้ ใช้ PaymentIntent ด้วยบัตรทดสอบแทน — บอกกรรมการตรงๆ ว่าเป็น sandbox และ Muse จริงรอรีวิว/ประเทศ

### 3.5 AI ทั้งระบบบน Meta + Allow All
- ร่างโปรผ่าน `metaPromotionProvider` (ทำแล้ว) + ภาพด้วย Muse Image (ฉากหลังเท่านั้น ข้อความ/ราคาวาดด้วยโค้ด) → device pipeline เดิม
- อนุมัติ: "อนุมัติครั้งนี้" หรือ "อนุมัติ + Allow All แบบนี้" → policy (สินค้า/หมวดเดียวกัน, % ไม่เกินที่อนุมัติ, เหตุผลชนิดเดียวกัน, เพดานต่อวัน) → ครั้งต่อไปในกรอบ AI อนุมัติเอง แจ้งเจ้าของทุกครั้ง ยกเลิกได้ทันที
- voice ordering บน Muse Spark (ถ้า Meta API ไม่รับเสียง: แปลงเสียงในเบราว์เซอร์แล้วส่งข้อความ)
- inference: Meta Model API บน cloud เท่านั้น

### 3.6 จอ BitPOS Mini
- เป้าหมาย: ไม่แก้ firmware — ใช้ภาพผ่าน promotion/media pipeline เดิม (280×200 RGB565 + SHA-256 + render ACK)
- ต้องวัดวันแรก: จอดึงภาพใหม่เร็วแค่ไหน ถ้าช้ากว่า ~3 วิ การทักทายตอนแตะแสดงบนมือถืออย่างเดียว และจอใช้แสดงโปรทั่วไป

### 3.7 Stretch (ทำเมื่อข้างบนเสร็จ)
- เงินเติมล่วงหน้า: เติมผ่าน Stripe, หักตอนแตะ, เพดานต่อครั้ง/วัน, เกินเพดานยืนยันในมือถือ; ledger integer ใน transaction เดียวกับ order (ก่อนใช้จริงตรวจกฎหมายเงินอิเล็กทรอนิกส์ของ ธปท.)
- WhatsApp เป็นช่องทางที่สอง

## 4. ไฟล์

### 4.1 Scaffold ที่มีแล้ว (ยังไม่ commit)
| ไฟล์ | สถานะในแผนใหม่ |
|---|---|
| `packages/meta-ai/src/{types,router}.ts` | ใช้ต่อ (ตั้งค่าเฉพาะ `META_AI_META_API_*`) |
| `packages/meta-ai/src/flash-sale.ts` | เปลี่ยนเป็น `offer-policy.ts` (กรอบ Allow All); ตัดส่วนนับสต็อกจากกล้อง |
| `apps/api/src/meta/promotion-bridge.ts` | ใช้ต่อ |
| `supabase/migrations/300_meta_ai.sql` | แก้: ตัด `meta_vision_observations`, ปรับ `meta_agent_policies` เป็นกรอบ Allow All |
| `tests/meta-*.test.ts` | ปรับตามข้างบน |

### 4.2 สร้างใหม่
```
packages/meta-ai/src/ntag424.ts        verifySun({tagKeyMaterial, e, m}) -> {uid, counter}  (AES-128 + CMAC, ทดสอบด้วย test vector ของ NXP AN12196)
packages/meta-ai/src/offer-select.ts   selectOffer(router, {customerFacts, offers enum}) -> {offerId, reason}
apps/api/src/meta/tap.ts               GET /t/:tagId -> tap_session; POST /api/meta/tap/:id/claim
apps/api/src/meta/messenger.ts         webhook (verify token + X-Hub-Signature-256), ref -> tap_session, consent, magic link
apps/api/src/meta/customer-session.ts  cookie session ของลูกค้า (HttpOnly, SameSite=Lax), unlink/delete
apps/api/src/meta/stripe.ts            createCheckout(quote) (คนแตะจ่าย) / chargeSpt(quote, spt) (agent) / webhook verify + dedupe + order-closure เดิม
apps/api/src/meta/mcp.ts               MCP server: list_menu, get_quote, create_checkout, order_status, my_offers
apps/api/src/meta/agent.ts             agent บน Muse Spark ใน Messenger: เลือก tool จาก enum ทีละขั้น
apps/api/src/meta/routes.ts            mount ทั้งหมด
apps/web/src/pages/meta/tap.astro      หน้ามือถือหลังแตะ (ทักทาย, โปร, จ่าย)
apps/web/src/components/meta/{TagAdmin,OfferApproval,AllowAllPolicy,EvidenceLedger}.tsx
supabase/migrations/301_meta_tap.sql        ntag_tags, ntag_counters, tap_sessions
supabase/migrations/302_meta_identity.sql   meta_customer_identities (page-scoped PSID), consent, unlink
supabase/migrations/303_meta_stripe.sql     stripe_checkouts, stripe_events (dedupe)
tools/meta/{stripe-smoke.ts (มีแล้ว),provision-tag.ts,provenance-report.ts}
```

### 4.3 ไฟล์เก่าที่ต้องแตะ (ลง `PROVENANCE.md` ทุกจุด)
- `apps/api/src/index.ts` — mount routes ของ meta
- `apps/worker/src/promotions.ts` — ยอมรับ provider `meta-router:<id>` ในการตรวจ provenance
- `apps/web` — ลิงก์ไปหน้า meta จาก POS/settings (น้อยที่สุด)
- Firmware: ไม่แตะ

### 4.4 Invariants (ทุกข้อต้องมีเทสต์)
1. LLM ไม่กำหนดราคา/ยอดเงิน — เลือกจาก enum ที่ server สร้าง; ราคาเป็น BigInt
2. ไม่มี model call ระหว่างถือ `routingLock` หรืออยู่ใน transaction
3. แตะ: CMAC ถูก + counter มากกว่าค่าเดิมแบบ atomic + tap_session ใช้ครั้งเดียว อายุ 120 วิ ผูกกับ device
4. ตัวตน: เกิดหลังลูกค้ากดยินยอมใน Messenger เท่านั้น; ลบ/เลิกเชื่อมได้; ไม่มีใบหน้า ไม่ดึงข้อมูล social
5. จ่ายแล้ว = webhook Stripe ที่ตรวจลายเซ็น + amount/currency/metadata ตรง quote + event id ไม่ซ้ำ
6. Webhook Messenger ตรวจ `X-Hub-Signature-256`; app secret / Stripe key / tag master key ไม่อยู่ใน repo
7. Agent ไม่เห็นบัตร ไม่มี secret key; จ่ายบนหน้า Stripe เท่านั้น
8. Test mode เท่านั้น
9. ทุก model call มีแถวใน `meta_ai_invocations` (รวมที่ล้มเหลว)

## 5. ตารางเวลา (เวลาไทย)

| วัน | งาน | Definition of done |
|---|---|---|
| **อ. 27 ต.ค. (คืนนี้)** | ยืนยัน Official Rules · ขอ Meta API key แล้วเรียก Muse Spark 1 ครั้ง · สร้าง Stripe test account keys · สร้าง FB Page + Meta App (dev mode) · ตั้งค่าแท็ก NTAG424 1 ชิ้นแล้วแตะด้วย iPhone และ Android · ลองเข้า muse.ai | ได้ URL จากแท็กจริง 2 ครั้งที่ counter ต่างกัน; Muse Spark ตอบ JSON ได้ |
| **พ. 28** | ปรับ scaffold (offer-policy, migration 300) · `ntag424.ts` + เทสต์ test vector · migration 301–303 | test vector ผ่าน; ส่ง URL เดิมซ้ำถูกปฏิเสธ |
| **พฤ. 29** | `tap.ts` + `messenger.ts` + `customer-session.ts` + `tap.astro` | แตะจริง → ลงทะเบียนใน Messenger → แตะครั้งที่สองรู้ตัวทันที |
| **ศ. 30** | `stripe.ts` + checkout จากหน้า tap | จ่ายด้วยบัตรทดสอบ → POS เห็นว่าจ่ายแล้ว; ส่ง webhook ซ้ำไม่ปิดซ้ำ |
| **ส. 31** | `offer-select.ts` + โปรตอนแตะ + ส่ง Messenger · `mcp.ts` | แตะแล้วเห็นโปรที่ Muse Spark เลือก; MCP tools ตอบได้ |
| **อา. 1 พ.ย.** | `agent.ts` ใน Messenger (สั่ง→quote→checkout) · Allow All + OfferApproval | สั่งลาเต้ผ่านแชทจนจ่ายได้; โปรที่ 2 อนุมัติเองในกรอบ |
| **จ. 2** | Muse Image โปสเตอร์ → จอจริง · voice บน Muse Spark · EvidenceLedger · ซ้อมที่ร้าน · **feature freeze 22:00** | ทุกขั้นในสคริปต์วิดีโอทำได้จริงบนของจริง |
| **อ. 3** | ถ่ายทำที่ร้าน · provenance report · README สำหรับกรรมการ | footage ครบตาม `DEMO_SCRIPT_TH.md` |
| **พ. 4** | ตัดต่อ + ซับ TH/EN · secret scan ทั้ง history · **ส่ง 21:00 ICT** | ลิงก์เปิดได้จาก incognito |

ถ้าไม่ทัน ตัดจากล่างขึ้นบน: voice → Muse Image บนจอ → Allow All → agent ใน Messenger (เหลือ MCP + เดโมด้วย MCP inspector)

กฎทุกวัน: commit เล็ก ข้อความขึ้นต้น `meta:`; ท้ายวันอัปเดต `meta-hackathon/evidence/` และ `docs/CHECKPOINT.md`; ห้าม push จนกว่ารัน secret/infra scan ทั้ง history

## 6. ทดสอบ
- `meta-ntag424.test.ts` — test vector ของ NXP, CMAC ผิด, counter ซ้ำ/ถอยหลัง, tag ไม่รู้จัก
- `meta-tap.test.ts` (DB) — tap_session ใช้ครั้งเดียว, หมดอายุ, แข่งกัน claim 2 คน
- `meta-messenger.test.ts` — ลายเซ็นผิด, ref ไม่รู้จัก, ไม่มี consent ห้ามผูก, unlink
- `meta-stripe.test.ts` — ลายเซ็นผิด, ยอดไม่ตรง, currency ไม่ตรง, event ซ้ำ, webhook มาก่อน redirect
- `meta-offer.test.ts` — โมเดลตอบ offer นอก enum → ปฏิเสธ; Allow All เกินกรอบ/เกินเพดาน → กลับไปให้คนอนุมัติ
- `meta-mcp.test.ts` — tool input validation, quote ตรงกับ server, ไม่มี secret ใน output
- รัน: `npx tsx --test tests/meta-*.test.ts` และ `pnpm typecheck`

## 7. ความเสี่ยง

| ความเสี่ยง | เช็กเมื่อ | แผนสำรอง |
|---|---|---|
| ตั้งค่า SDM บน NTAG424 ด้วยมือถือไม่ได้ | 27 ต.ค. | เขียน `tools/meta/provision-tag.ts` ใช้กับเครื่องอ่าน USB; สุดท้ายใช้ QR บนจออย่างเดียว |
| ref ของ m.me ไม่ส่งมาบางเครื่อง | 29 ต.ค. | หลังลูกค้าทักแชท ให้พิมพ์รหัส 4 หลักที่แสดงบนจอ |
| Meta App ต้องผ่านรีวิวก่อนใช้กับคนทั่วไป | 27 ต.ค. | เดโมใช้บัญชีที่มี role ใน app (dev mode) — บอกกรรมการตรงๆ |
| Muse จ่ายร้านไทยไม่ได้ (SPT ไม่มีไทย) / connector รีวิวไม่ทัน | ยืนยันแล้ว 27 ต.ค. | เดโมด้วย agent ของเราบน Muse Spark + SPT จาก sandbox test helper |
| sandbox ของบัญชีไทยสร้าง SPT ไม่ได้ | รัน `stripe-smoke.ts` | PaymentIntent ด้วยบัตรทดสอบ (`pm_card_visa`) ผ่าน tool เดียวกัน |
| Meta Model API ไม่รองรับ tool calling | 27 ต.ค. | agent เลือก tool ผ่าน JSON schema (enum) ทีละขั้นด้วย router เดิม |
| จอดึงภาพช้า | 2 พ.ย. | ทักทายบนมือถือ, จอแสดงโปรทั่วไป |
| เผลอโชว์ฟีเจอร์เก่า | ก่อนถ่ายทำ | ป้าย "existing BitPOS" + ตรวจกับ `PROVENANCE.md` |

## 8. การตัดสินใจ (2026-10-27)
1. Track Startup (สมัครแล้ว)
2. โปร: คนอนุมัติครั้งแรกเสมอ เลือก Allow All ได้ (กรอบ + เพดาน + แจ้งเตือน + ยกเลิกได้)
3. Inference บน cloud เท่านั้น
4. ห้าม merge `codex/bitpos-h2-local-scope-20261027` และ `dev/*` เข้า branch นี้
5. ไฮไลต์ = Meta ทั้งระบบ; voice ordering เขียนใน PROVENANCE ว่ามีอยู่แล้วและ rebuild บน Muse Spark โดยไม่เทียบ provider
6. ตัด: กล้องนับขนม, local inference, สต็อกตามสูตร, อ่านใบส่งของ, ใบหน้า, PN532, crypto ในเดโม
7. ยืนยันตัวตนด้วยสติกเกอร์ NTAG424 DNA (ผู้ใช้มีแล้ว) + Messenger; จ่ายด้วย Stripe test mode + Muse
8. **เดโมการจ่ายแบบ agent ใช้ร้านทดสอบในฐานะร้าน US** (Stripe sandbox ของบัญชีประเทศ US, สกุล USD) เพราะ SPT ยังไม่รองรับไทย — test mode เท่านั้น ห้ามเปิด live ด้วยข้อมูลธุรกิจที่ไม่จริง; วิดีโอและ README ติดป้าย "Stripe sandbox · US test merchant · no real money" และบอกว่าร้านไทยจริงรอ Stripe เปิด SPT ในไทย + Muse connector review; ร้านเดโมเป็น merchant แยก (fixture ติดป้าย) ไม่ใช้ข้อมูลร้านจริง
