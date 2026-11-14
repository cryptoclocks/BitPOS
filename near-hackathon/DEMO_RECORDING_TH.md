<!-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. -->
# สตอรี่บอร์ดวิดีโอถ่ายจริง: ถือเครื่อง BitPOS Mini สั่งและจ่ายจริงบน NEAR testnet

ความยาวเป้าหมาย **ประมาณ 1:45–2:00 นาที** · โพสต์เป็น **reply ใต้โพสต์เดิม**
https://x.com/theCryptoClock/status/2121392191759335814

**ภาพที่ใช้มี 3 แบบ**
- **[กล้อง]** ถ่ายด้วยมือถืออีกเครื่อง เห็นเครื่อง Mini บนโต๊ะ มือ แก้วกาแฟ (แนวนอน 16:9)
- **[จอมือถือ]** อัดหน้าจอมือถือที่ใช้สแกนจ่าย (iPhone: ศูนย์ควบคุม → บันทึกหน้าจอ) แล้วแทรกตอนตัดต่อ
- **[จอร้าน]** อัดหน้าจอโน้ตบุ๊ก/แท็บเล็ตที่เปิดหน้าร้าน (Mac: `Cmd + Shift + 5`)

---

## เตรียมก่อนถ่าย (10 นาที)

1. **เครื่อง Mini:** เสียบไฟ USB (ที่ชาร์จหรือพาวเวอร์แบงก์ก็ได้) ใช้ WiFi วงเดิมที่ตั้งไว้ รอจอขึ้นหน้า **Orbit Café · Ready for the next order**
2. **เปิดโหมดพยาน:** ที่หน้าร้าน `near-pos.cashlessthailand.com` → **Owner** → แท็บ **NEAR · Living Bill** → **Devices & witness**
   → แถว **BitPOS Mini · Table 2** → กด **Make witness**
   (หรือพิมพ์บอก Claude ว่า "เปิดพยาน" แล้วผมเปิดให้)
3. **หน้าร้าน:** เปิด **Menu** → register **Counter** ค้างไว้
4. **มือถือที่ใช้จ่าย:** เปิดกล้องพร้อมสแกน QR และเปิดบันทึกหน้าจอ
5. ซ้อม 1 บิลก่อนอัดจริง

> **หลังถ่ายเสร็จ:** บอก Claude ว่า "ปิดพยาน" ถ้าเปิดโหมดพยานค้างไว้ตอนถอดเครื่อง บิลของกรรมการจะรอเครื่องนาน 2 นาทีแล้วเงินเด้งกลับ

---

## Scene 1 · เปิดเรื่อง (0:00–0:08) — [กล้อง]

**ภาพ:** เครื่อง Mini บนโต๊ะร้านกาแฟ ข้างแก้วกาแฟ จอขึ้น *Orbit Café · Ready for the next order* ค่อยๆ ซูมเข้า

**พูด:**
> "This is a real BitPOS Mini on a café table, running our new NEAR firmware."

## Scene 2 · ร้านออกบิล (0:08–0:20) — [จอร้าน]

**ภาพ:** หน้าร้านกดเพิ่ม **Latte** → **View cart** → **Review order** → **Create order**

**พูด:**
> "The café rings up a latte. The server prices the bill and writes it into a NEAR contract."

## Scene 3 · เครื่องขึ้น QR (0:20–0:30) — [กล้อง]

**ภาพ:** จอ Mini เปลี่ยนเป็น **Scan to pay · 5.00 tUSD** พร้อม QR · มือถือเลื่อนเข้ามาสแกน

**พูด:**
> "The table screen shows the exact amount. The guest scans it with their own phone — no app, and no NEAR needed for gas."

## Scene 4 · หน้าจ่ายเงินบนมือถือ (0:30–0:50) — [จอมือถือ]

**ภาพ:** หน้า near-pay เปิดขึ้น → กด **Open my bill on NEAR** (ถ้ายังไม่เปิด) → เลื่อนให้เห็น *Where your money goes*
→ เปิด **Let an AI agent pay** → เลือก **1 day** → ช่องกฎพิมพ์ **`Coffee only`** → **Give the AI a pass** → **Let the AI agent pay this bill**

**พูด:**
> "Here's where the money goes: the owner, the tax reserve, the barista on shift and the milk supplier.
> The guest lets an AI agent pay, with a one-day pass, a cap, and one rule: coffee only. The agent checks the bill on NEAR AI Cloud, and pays."

## Scene 5 · เครื่องเป็นพยาน (0:50–1:10) — [กล้อง] ภาพสำคัญที่สุด

**ภาพ:** ถ่ายจอ Mini ใกล้ๆ: **Checking the chain** → **PAID** พร้อมแถบแบ่งเงิน Owner / Team / Tax / Milk

**พูด:**
> "The money waits in the contract. The table screen asks NEAR itself, shows PAID, and signs with a key it made on the device.
> The contract checks that signature — and pays everyone in the same transaction."

## Scene 6 · หลักฐานบนมือถือ (1:10–1:25) — [จอมือถือ]

**ภาพ:** หน้ามือถือขึ้น **Paid** · กล่องเขียว *Paid by the AI agent with your pass* · กดลิงก์ **Witness from the café's screen** → หน้า nearblocks

**พูด:**
> "On the explorer: the witness transaction from this exact device, and four payouts. If the screen never confirms, the money goes back to the guest — never to the agent."

## Scene 7 · ฝั่งร้าน (1:25–1:40) — [จอร้าน]

**ภาพ:** แท็บ **NEAR · Living Bill** → **Ledger** (บรรทัดใหม่ *witnessed*) → **Team & shifts** (ยอดบาริสต้าเพิ่ม)

**พูด:**
> "The café sees every bill with its transactions, and the barista's share arrives bill by bill."

## Scene 8 · ปิด (1:40–1:50) — [กล้อง]

**ภาพ:** ถอยกล้องให้เห็นโต๊ะ เครื่อง Mini ที่ขึ้น PAID และแก้วกาแฟ

**พูด:**
> "One payment. Everyone gets paid. BitPOS Living Bill, live on NEAR testnet — try it at near.cashlessthailand.com."

---

## ช็อตเสริม (ถ้ามีเวลา) — AI ปฏิเสธ

สร้างบิลใหม่เป็น **Latte + Croissant** แล้วให้ AI จ่ายด้วยกฎเดิม **`Coffee only`** จะขึ้นกล่องส้ม **Agent decided: decline** พร้อมเหตุผล และเครื่อง Mini ยังแสดง QR อยู่เพราะไม่มีเงินเคลื่อน
> "Break the rule — add a croissant — and the agent declines and explains why. No money moves."

## ข้อความ reply บน X (พร้อมใช้)

```
Real hardware, real testnet: a BitPOS Mini on a café table witnesses the payment. An AI agent pays with a time-limited pass, the screen signs "paid" with its own key, and one NEAR transaction pays the owner, barista, tax reserve and supplier.
Try it: near.cashlessthailand.com
@NEARProtocol #NEARHackathon
```

## ถ้ามีอะไรติดขัด

| อาการ | ทำอย่างไร |
|---|---|
| จอ Mini ไม่ขึ้น QR | ตรวจว่าเปิดโหมดพยานแล้ว และเครื่องต่อ WiFi (จอขึ้น Ready for the next order) |
| จอค้างที่ Checking นานเกิน 20 วินาที | รอได้ถึง 2 นาที ถ้าไม่ผ่าน เงินเด้งกลับเอง เริ่มบิลใหม่ได้ |
| ปุ่มให้ AI จ่ายไม่ขึ้น | กด **Make a new pass** |
| บิลหมดอายุ | สร้างบิลใหม่ที่หน้าร้าน |
| AI ตัดสินไม่ตรงที่คาด | ถ่ายต่อได้: สัญญายังบังคับวงเงินเสมอ หรือเริ่มบิลใหม่ |

## ข้อเท็จจริงที่พูดได้ (และที่ห้ามพูด)

- พูดได้: เครื่องจริงเซ็นยืนยันบน testnet แล้ว ([device_ack](https://testnet.nearblocks.io/txns/8ECTxuJAPfrkPiDb98qCqkQsxQrrNb5w9BGtV3WQPiD5)), AI ตัดสินบน NEAR AI Cloud พร้อมตรวจลายเซ็น, เงินทดสอบบน testnet
- ห้ามพูด: เงินจริง, mainnet, ร้านจริงใช้งานแล้ว
