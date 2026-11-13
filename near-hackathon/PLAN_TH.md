<!-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. -->
# BitPOS × NEAR — แผนลงแข่ง NEAR HACKATHON (track Real-World Money)

อัปเดต 14 พ.ย. 2026 · เดดไลน์ **15 พ.ย. 2026 06:59 น. เวลาไทย** (14 พ.ย. 23:59 UTC)

## 1. ชื่อและประโยคเดียว

**BitPOS Living Bill — บิลมีชีวิต**

> จ่ายกาแฟแก้วเดียว บิลแบ่งเงินให้ทุกคนเองในวินาทีเดียวกัน และเงินจะปล่อยก็ต่อเมื่อเครื่องที่โต๊ะ "เป็นพยาน" ว่าร้านเห็นการจ่ายแล้ว ถ้าไม่มีพยาน เงินเด้งกลับหาลูกค้าเอง

โจทย์ของ track มี 5 คำ: payroll, invoicing, remittances, merchant payments, stablecoin rails บิลเดียวของเราแตะครบ 5 คำ

## 2. หลักการ (ห้ามผ่อน)

1. **เงินพกกติกาไปเอง** — บิลอยู่ในสัญญาบน NEAR จ่ายผิดยอด บิลหมดอายุ หรือจ่ายซ้ำ เงินเด้งกลับอัตโนมัติ
2. **เซิร์ฟเวอร์เสนอ เชนตัดสิน** — ขึ้น PAID เมื่อธุรกรรมถึงสถานะ FINAL และตรวจซ้ำกับสัญญาแล้วเท่านั้น callback จากกระเป๋าหรือหน้าเว็บไม่ใช่หลักฐาน
3. **ไม่มีใครต้องถือ NEAR** — ลูกค้าและพนักงานไม่จ่ายค่า gas ร้านออกให้ผ่าน relayer ที่รับเฉพาะคำสั่งของเรา
4. **กุญแจมีอำนาจน้อยที่สุด** — เครื่อง Mini เซ็นได้แค่ "ยืนยันว่าเห็น" · AI เสนอได้อย่างเดียว · กุญแจแคชเชียร์เปิด/ยกเลิกบิลได้อย่างเดียว ไม่มีกุญแจใดในระบบอัตโนมัติที่ย้ายเงินร้านได้
5. **หน่วยย่อยจำนวนเต็ม** — ราคามาจาก quote ฝั่งเซิร์ฟเวอร์ที่ตรึงแล้ว (USD 4 ตำแหน่ง × 100 = หน่วยเหรียญ 6 ตำแหน่ง) ไม่มี float
6. **กรรมการลองได้ใน 5 นาทีบน testnet** — ไม่มีกระเป๋าก็กด "กระเป๋าลูกค้าเดโม" ได้ ทุกอย่างที่จำลองต้องติดป้ายว่าจำลอง
7. **แยกงานชัด** — โค้ดใหม่อยู่ใต้ชื่อ `near` เท่านั้น ไฟล์เดิมที่แตะต้องลงบันทึกใน PROVENANCE

## 3. โฟลเดอร์และ GitHub

| เรื่อง | ค่า |
|---|---|
| โฟลเดอร์งาน | `~/Desktop/BitPOS-NEAR-2026` (worktree แบบเดียวกับ Meta/PayPal) |
| Branch | `hackathon/near-2026` |
| จุดตั้งต้น | tag `near-hackathon-baseline` = `b770ab2c` (POS ล่าสุด ยังไม่มีโค้ด PayPal/Meta) |
| กุญแจและไฟล์ลับ | `~/.bitpos-near/` (นอก repo) |
| GitHub | พัฒนาบน branch นี้ใน `cryptoclocks/BitPOS` ตามแบบเดิม · ตอนส่งแนะนำให้ push branch เดียวกันไปเป็น `main` ของ repo ใหม่ `cryptoclocks/bitpos-near` เพื่อให้ตัวตรวจ AI เปิดมาเจอ README ของ NEAR ทันที (ต้องให้เจ้าของสั่ง push เอง) |

พื้นที่ที่อนุญาตให้เขียน: `contracts/near-bills/`, `apps/api/src/near/`, `apps/web/src/components/near/`, `apps/web/src/lib/near-*`, `apps/web/src/styles/near.css`, `supabase/migrations/5xx_near_*`, `tests/near-*`, `tools/near/`, `infra/near/`, `near-hackathon/`, `design/figcraft-near/`, `device/firmware/main/bitpos_near*`, `device/firmware/sdkconfig.near`, `tools/firmware/build-near.sh`

## 4. ฟีเจอร์

### P0 — ต้องเสร็จ

| # | ฟีเจอร์ | ทำอะไร | เทคโนโลยี NEAR |
|---|---|---|---|
| A | **Living Bill** | เซิร์ฟเวอร์เปิดบิลในสัญญา (ยอด, เหรียญ, เวลาหมดอายุ, รายชื่อผู้รับเงิน) ลูกค้าจ่ายด้วย `ft_transfer_call` สัญญาตรวจยอดพอดี ไม่พอดีเด้งกลับ | สัญญา Rust `near-sdk` 5.30, NEP-141, NEP-297 events |
| B | **แบ่งจ่ายในวินาทีเดียว** | เงินบิลเดียวแตกไปหาเจ้าของ, กองภาษี, ทิป/ค่าแรงพนักงานที่อยู่กะ, ซัพพลายเออร์ ใน receipt เดียว ถ้ารายการใดล้ม ทั้งชุดย้อน | promise batch (หลาย `ft_transfer` ใน receipt เดียว) + callback |
| C | **พยานเป็นเครื่อง (Proof of Serve)** | เงินค้างในสัญญาจนกว่า BitPOS Mini ที่โต๊ะเซ็นยืนยันว่าแสดง "จ่ายแล้ว" ครบเวลาแล้วไม่มีพยาน ใครก็กดคืนเงินให้ลูกค้าได้ | `env::ed25519_verify` ในสัญญา |
| D | **จ่ายไม่มีค่า gas** | ลูกค้าเซ็น ร้านจ่ายค่า gas ผ่าน relayer ที่รับเฉพาะ `ft_transfer_call` เข้าสัญญาเรา | Meta transactions NEP-366, NEAR Connect `signDelegateActions` |
| E | **ค่าแรงตามแก้ว** | พนักงานกดเข้ากะ ส่วนแบ่งทิป/ค่าแรงของบิลถัดไปเข้าบัญชี NEAR ของพนักงานทันที | บัญชีย่อยมีชื่อ (`mai.orbit.<root>.testnet`) |
| F | **ใบแจ้งหนี้ที่เก็บเงินเอง** | ตั้งใบแจ้งหนี้ซัพพลายเออร์ แล้วทุกบิลกันเงินตามอัตราไปจ่ายจนครบ | ส่วนหนึ่งของ payout batch |
| G | **สมุดบัญชีและหลักฐาน** | ทุกบิลมีเส้นเวลา: quote → เปิดบิล → จ่าย → พยาน → แบ่งจ่าย พร้อมลิงก์ explorer และส่งออก CSV | tx status FINAL + receipts |
| H | **firmware BitPOS Mini รุ่น NEAR** | แสดง QR, ตรวจสถานะบิลจากเชนเองผ่าน RPC, แสดงการแบ่งเงิน, เซ็นพยานด้วยกุญแจที่เกิดในเครื่อง | ed25519 บน ESP32-S3, JSON-RPC view call |
| I | **จอโต๊ะจำลองบนเว็บ** | ให้กรรมการเห็นจอ Mini ได้โดยไม่มีเครื่อง (ติดป้ายจำลอง) | — |

### P1 — ทำถ้าเหลือเวลา

| # | ฟีเจอร์ | เทคโนโลยี NEAR |
|---|---|---|
| J | **Café CFO** — AI เสนอสูตรแบ่งเงิน (เลือกจากรายการที่เซิร์ฟเวอร์สร้าง) รันใน TEE และเก็บลายเซ็นยืนยันคำตอบ เจ้าของกดอนุมัติเอง | NEAR AI Cloud (โมเดล TEE + `/v1/signature`) |
| K | **จ่ายจากเชนอื่น (ดูตัวอย่าง)** — แสดง quote จริงว่าคนถือ USDC บน Base/Solana หรือ USDT บน Tron ต้องจ่ายเท่าไร ร้านได้ USDC บน NEAR ตรงยอด (ไม่ส่งธุรกรรม เพราะ Intents มีเฉพาะ mainnet) | NEAR Intents 1Click `EXACT_OUTPUT`, `dry: true` |
| L | **ส่งเงินกลับบ้าน (ดูตัวอย่าง)** — พนักงานดู quote โอนรายได้ไปเชน/เหรียญอื่น | NEAR Intents 1Click |
| M | **หารบิล** — หลายคนจ่ายบิลเดียว ครบแล้วค่อยปล่อย ไม่ครบคืนทุกคน | สัญญาเดียวกัน |

### P2 — บันทึกเป็นแผนต่อ ไม่ทำรอบนี้

เอเจนต์สั่งและจ่ายเองผ่าน MCP (ต่อยอดจาก Meta) · จ่ายซัพพลายเออร์ข้ามเชนด้วย Chain Signatures · อนุมัติหลายเจ้าของด้วย SputnikDAO · gas key สำหรับเครื่อง · mainnet

**Track ที่ส่ง:** `realworld` เป็นหลัก · เพิ่ม `security` ได้ถ้า C และ J เสร็จจริง

## 5. Stack

| ชั้น | ใช้อะไร |
|---|---|
| สัญญา | Rust 1.100, `near-sdk` 5.30.1, `cargo-near` 0.23.0 → `contracts/near-bills/` |
| เหรียญทดสอบ | `tUSD` 6 ตำแหน่ง จาก global contract `ft.globals.primitives.testnet` (กรรมการรับจากปุ่มในเดโม) · รองรับ USDC ของ Circle บน testnet `3e22…b8af` เป็นเหรียญที่อนุญาตตัวที่สอง |
| เครือข่าย | NEAR testnet · RPC `https://test.rpc.fastnear.com` (สำรอง `https://near-testnet.drpc.org`) |
| ฝั่งเซิร์ฟเวอร์ | TypeScript, `near-api-js` 7.5.3, `borsh` 2 → `apps/api/src/near/` · Postgres migrations 500–509 |
| หน้าเว็บ | Astro + React เดิม, `@hot-labs/near-connect` 0.12 (Meteor/Intear บน testnet) |
| AI | NEAR AI Cloud `https://cloud-api.near.ai/v1` โมเดล TEE (`z-ai/glm-5.3-flash`) เรียกผ่าน fetch · stub ในเทสต์ · เรียกจริงไม่เกิน 1–2 ครั้งต่อฟีเจอร์ |
| Intents | 1Click `https://1click.chaindefuser.com/v0` แบบ dry เท่านั้น |
| เครื่อง | ESP-IDF 5.5.1, LVGL 9.2.2, `BITPOS_PRODUCT=near` → `bitpos_terminal_near` 0.5.0-near |
| ดีไซน์ | FigCraft ผ่าน `figcraft-cli` → `design/figcraft-near/` |
| พอร์ต local | DB 55477 · API 3071 · web 4371 |
| OCI (ต้องขออนุมัติ route ก่อน) | compose `bitpos-near` · front 3105 · api 3106 · web 4381 · โฮสต์ `near-pos` / `near-pay` |

## 6. สัญญา `near-bills`

สถานะบิล: `Open → Escrow → Settling → Settled` · ทางแยก: `Open → Void`, `Escrow → Refunding → Refunded`, `Settling → PayoutFailed → (retry | refund)`

| เมธอด | ใครเรียก | ทำอะไร |
|---|---|---|
| `new(owner)` | deploy | ตั้งเจ้าของสัญญา |
| `set_token(token, allowed)` | owner | อนุญาตเหรียญ |
| `set_merchant(merchant, active)` | owner | ลงทะเบียนร้าน |
| `open_bill(bill_id, token, total, payouts[], expires_at_ms, witness_pk?, witness_timeout_ms)` | บัญชีร้าน (กุญแจแคชเชียร์แบบ function-call) | ตรวจผลรวม payouts = total, ไม่เกิน 10 ผู้รับ |
| `void_bill(bill_id)` | บัญชีร้าน | ยกเลิกบิลที่ยังไม่จ่าย |
| `ft_on_transfer(sender, amount, msg)` | สัญญาเหรียญ | `msg = {"m":merchant,"b":bill_id}` · ไม่ตรงเงื่อนไขคืนเต็มจำนวน · มีพยาน → Escrow · ไม่มีพยาน → แบ่งจ่ายทันที |
| `device_ack(merchant, bill_id, signature)` | ใครก็ได้ (relayer) | ตรวจลายเซ็น ed25519 ของข้อความ `bitpos-near-ack:v1:<contract>:<merchant>:<bill_id>` กับกุญแจพยานของบิล แล้วแบ่งจ่าย |
| `reclaim(merchant, bill_id)` | ใครก็ได้ | Escrow เกินเวลา → คืนเงินผู้จ่าย |
| `merchant_refund(bill_id)` | บัญชีร้าน | คืนเงินระหว่าง Escrow |
| `retry_payout(merchant, bill_id)` | ใครก็ได้ | ลองแบ่งจ่ายใหม่หลัง PayoutFailed |
| `get_bill`, `get_config`, `version` | view | อ่านสถานะ |

Events (`EVENT_JSON`, standard `bitpos-near`): `bill_opened`, `bill_paid`, `payment_bounced`, `device_ack`, `bill_settled`, `payout_failed`, `bill_refunded`, `bill_voided`

## 7. โปรโตคอลเครื่อง Mini (รุ่น NEAR)

- NVS `bitpos_nvs/near`: `url`, `device`, `key`, `lang`, `rpc`, `sk` (seed ed25519 สร้างในเครื่อง ไม่เคยออกจากเครื่อง)
- คำสั่ง USB: `NEAR_PROVISION <url> <device> <key>`, `NEAR_STATUS` (พิมพ์เวอร์ชันและ public key), `NEAR_FORGET`, `NEAR_DEMO`, `NEAR_SHOT`, `NEAR_LANG en|th`
- `GET <url>/near/device/state?d=<uuid>&l=en|th` + `Authorization: Bearer <key>` →
  `{v:1,screen,table,title,line1,line2,big,qr,splits:[{label,amount}],bill:{contract,merchant,id}|null,rpc,poll_ms,tone}`
  `screen` ∈ `setup|idle|qr|checking|paid|refunded|offline`
- เมื่อ `screen=checking` เครื่องเรียก RPC `query call_function get_bill` เอง ถ้าเชนตอบว่า `Escrow` เครื่องแสดง "จ่ายแล้ว" รอให้จอ flush จริง แล้วเซ็นข้อความพยานและ `POST <url>/near/device/ack?d=<uuid>` `{bill,sig,pk}` (hex)
- เซิร์ฟเวอร์ส่งต่อ `device_ack` เข้าสัญญา สัญญาเป็นผู้ตรวจลายเซ็น เซิร์ฟเวอร์ปลอมพยานไม่ได้

## 8. หน้าจอ (FigCraft) และเส้นทาง

| รหัส | หน้า | ขนาด | เข้าจาก → ไป |
|---|---|---|---|
| N00 | แผนที่ flow ทั้งหมด | 1600×1000 | จุดเริ่ม → ทุกหน้า |
| NM-01 | ร้าน: ภาพรวม NEAR (บัญชี, ยอดคงเหลือ, เงินไหลวันนี้) | 1440×1000 | N00 → NM-02…NM-11 |
| NM-02 | ร้าน: สูตรแบ่งเงิน | 1440×1000 | NM-01 → NM-01, NM-09 |
| NM-03 | ร้าน: ทีมและกะ (ค่าแรงตามแก้ว) | 1440×1000 | NM-01 → NS-01 |
| NM-04 | ร้าน: ซัพพลายเออร์และใบแจ้งหนี้ | 1440×1000 | NM-01 → NM-05 |
| NM-05 | ร้าน: รายละเอียดใบแจ้งหนี้ | 1440×1000 | NM-04 → NM-04, NM-07 |
| NM-06 | ร้าน: สมุดบัญชีบิล + CSV | 1440×1000 | NM-01 → NM-07 |
| NM-07 | ร้าน: เส้นเวลาหลักฐานของบิล | 1440×1000 | NM-06 → NM-06 |
| NM-08 | ร้าน: เครื่องและพยาน | 1440×1000 | NM-01 → ND-07 |
| NM-09 | ร้าน: Café CFO | 1440×1000 | NM-01 → NM-10 |
| NM-10 | ร้าน: ตรวจข้อเสนอของ CFO | 1440×1000 | NM-09 → NM-02 |
| NM-11 | ร้าน: ตั้งค่าครั้งแรก | 1440×1000 | NM-01 → NM-01 |
| NC-01 | ลูกค้า: เมนูโต๊ะ | 390×844 | N00 → NC-02 |
| NC-02 | ลูกค้า: บิล + เงินของคุณไปไหน | 390×844 | NC-01 → NC-03 |
| NC-03 | ลูกค้า: เลือกวิธีจ่าย | 390×844 | NC-02 → NC-04, NC-08 |
| NC-04 | ลูกค้า: อนุมัติในกระเป๋า (concept) | 390×844 | NC-03 → NC-05, NC-07 |
| NC-05 | ลูกค้า: รอเครื่องที่โต๊ะเป็นพยาน | 390×844 | NC-04 → NC-06, NC-07 |
| NC-06 | ลูกค้า: จ่ายแล้ว + ใบเสร็จแบ่งเงิน | 390×844 | NC-05 → NC-01 |
| NC-07 | ลูกค้า: เงินเด้งกลับ | 390×844 | NC-04/05 → NC-02 |
| NC-08 | ลูกค้า: จ่ายจากเชนอื่น (ดูตัวอย่าง) | 390×844 | NC-03 → NC-03 |
| NS-01 | พนักงาน: รายได้ของฉัน | 390×844 | NM-03 → NS-02 |
| NS-02 | พนักงาน: ส่งเงินกลับบ้าน (ดูตัวอย่าง) | 390×844 | NS-01 → NS-01 |
| ND-01…07 | Mini: ว่าง, QR, กำลังตรวจเชน, จ่ายแล้ว+แบ่งเงิน, คืนเงิน, ออฟไลน์, ตั้งค่า | 480×320 | NM-08 / วน ND-01→02→03→04→01 |

กติกาตรวจเส้นทาง: ทุกเฟรมไปถึงได้จาก N00 · ทุกปุ่มมีปลายทาง · ไม่มี hotspot ซ้อนกันที่ไปคนละที่ · ข้อความไม่ล้นเฟรม · ทุกหน้ามีป้าย "NEAR testnet" · หน้าที่เป็น concept ติดป้าย concept

## 9. แบ่งรอบทำงาน (loop)

| Loop | งาน | จบเมื่อ |
|---|---|---|
| 0 | โฟลเดอร์, เครื่องมือ, บัญชี testnet, เหรียญทดสอบ | `near-accounts.json` (เฉพาะชื่อบัญชีสาธารณะ) ครบ และยอดเหรียญเข้ากระเป๋าเดโม |
| 1 | สัญญา `near-bills` + unit test + deploy testnet + สคริปต์ e2e บนเชน | จ่ายถูก/ผิดยอด/หมดอายุ/มีพยาน/ไม่มีพยาน ผ่านบน testnet จริง |
| 2 | API: migrations, เปิดบิลจาก quote, relayer, ตัวตรวจ FINAL, พยาน, กะ, ใบแจ้งหนี้, CSV, เทสต์ | `tests/near-*.test.ts` ผ่าน และ typecheck ไม่เพิ่ม error |
| 3 | เว็บ: แท็บ NEAR ของร้าน, หน้าจ่ายลูกค้า, จอโต๊ะจำลอง, ไทย/อังกฤษ | เปิดในเบราว์เซอร์แล้วจ่ายบิลจริงบน testnet ได้ครบวงจร |
| 4 | firmware รุ่น NEAR + เทสต์บนเครื่อง Mac + build | `bitpos_terminal_near.bin` build ผ่าน และลายเซ็นจากโค้ด C ตรวจผ่านในสัญญา |
| 5 | P1: Café CFO, ดูตัวอย่างข้ามเชน | เทสต์ผ่านด้วย stub |
| 6 | README/JUDGES/PROVENANCE/CHECKPOINT, ตรวจ secret, เตรียม payload ส่ง | เอกสารครบ และรายการที่ยังไม่ได้ตรวจจริงถูกระบุ |

FigCraft UI และการตรวจเส้นทางทำคู่ขนานกับ Loop 1–2
