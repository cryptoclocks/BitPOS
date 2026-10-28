# สคริปต์วิดีโอเดโม 3 นาที — BitPOS × Muse (ฉบับที่ 3 · ตรงกับระบบที่สร้างจริง 28 ต.ค.)

> ความยาวจริงต้องยืนยันจาก Official Rules · ถ่ายที่ร้านจริงวันที่ 3 พ.ย. · ทุกอย่างเป็น test mode และบัญชีทดสอบ (บอกในวิดีโอ)
> ทุกฉากที่มีฟีเจอร์ก่อนงาน ต้องมี lower-third: **"existing BitPOS (built before Oct 26)"**
> ทุกฉาก AI ต้องมี badge มุมจอ: `muse-spark-1.3 · latency` จากหน้า Evidence ledger จริง
> ทุกฉากจ่ายเงินต้องมีป้าย: **"Stripe sandbox · US test merchant · no real money"**
> ถ้ายังไม่ได้ตั้งค่าสติกเกอร์จริง: ฉากแตะใช้ลิงก์จาก `tools/meta/sim-tap.ts` และขึ้นป้าย **"simulated tap"**

| เวลา | ภาพ | เสียง/ข้อความบนจอ | หลักฐานที่ต้องเห็น |
|---|---|---|---|
| 0:00–0:15 | ร้านกาแฟจริงในไทย ลูกค้าคุยกับร้านใน Messenger | "ลูกค้าร้านเล็กในไทยอยู่บน Messenger อยู่แล้ว แต่ร้านไม่รู้ว่าใครคือลูกค้าประจำ และ AI agent ก็ยังสั่งจากร้านเล็กไม่ได้" | — |
| 0:15–0:22 | ข้อความ "Built during Meta Hackathon: BitPOS × Muse" + ภาพ POS เดิม 2 วิ | แยกชัดว่าอะไรใหม่ | ป้าย existing |
| 0:22–0:50 | **แตะครั้งแรก**: มือถือแตะสติกเกอร์ → Messenger เปิด → Get Started → กด "ยินยอม" → หน้า "เชื่อมต่อแล้ว ✓" | "แตะครั้งเดียว ลูกค้าเลือกเองว่าจะให้ร้านจำ ลบได้ทุกเมื่อ" | ปุ่ม Forget me; ledger: tap verified (counter) |
| 0:50–1:15 | **แตะครั้งที่สอง**: หน้า "ร้านจำคุณได้แล้ว" + โปร Latte −20% + เหตุผลจาก Muse Spark | "Muse Spark เลือกจากโปรที่เจ้าของอนุมัติเท่านั้น ราคาคิดโดยระบบ" | badge Muse Spark |
| 1:15–1:35 | กดจ่าย → Stripe Checkout ($4.00, บัตร 4242) → "จ่ายแล้ว ✓ รหัส #XXXX" → **หน้าพนักงาน** ขึ้นออเดอร์ → กด "ส่งมอบแล้ว" | "จ่ายแล้วมาจาก webhook ที่ตรวจลายเซ็นของ Stripe เท่านั้น" | Stripe event id ใน ledger |
| 1:35–2:00 | **สั่งผ่านแชท**: พิมพ์ "ขอลาเต้ 1 แก้ว" ใน Messenger → ข้อความ $4.00 + ปุ่มจ่าย → จ่าย → ใบเสร็จในแชท (ทางเลือก: หน้า `/meta/order` กดไมค์พูดไทย) | "สั่งด้วยแชทหรือเสียงได้ ร้านเป็นคนตั้งราคา AI แค่เลือกขั้นตอน" | ใบเสร็จ #รหัส; badge 💬 chat |
| 2:00–2:20 | **AI agent ผ่าน MCP**: terminal รัน `tools/meta/mcp-smoke.ts` → list_menu → get_quote → complete_checkout (SPT) → CONFIRMED → ขึ้นในหน้าพนักงาน "🤖 agent (MCP)" | "ร้านเดียวกันเป็น connector ให้ AI agent — agent ไม่เคยเห็นเลขบัตรและตั้งราคาเองไม่ได้" | tool calls, PaymentIntent id |
| 2:20–2:45 | **เจ้าของร้าน**: `/meta/staff/offers` → "ให้ Muse Spark ร่างโปร" → "อนุมัติ + Allow All แบบนี้" (หมวด Bakery) → ร่างใหม่ → "🤖 อนุมัติอัตโนมัติด้วย Allow All" → กดหยุด/ยกเลิกได้ทันที | "เจ้าของอนุมัติครั้งแรก แล้วเลือกได้ว่าให้ AI ทำต่อเองในกรอบไหน" | กรอบ %, ชม., เพดาน/วัน |
| 2:45–3:00 | หน้า Evidence ledger (AI calls / taps / Stripe events / decisions) + รายการ "ไม่ทำ": ไม่มีใบหน้า ไม่ดึงข้อมูล social ไม่ให้ AI ตั้งราคา | "ทุกการตัดสินใจของ AI ตรวจย้อนหลังได้" | ledger page |

## Shot list ที่ต้องเตรียม
- มือถือ 2 เครื่อง (บัญชีที่มี role ใน Meta App เพราะแอปยังเป็น development mode)
- อุปกรณ์ BitPOS ติดสติกเกอร์ NTAG424 DNA (หรือป้าย simulated tap), แท็บเล็ตเปิด `meta-pos.cashlessthailand.com/meta/staff`
- Screen recording: Messenger, หน้าแตะ, Stripe test checkout, หน้าพนักงาน, หน้าโปร, ledger, terminal MCP
- ก่อนถ่าย: หยุดโปรทดสอบ/ยกเลิก Allow All ที่ค้าง, ล้างออเดอร์ทดสอบด้วยการกด "ส่งมอบแล้ว"
- ห้ามโชว์ Solana/crypto
