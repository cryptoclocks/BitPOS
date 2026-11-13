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

Product: BitPOS Living Bill. BitPOS is our existing café point of sale (first built on Solana devnet; disclosed in the README); for this hackathon we built its NEAR payment rail. Each café bill becomes an entry in a NEAR contract, opened by the POS server from its own quote. The customer pays once with ft_transfer_call and needs no NEAR: the café's relayer pays the gas with a meta transaction, only for a payment that is exactly this bill. In the same transaction the contract pays everyone in one batch: the owner, a tax reserve, the staff on shift and a supplier invoice that collects itself until funded. Anything that is not exactly the bill bounces back by itself.

Witness mode: the money waits in the contract until the BitPOS Mini at the table signs that it showed "paid"; the contract checks that ed25519 signature on chain. No signature in time, and the money goes back to the payer.

AI spending pass: a customer lets an AI agent pay for them for 30 min, 1 hour, 1 day, 1 week or 1 month, with a cap and a per-bill limit. The agent's function-call key can only call pass_pay; refunds go to the customer, never the agent; closing or expiry returns the rest.

NEAR used: Rust contract (NEP-141 receiver, batched payouts, ed25519_verify), NEP-366 meta transactions, function-call keys (a cashier key that cannot move money, an agent key limited to pass_pay), named sub-accounts, a global contract for the test token, NEAR Intents 1Click as a dry-quote preview, NEAR AI Cloud for a reviewable Café CFO.

Status: live on NEAR testnet (bills.bitpos-near.testnet); 23 contract tests, 28 API tests and real end-to-end testnet runs with links in the repository. The new BitPOS Mini firmware boots on the device and passes its on-chip signature self-test.
```
