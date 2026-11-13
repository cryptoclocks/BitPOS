<!-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. -->
# บทอัดวิดีโอเดโมและข้อความโพสต์ X

ใช้คู่กับ "งานที่ 4" ใน [USER_TODO_TH.md](USER_TODO_TH.md) วิดีโอยาวไม่เกิน 2 นาที ไม่ต้องมีสไลด์ ไม่ต้องอธิบายสถาปัตยกรรม

## ก่อนอัด

1. เปิดหน้าต่างเบราว์เซอร์ 3 หน้าต่าง วางเรียงกัน
   - ซ้าย: หน้าร้าน (POS) แท็บ **NEAR · Living Bill** → Overview
   - กลาง: หน้าจ่ายเงินของลูกค้า (ลิงก์ที่ Claude ส่งให้)
   - ขวา: จอโต๊ะจำลอง (กด "Open simulated screen" จากแท็บ Devices)
2. ตั้งภาษาเป็น English ทั้งสามหน้าต่าง
3. ในแท็บ Devices เลือกจอจำลองเป็น "พยาน" (witness)

## บทอัด (พูดภาษาอังกฤษสั้น ๆ หรือไม่พูดก็ได้ ใส่คำบรรยายทีหลัง)

| เวลา | ทำอะไรบนจอ | คำบรรยาย (อังกฤษ) |
|---|---|---|
| 0:00–0:10 | ชี้ที่บิลในหน้าลูกค้า: ยอดรวม และรายการ "where your money goes" | A café bill. One payment — and four people get paid. |
| 0:10–0:25 | กด **Demo wallet (testnet)** | The customer pays once. No NEAR needed: the café pays the network fee. |
| 0:25–0:45 | จอโต๊ะจำลองเปลี่ยนเป็น "Checking the chain" แล้ว "Paid" · หน้าลูกค้าเปลี่ยนจาก "Waiting for the café's screen" เป็น "Paid" | The money waits in the contract until the table screen signs that it showed "paid". The contract checks that signature. |
| 0:45–1:05 | กดลิงก์ธุรกรรมในใบเสร็จ → หน้า explorer แสดงการโอน 4 รายการ | Same transaction on NEAR: owner, barista on shift, tax reserve, milk supplier. All or nothing. |
| 1:05–1:25 | กลับหน้าร้าน แท็บ Team: ยอด "earned today" ของพนักงานเพิ่ม · แท็บ Suppliers: แถบใบแจ้งหนี้ขยับ | Payroll by the cup. A supplier invoice that collects itself. |
| 1:25–1:45 | เปิดบิลใหม่ แล้วปิดจอโต๊ะจำลอง → กดจ่าย → รอให้หน้าลูกค้าขึ้นปุ่ม "Send my money back" → กด | No witness? After the timeout the money goes back to the payer by itself. |
| 1:45–2:00 | แท็บ Ledger → กด Export CSV | Every line has a transaction link. An accountant can open the CSV. |

## ข้อความโพสต์ X (อังกฤษ)

**แบบสั้น (ไม่เกิน 280 ตัวอักษร):**

```
Cafés pay tips, tax and suppliers by hand, days after the sale.

Built at NEAR HACKATHON: one coffee payment, and a NEAR contract pays the barista, the tax pot and the milk supplier in the same transaction.

@NEARProtocol #NEARHackathon
<ลิงก์ repo>
```

**แบบยาว (ถ้าบัญชีโพสต์ยาวได้):**

```
Cafés pay tips, tax and suppliers by hand, days after the sale, from one mixed balance.

We built BitPOS Living Bill at NEAR HACKATHON. A café bill becomes an entry in a NEAR contract:

• The customer pays once and needs no NEAR — the café's relayer pays the gas (meta transactions).
• In the same transaction the contract pays the owner, the barista on shift, a tax reserve and a supplier invoice. All transfers happen, or none.
• Wrong amount, expired bill, paid twice? It bounces back by itself.
• The screen at the table is a witness: the money is released only when the device signs that it showed "paid". The contract verifies that signature. No signature → the money goes back.

Running on NEAR testnet. Code and a 5-minute "do X, see Y" guide: <ลิงก์ repo>

What would your business split automatically on every sale?

@NEARProtocol #NEARHackathon @NearBuilders
```

แนบไฟล์วิดีโอ แล้วกดโพสต์ จากนั้นคัดลอกลิงก์โพสต์ส่งให้ Claude

## ข้อความ "What did you build?" สำหรับฟอร์ม (อังกฤษ, ไม่เกิน 2,000 ตัวอักษร)

```
Problem: a small café pays tips, tax and suppliers by hand, days after the sale, out of one mixed balance.

Product: BitPOS Living Bill. BitPOS is our existing café point of sale (first built on Solana devnet; disclosed in the README). For this hackathon we built its NEAR payment rail. A café bill becomes an entry in a NEAR contract, opened by the POS server from its own frozen quote. The customer pays it with one ft_transfer_call and needs no NEAR: the café's relayer pays the gas through a meta transaction, and only for a payment that is exactly this bill. In the same transaction the contract pays everyone in one batched receipt: the owner, a tax reserve, the staff who are on shift (payroll by the cup) and a supplier invoice that collects itself until it is funded. Anything that is not exactly the bill bounces back to the payer by itself.

An AI spending pass lets a customer give an AI agent a time-limited pass (30 min to 1 month) with a cap and a per-bill limit; the agent's function-call key can only call pass_pay, refunds of bills it paid go to the customer, and closing or expiry returns the rest.

In witness mode the money waits in the contract until the BitPOS Mini at the table signs that it showed "paid" with a key made on the device; the contract verifies that ed25519 signature on chain. Without it, anyone can send the money back to the payer after a timeout.

How NEAR fits: Rust contract with NEP-141 receiver semantics and batched promise payouts; on-chain ed25519_verify for the hardware witness; NEP-366 meta transactions; function-call access keys so the POS server can open bills but cannot move the shop's money; named sub-accounts for staff and suppliers; a global contract for the test token; NEAR Intents 1Click as a labelled dry-quote preview of paying from other chains; NEAR AI Cloud for a reviewable "Café CFO" suggestion with response-signature verification.

Status: deployed on NEAR testnet (bills.bitpos-near.testnet). 23 contract tests, 28 API tests, real end-to-end runs on testnet with transaction links in the repository. Firmware for the device runs on the real board (boots, makes its own key, on-chip signature self-test passes); its network witness path is so far verified with a simulated screen in the browser that runs the same protocol.
```
