# รีวิวแผนเดิม (5 Modules) เทียบกับโค้ด BitPOS จริง

> **ประวัติ:** รีวิวนี้เขียนก่อนเปลี่ยนเป็นแผน BitPOS × Muse (2026-10-27) ข้อเท็จจริงเรื่อง baseline ยังถูกต้อง แต่ข้อเสนอเรื่องกล้อง/SAM/local inference ไม่ใช้แล้ว ดู `PLAN_TH.md`

> อ่านจาก baseline `meta-hackathon-baseline` = `9eb34ea` (push ขึ้น GitHub 2026-10-24 ก่อนงานเริ่ม 2026-10-26)
> สรุปสั้น: แผนเดิม **มองโค้ดเก่ากว่าความจริงมาก** และ 2 ใน 5 module **ซ้ำกับฟีเจอร์ที่ BitPOS มีอยู่แล้วก่อนงาน** ถ้าเอาไปโชว์เป็นไฮไลต์จะมีความเสี่ยงถูกตัดสิทธิ์ตามกฎ provenance

## 0. ข้อเท็จจริงที่แผนเดิมเข้าใจผิด

| แผนเดิมบอก | ความจริงใน baseline | ผลกระทบ |
|---|---|---|
| migrations มีถึง `021` จะสร้าง `022_meta_superintelligence.sql` | มีถึง **`137`** แล้ว และ `022_pickup_fulfillment.sql` มีอยู่ | ชื่อชนกัน → ใช้ช่วง **`300–399`** สำหรับงาน Meta (สร้างแล้ว: `300_meta_ai.sql`) |
| Voice ordering เป็นของใหม่ | มี **Coffee Copilot** (พูดไทย/อังกฤษ → transcript → proposal ที่ล็อกกับเมนูจริง) ผ่าน Gemini แล้ว: `coffee-copilot.ts`, `coffee-provider.ts`, `coffee-audio.ts`, migration `029`,`032` | Module 4 = ของเก่า แค่เปลี่ยน provider → **ห้ามเป็นไฮไลต์** |
| AI เขียนโปรโมชันเป็นของใหม่ | มี **promotion pipeline** ครบ: AI draft → merchant approve → device queue → render ACK (`promotions.ts`, `promotion-provider.ts`, `promotion-lifecycle.ts`, migration `027/028/036/038/042/045`) และ provider เป็น OpenAI-compatible อยู่แล้ว | ชี้ URL ไป Meta ได้ทันทีแทบไม่ต้องเขียนโค้ด → นับเป็นงานใหม่ไม่ได้ |
| ต้องส่งรูปผ่าน WebSocket ไป ESP32 | device **ดึงรูป 280×200 RGB565 (112,000 bytes) ผ่าน HTTPS token + SHA-256** มี SD cache 2 ช่องและ render ACK อยู่แล้ว (`promotion-assets.ts`, `bitpos_promotion*.c`, `bitpos_media.c`) | ปัญหา WS payload ไม่มีจริง; งานใหม่คือ "แหล่งภาพ" ไม่ใช่ "ท่อส่ง" |
| x402 / bounded delegation จะสร้างใหม่ | มีแล้ว: `x402*.ts`, `delegated-*.ts`, migration `030/031/033/034` | ห้ามโชว์เป็นของใหม่ |
| ต้องสร้าง READY_FOR_PICKUP | มี `PREPARING→READY→COLLECTED` + pickup notice ไปจอโต๊ะแล้ว (`fulfillment.ts`, migration `022–024`) | Module 5 เป็นแค่ "gate" ก่อน READY ไม่ต้องสร้าง state ใหม่ |
| มี bonus prize 4 รางวัล, น้ำหนัก 30/25/25/20, Baseten/Modal credits, model ID `meta-models/muse-spark-open-1026` | **หน้า official ไม่ระบุสิ่งเหล่านี้เลย** (มีแค่ 2 tracks: Indie / Startup, pool $1M, รายชื่อ model) | ต้องยืนยันจาก Official Rules / Discord ก่อนวางกลยุทธ์ตามรางวัล (ดู `PLAN_TH.md` §1) |

## 1. ปัญหาข้ามทุก module และวิธีแก้

**C1 — Provenance คือความเสี่ยงอันดับ 1**
- Branch `codex/bitpos-h2-local-scope-20261027` มี 23 commits ลงวันที่ 27 ต.ค. ที่เป็นการ commit งานเก่าก้อนใหญ่ → ถ้า merge เข้า `hackathon/meta-2026` กรรมการจะเห็นเป็น "งานช่วงแข่ง" ทั้งที่ไม่ใช่ → **ห้าม merge**; ถ้าจำเป็นต้องใช้ส่วนไหนให้ cherry-pick และบันทึกใน `PROVENANCE.md` ว่าเป็น inherited
- งานใหม่ทั้งหมดอยู่ใน path ที่มีคำว่า `meta` (`packages/meta-ai/`, `apps/api/src/meta/`, `apps/web/src/components/meta/`, `supabase/migrations/3xx_*`, `tests/meta-*`) ทุกไฟล์มี header `Meta hackathon work`
- ไฟล์เก่าที่ต้องแตะ ให้แตะน้อยที่สุดและแต่ละจุดต้องลง `PROVENANCE.md` พร้อมเหตุผล
- ในวิดีโอ ทุกฉากที่โผล่ฟีเจอร์เก่า (จ่ายเงิน, เมนู QR) ต้องมี lower-third ว่า **"existing BitPOS (pre-hackathon)"**

**C2 — LLM ห้ามถือ lock และห้ามนับของ**
- `routingLock(db, merchant)` เป็น advisory xact lock ระดับร้าน ถ้าเรียก SAM→Spark (หลายวินาที) ระหว่างถือ lock = POS ทั้งร้านค้าง
- แก้: ใช้ pattern 3 ช่วงแบบที่ `coffee-copilot.ts` ทำอยู่แล้ว → (1) tx สั้น: จองงาน + snapshot hash → (2) เรียก model **นอก tx** → (3) tx สั้น: ตรวจ snapshot/`expectedRevision` ยังตรง ถ้าไม่ตรง = `STALE` แล้ว re-plan ครั้งเดียว
- จำนวนชิ้นต้องคำนวณจาก **mask ของ SAM 3.1 ด้วยโค้ด** (นับ mask ใน zone, กรอง area/score) ไม่ให้ LLM นับ; LLM แค่ map label→สินค้า และเลือกตัวเลือกที่ server อนุญาต

**C3 — "Autonomous Leashed Mode" ขัดกับ `AGENTS.md`** ("Keep AI campaign drafts reviewable") และระบบเดิมที่ "generation never publishes"
- ทางออกที่เสนอ (ต้องให้คุณตัดสินใจ): ทำได้เฉพาะเมื่อ **owner อนุมัติ policy ล่วงหน้า** (`meta_agent_policies`, มี version, เพดาน %, จำนวนครั้ง/วัน) — การอนุมัติอัตโนมัติถูกบันทึกเป็น `approval_kind='policy'` + ผู้อนุมัติ policy, draft ยังเห็นย้อนหลังได้ และยกเลิกได้ 1 แตะ; ค่าเริ่มต้น = `supervised`
- โค้ดที่ทำแล้ว: `flash-sale.ts` (`planFlashSale`, `autoApprovable`) + constraint ใน `300_meta_ai.sql` ห้าม `supervised` มี auto cap, ห้ามมี run ซ้อนต่อสินค้า

**C4 — ความหน่วงต่อหน้ากล้อง**
- อย่าให้ผู้ชมรอเงียบ: สแกนเป็น background ทุก N นาที + ปุ่ม "scan now"; stream ขั้นตอนไป UI (SSE) ให้เห็น mask → count → reasoning → proposal ทีละขั้น
- cache ตาม `frame_sha256` (UNIQUE ใน DB แล้ว) ภาพซ้ำไม่เรียก model ซ้ำ, ย่อภาพก่อนส่ง, crop เฉพาะ ROI ตู้ขนม
- ตั้งงบเวลา: scan→proposal เป้า < 8 วินาที (ต้องวัดจริงวันที่ 1–2 เพราะยังไม่รู้ latency ของ SAM 3.1 API)

**C5 — ความเป็นส่วนตัวของกล้องในร้าน** ("Build for Your World" ต้องน่าเชื่อ)
- กล้องเล็งเฉพาะตู้/ถาด, crop ROI ก่อนส่งออกนอกเครื่อง, ไม่เก็บ raw frame ใน DB (เก็บแค่ hash + ผลนับ; crop หลักฐานหมดอายุ 14 วัน), ป้ายแจ้งในร้าน

**C6 — งบ credit** ($150 Meta API ตามที่ประกาศ; Baseten/Modal ต้องยืนยัน)
- SAM ต่อเฟรมอาจแพง → วัดต้นทุนต่อ call วันแรก, dedupe ด้วย hash, scan cadence 5 นาที, งานพัฒนาใช้ local ก่อน
- `meta_ai_invocations` เก็บ token/latency ทุก call → ทำ dashboard ต้นทุนได้

**C7 — Self-hosted open weights บน V100 / M5 Ultra**
- V100 (Volta) ไม่มี bf16 ที่เร็วและไม่รองรับ FlashAttention-2 ใน vLLM → ต้อง fp16/quantized; ยังไม่รู้ขนาด Muse Spark Open → spike วันแรก: weights format, ขนาด, license, multimodal หรือไม่
- Mac Studio: MLX / llama.cpp (`llama-server` / `mlx_lm.server` ให้ OpenAI-compatible endpoint) → ต่อผ่าน Tailscale เท่านั้น router อนุญาต `http` แค่ loopback/`100.64.0.0/10`
- ถ้า open model ไม่รองรับภาพ: ให้ SAM ทำ vision แล้วส่ง **ข้อความ/ตัวเลขจาก mask** ให้ open model ตัดสินใจ (router กรอง provider ที่ไม่รองรับภาพให้อัตโนมัติ)

**C8 — "No mocks" กับ deterministic fallback**
- Fallback ต้องเป็น "model อื่นของ Meta" ไม่ใช่ fixture; fixture ใช้ในเทสต์เท่านั้นและห้ามโผล่ในวิดีโอ
- ทุกขั้นใน timeline แสดง provider/model/latency จริงจาก `meta_ai_invocations`

**C9 — ข้อความ/ราคาในภาพที่ AI สร้าง**
- โมเดลภาพเขียนภาษาไทยและตัวเลขเพี้ยน → **ห้ามให้โมเดลภาพวาดตัวหนังสือหรือราคา**; ข้อความ+ราคา overlay ด้วย renderer แบบ deterministic (มีอยู่แล้ว)
- ภาพอาหารที่ AI สร้างอาจไม่ตรงของจริง (โฆษณาเกินจริง) → ใช้ **SAM ตัดภาพสินค้าจริง (licensed photo)** แล้วให้ Muse Image สร้างเฉพาะ "ฉากหลัง/บรรยากาศ" → compose; ติดป้าย "AI scene" เล็กๆ

**C10 — ปัญหา reproducibility ที่เจอระหว่างตรวจ (ของเก่า)**
- `029_coffee_copilot.sql` ล้มบน DB ใหม่เพราะบังคับว่าต้องมีประวัติ Gemini ≥ 3 รายการ → กรรมการรันจาก 0 ไม่ได้ ต้องมีวิธี fixture ที่บันทึกไว้ (ห้ามแก้ไฟล์ migration เก่าเงียบๆ)

## 2. รีวิวราย module

### Module 1 — Router (คงไว้ ทำแล้ว)
- เดิม: ผูก 4 แหล่ง + telemetry → ดี แต่ "SAM/Image/Voice" ไม่ใช่ chat completions → แยก adapter (`vision.ts`, `image.ts`) หลังได้ API docs จริง
- เพิ่ม: circuit breaker, deadline รวม, จำกัดขนาด response, ปฏิเสธ output ที่ไม่ผ่าน schema แล้ว fallback, `prefer` (สลับ cloud/local สด), `requireOpenWeights` (พิสูจน์ว่า open model ทำงานจริงโดยไม่แอบ fallback ไป closed)
- สถานะ: ✅ `packages/meta-ai/src/router.ts` + 8 tests

### Module 2 — Visual inventory → flash sale (**พระเอก**, ของใหม่จริง)
- ผิดในแผนเดิม: เรียก `productOffer()` ตรง → ข้าม pipeline โปรโมชันที่มี approval, device queue, render ACK อยู่แล้ว
- แก้: agent สร้าง **promotion job** ผ่าน `metaPromotionProvider` (bridge) → pipeline เดิมเป็นผู้ตัดสินราคา/อนุมัติ/ส่งจอ; model เลือก % จาก enum ที่ `planFlashSale` อนุญาตเท่านั้น
- เพิ่ม: ตรวจ camera vs ledger (`INVENTORY_MISMATCH` เมื่อกล้องเห็นมากกว่าสต็อก), ห้ามซ้อน run ต่อสินค้า, คำนวณ surplus ด้วย integer
- สถานะ: ✅ `flash-sale.ts`, `promotion-bridge.ts` + 6 tests; ⏳ `vision.ts`, `counting.ts`, route, worker lane, UI

### Module 3 — Generative signage (ทำใหม่ในมุม "แหล่งภาพ")
- ตัด: ส่งภาพผ่าน WS, เขียน firmware ใหม่
- ทำ: Muse Image สร้างฉากหลัง + SAM cutout สินค้าจริง → renderer ตัวใหม่ `promotion-render-meta.py` (ไม่แก้ตัวเก่า) → ใช้ media URL + SHA-256 + render ACK เดิม → **เป้าคือไม่แตะ firmware เลย**
- หลักฐาน: เก็บ `sha256` ของภาพที่จอ ACK คู่กับ invocation id

### Module 4 — Voice + agent payment (**ตัดออกจากไฮไลต์**)
- ทั้ง voice ordering และ x402/delegated payment เป็นของเก่า; เปลี่ยน Gemini→Muse ไม่ใช่ฟีเจอร์ใหม่
- AI ห้ามถือ signing key (AGENTS.md) — ระบบเดิมถูกต้องอยู่แล้ว
- ถ้ามีเวลาเหลือ (stretch): "เสียงสั่งงานฝั่งพนักงาน" เช่น "ครัวซองต์เหลือกี่ชิ้น/สแกนตู้ตอนนี้" = ของใหม่ เชื่อมกับ Module 2

### Module 5 — Tray inspector (คงไว้ เป็นของใหม่จริง)
- ความเสี่ยง: มองจากด้านบนแยกลาเต้กับอเมริกาโน่ไม่ได้, ฝาแก้วบัง, ของซ้อน
- แก้: ตรวจระดับที่ "มองเห็นได้จริง" (จำนวนแก้ว ร้อน/เย็น, ชนิดขนม) และบอก confidence; **mismatch = เตือน + staff override** ไม่ block (มนุษย์ตัดสิน); ใช้แผ่นรองถาดสีตัดกัน + กล้องตำแหน่งคงที่
- ผูกกับ transition เดิม (`expectedVersion` + `idempotencyKey`) ไม่สร้าง state ใหม่; บันทึกผลใน `meta_vision_observations(kind='tray_check')`
