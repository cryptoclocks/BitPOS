<!-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. -->
# สตอรี่บอร์ดวิดีโอถ่ายจริง (ฉบับล่าสุด): BitPOS Mini บนโต๊ะ ลูกค้าสแกนสั่งเอง AI จ่าย เครื่องเซ็นยืนยันบน NEAR

ยาวประมาณ **1:50 นาที** · โพสต์เป็น **reply ใต้โพสต์เดิม** https://x.com/theCryptoClock/status/2121392191759335814
ทุกขั้นในบทนี้ทดสอบบนเว็บจริงแล้ว 14 พ.ย. 2026 ชื่อปุ่มตรงกับที่ขึ้นบนจอ

**ภาพ 3 แบบ**
- **[กล้อง]** มือถือเครื่องที่ 2 ถ่ายเครื่อง Mini บนโต๊ะ (แนวนอน 16:9)
- **[จอมือถือ]** อัดหน้าจอมือถือที่ใช้สแกน (iPhone: ศูนย์ควบคุม → บันทึกหน้าจอ)
- **[จอร้าน]** อัดหน้าจอโน้ตบุ๊กที่เปิดหน้าร้าน (Mac: `Cmd + Shift + 5`)

---

## เตรียมก่อนถ่าย (10 นาที)

1. **เครื่อง Mini:** เสียบไฟ (ที่ชาร์จหรือพาวเวอร์แบงก์ก็ได้) ใช้ WiFi วงเดิม รอให้จอขึ้น **ซ้าย QR "Scan to order" · ขวาภาพ Iced Latte เคลื่อนไหว "Iced Latte -10%"**
2. **บอก Claude ว่า "เปิดพยาน"** (หรือหน้าร้าน → NEAR · Living Bill → Devices & witness → BitPOS Mini · Table 2 → **Make witness**)
3. **โน้ตบุ๊ก:** เปิด `near-pos.cashlessthailand.com` → **Owner** → แท็บ **NEAR · Living Bill** → **Ledger** ค้างไว้
4. **มือถือที่ใช้สแกน:** เปิดบันทึกหน้าจอ
5. **ซ้อม 1 รอบ** (ไม่ต้องอัด) แล้วรอให้จอ Mini กลับมาหน้าแรก (ประมาณ 25 วินาทีหลังจ่าย)

> หลังถ่าย: บอก Claude ว่า **"ปิดพยาน"**

---

## Scene 1 · เปิดเรื่อง (0:00–0:10) — [กล้อง]

**ภาพ:** เครื่อง Mini ข้างแก้วกาแฟ ซูมเข้าช้าๆ ให้เห็น QR ซ้าย และภาพ Iced Latte เคลื่อนไหว **"Iced Latte -10% · USD 4.05 instead of 4.50"**

**พูด:**
> "This is a real BitPOS Mini on a café table, running our new NEAR firmware. Today's offer is live — and the price on the screen is the price you pay."

## Scene 2 · สแกนสั่งเอง (0:10–0:30) — [กล้อง] → [จอมือถือ]

**ภาพ:** มือถือสแกน QR ซ้ายของเครื่อง → เมนู **Table 2** เปิดขึ้น (ถ้าขึ้นภาษาไทย กด **Switch to English** มุมบน)
→ กด **+** ที่ **Iced Latte** (เห็น -10% · USD 4.05) → **View your order** → **Review order** → **Confirm order & pay**

**พูด:**
> "The guest scans the table and orders on their own phone — no app, no sign-up. The discount is applied by the server."

## Scene 3 · บิลบน NEAR (0:30–0:42) — [จอมือถือ]

**ภาพ:** หน้าจ่ายเงิน *Orbit Café · Table 2 · 4.05 tUSD* → กด **Open my bill on NEAR** → เลื่อนให้เห็น *Where your money goes*

**พูด:**
> "The bill is written into a NEAR contract with everyone it pays: the owner, the tax reserve, the barista on shift and the milk supplier."

## Scene 4 · ให้ AI จ่าย (0:42–1:00) — [จอมือถือ]

**ภาพ:** เปิด **Let an AI agent pay (time-limited pass)** → เลือก **1 day** → ช่อง *Your rule for the agent* พิมพ์ **`Coffee only`**
→ **Give the AI a pass** → **Let the AI agent pay this bill**

**พูด:**
> "The guest gives an AI agent a one-day pass with a spending cap and one rule: coffee only. The agent reads the bill on NEAR AI Cloud — it's coffee — so it pays. Its key can only pay exact bills."

## Scene 5 · เครื่องเป็นพยาน (1:00–1:15) — [กล้อง] ⭐ ภาพสำคัญที่สุด

**ภาพ:** ถ่ายจอ Mini ใกล้ๆ: **Checking the chain** → **PAID** พร้อมแถบแบ่งเงิน (Owner / Team / Tax / Milk) ถือกล้องนิ่งๆ 3 วินาทีตอนขึ้น PAID

**พูด:**
> "The money waits in the contract. The table screen checks NEAR itself, shows PAID, and signs with a key it made on the device. The contract verifies that signature — and pays everyone in one transaction."

## Scene 6 · หลักฐาน (1:15–1:30) — [จอมือถือ]

**ภาพ:** มือถือขึ้น **Paid** · กล่องเขียว *Paid by the AI agent with your pass* · ในกล่อง *Proof on NEAR* กด **Witness from the café's screen** → หน้า nearblocks

**พูด:**
> "On the explorer: the witness transaction signed by this exact device, and four payouts. If the screen never confirms, the money goes back to the guest — never to the agent."

## Scene 7 · ฝั่งร้าน (1:30–1:42) — [จอร้าน]

**ภาพ:** กดรีเฟรช **Ledger** → บรรทัดใหม่ *Table 2 · 4.05 · Settled · witnessed* → แท็บ **Team & shifts** (ยอดของบาริสต้าเพิ่ม)

**พูด:**
> "The café sees every bill with its transactions, and the barista's share arrives bill by bill."

## Scene 8 · ปิด (1:42–1:52) — [กล้อง]

**ภาพ:** ถอยกล้องให้เห็นทั้งโต๊ะ จอ Mini กลับมาหน้าแรก (QR + ภาพกาแฟ)

**พูด:**
> "One payment. Everyone gets paid. BitPOS Living Bill — live on NEAR testnet. Try it at near.cashlessthailand.com."

---

## ช็อตเสริม: AI ปฏิเสธ (ถ้ามีเวลา, 10 วินาที)

สแกนสั่งใหม่เป็น **Iced Latte + Croissant** → ให้ AI จ่ายด้วยกฎเดิม `Coffee only` → กล่องส้ม **Agent decided: decline** พร้อมเหตุผล
> "Add a croissant and the agent declines, and explains why. No money moves."

จากนั้นแก้กฎเป็น `Coffee and pastries` แล้วกด **Let the AI agent pay this bill** อีกครั้ง → จ่ายผ่าน

## ข้อความ reply บน X

```
Real hardware, real testnet: a guest scans a BitPOS Mini, orders on their phone, and an AI agent pays with a time-limited pass. The table screen signs "paid" with its own key, and one NEAR transaction pays the owner, barista, tax reserve and supplier.
Try it: near.cashlessthailand.com
@NEARProtocol #NEARHackathon
```

## ถ้ามีอะไรติดขัด

| อาการ | ทำอย่างไร |
|---|---|
| จอ Mini ไม่ขึ้น QR + ภาพกาแฟ | รอ 10 วินาทีหลังเสียบไฟ (ต้องต่อ WiFi) ถ้ายังไม่ขึ้น ถอดเสียบใหม่ |
| จอ Mini ขึ้น "Scan to pay" ค้าง | มีออเดอร์รอจ่ายจากรอบซ้อม รอ 10 นาทีหรือจ่ายให้เสร็จ แล้วจะกลับหน้าแรก |
| จอค้างที่ Checking นานเกิน 20 วินาที | ตรวจว่าเปิดพยานแล้ว รอได้ถึง 2 นาที ถ้าไม่ผ่านเงินเด้งกลับเอง เริ่มใหม่ได้ |
| ปุ่มให้ AI จ่ายไม่ขึ้น | กด **Make a new pass** |
| AI ตัดสินไม่ตรงที่คาด | ถ่ายต่อได้ สัญญายังบังคับวงเงินเสมอ หรือสั่งใหม่ |

## พูดได้ / ห้ามพูด

- **พูดได้:** เครื่องจริงเซ็นยืนยันบน testnet ([device_ack](https://testnet.nearblocks.io/txns/8ECTxuJAPfrkPiDb98qCqkQsxQrrNb5w9BGtV3WQPiD5)), AI ตัดสินบน NEAR AI Cloud และตรวจลายเซ็นคำตอบ, ส่วนลดคิดในบิลจริง, เงินทดสอบบน testnet
- **ห้ามพูด:** เงินจริง, mainnet, ร้านจริงใช้งานแล้ว
