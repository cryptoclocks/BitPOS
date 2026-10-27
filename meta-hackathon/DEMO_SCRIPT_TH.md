# สคริปต์วิดีโอเดโม 3 นาที — BitPOS × Muse (ร่าง ฉบับที่ 2)

> ความยาวจริงต้องยืนยันจาก Official Rules · ถ่ายที่ร้านจริงวันที่ 3 พ.ย. · ทุกอย่างเป็น test mode และบัญชีทดสอบ (บอกในวิดีโอ)
> ทุกฉากที่มีฟีเจอร์ก่อนงาน ต้องมี lower-third: **"existing BitPOS (built before Oct 26)"**
> ทุกฉาก AI ต้องมี badge มุมจอ: `model · latency` จาก ledger จริง
> ทุกฉากจ่ายเงินต้องมีป้าย: **"Stripe sandbox · US test merchant · no real money"** (SPT ยังไม่เปิดในไทย)

| เวลา | ภาพ | เสียง/ข้อความบนจอ | หลักฐานที่ต้องเห็น |
|---|---|---|---|
| 0:00–0:15 | ร้านกาแฟจริงในไทย ลูกค้าคุยกับร้านใน Messenger | "ลูกค้าร้านเล็กในไทยอยู่บน Messenger อยู่แล้ว แต่ร้านไม่รู้ว่าใครคือลูกค้าประจำ และ AI agent อย่าง Muse ก็ยังสั่งจากร้านเล็กไม่ได้" | — |
| 0:15–0:22 | ข้อความ "Built during Meta Hackathon: BitPOS × Muse" + ภาพ POS เดิม 2 วิ | แยกชัดว่าอะไรใหม่ | ป้าย existing |
| 0:22–0:55 | **แตะครั้งแรก**: มือถือแตะสติกเกอร์บน BitPOS Mini → Messenger เปิด → กด Get Started + ยินยอม | "แตะครั้งเดียวผ่าน Messenger ลูกค้าเลือกเองว่าจะให้ร้านจำ" | ข้อความยินยอม; ledger: tap verified (counter) |
| 0:55–1:25 | **แตะครั้งที่สอง (วันถัดไป)**: แตะ → หน้าเว็บทักชื่อทันที + โปรที่ Muse Spark เลือก + เหตุผล | "Muse Spark เลือกโปรจากรายการที่ร้านอนุมัติแล้วเท่านั้น ราคาคิดโดยระบบ" | badge Muse Spark; enum โปรที่อนุญาต |
| 1:25–1:45 | กดจ่าย → Stripe Checkout (test) → POS ขึ้นจ่ายแล้ว + จอ BitPOS Mini paid animation (ป้าย existing) | "สถานะจ่ายแล้วมาจาก webhook ที่ตรวจลายเซ็นของ Stripe เท่านั้น" | Stripe event id ใน ledger |
| 1:45–2:15 | **Agent สั่งให้**: ที่บ้าน พิมพ์ใน Messenger "ลาเต้แก้วเดิม รับ 8:30" → agent เรียก MCP tools → quote → ลิงก์ checkout → ยืนยันยอด → ออเดอร์ขึ้น POS | "ร้านเดียวกันเป็น Muse connector — agent สั่งและจ่ายได้ โดยไม่เคยเห็นเลขบัตร" | tool calls ใน ledger; (ถ้ามี) คลิป Muse เห็น connector |
| 2:15–2:40 | **เจ้าของร้าน**: Muse Spark + Muse Image ร่างโปร → กด "อนุมัติ + Allow All" → ครั้งถัดไปอนุมัติเองในกรอบ + แจ้งเตือนเจ้าของ → ภาพขึ้นจอจริง | "เจ้าของอนุมัติครั้งแรก แล้วเลือกได้ว่าให้ AI ทำต่อเองในกรอบไหน" | policy version, approval_kind, render ACK |
| 2:40–3:00 | Evidence ledger + รายการ "ไม่ทำ": ไม่มีใบหน้า ไม่ดึงข้อมูล social ไม่ให้ AI ตั้งราคา | "ทุกการตัดสินใจของ AI ตรวจย้อนหลังได้" | ledger page |

## Shot list ที่ต้องเตรียม
- iPhone 1 เครื่อง + Android 1 เครื่อง (บัญชีทดสอบที่มี role ใน Meta App)
- BitPOS Mini ติดสติกเกอร์ NTAG424 DNA, ระบบ POS เปิดบนแท็บเล็ต
- Screen recording: Messenger, หน้า tap, Stripe test checkout, POS, ledger
- ห้ามโชว์ Solana/crypto
